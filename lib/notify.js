// Notifications: every one is saved (the bell in the app), and sent as a phone/desktop push to people who turned
// push on in Postavke (needs VAPID keys, see README).
import webpush from 'web-push';
import { notifAdd, notifList, readMarkGet, pushSubs, pushSubDel, prefsAll, prefsGet } from './store.js';
import { NOTIF_TYPE_CAT } from './constants.js';
import { listUsers } from './users.js';
import { fold } from './format.js';

export const pushEnabled = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const pushPublicKey = () => process.env.VAPID_PUBLIC_KEY || null;

let vapidSet = false;
function setupVapid() {
  if (vapidSet || !pushEnabled()) return pushEnabled();
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidSet = true;
  return true;
}

// Admin always hears what a department hears.
export const withAdmin = (roles) => [...new Set([...(roles || []), 'admin'])];

export const catOf = (n) => n.cat || NOTIF_TYPE_CAT[n.type] || 'task_update';

// Meant for this person, not caused by them, and not a category they switched off.
export function isForUser(n, user, prefs = {}) {
  if (!user || n.by === user.id) return false;
  if ((prefs.muted || []).includes(catOf(n))) return false;
  return (n.users || []).includes(user.id) || (n.roles || []).includes(user.role);
}

/**
 * notify({ type, title, body, link, roles, users, by })
 *   roles: which roles hear it ('admin' is added); users: extra user ids; by: the user who caused it (never notified).
 */
export async function notify({ type, title, body = '', link = '', roles = [], users = [], by = null }) {
  const n = {
    id: 'n_' + crypto.randomUUID().slice(0, 12),
    at: Date.now(),
    type,
    cat: NOTIF_TYPE_CAT[type] || 'task_update',
    title: String(title).slice(0, 160),
    body: String(body || '').slice(0, 600),
    link,
    roles: roles.length ? withAdmin(roles) : [],
    users: [...new Set(users.filter(Boolean))],
    by: by?.id || null,
    byName: by?.name || null,
  };
  await notifAdd(n);
  if (pushEnabled()) {
    // Send after the response so saving stays fast; outside a request (tests, scripts) send right away.
    let after = null;
    try { ({ after } = await import('next/server')); } catch { /* plain Node */ }
    try { if (after) after(() => sendPush(n)); else await sendPush(n); } catch { await sendPush(n); }
  }
  return n;
}

async function sendPush(n) {
  if (!setupVapid()) return;
  const [subs, users, prefs] = await Promise.all([pushSubs(), listUsers(), prefsAll()]);
  const targets = new Set(users.filter((u) => !u.disabled && isForUser(n, u, prefs[u.id])).map((u) => u.id));
  const payload = JSON.stringify({ title: n.title, body: n.body, url: '/#' + (n.link || ''), tag: n.id });
  await Promise.all(subs.filter((s) => targets.has(s.userId)).map(async (s) => {
    try {
      await webpush.sendNotification(s.sub, payload, { TTL: 60 * 60 * 12 });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) await pushSubDel(s.id); // the browser dropped it
      else console.error('push failed', e?.statusCode, e?.body || e?.message);
    }
  }));
}

export async function sendTestPush(user) {
  if (!setupVapid()) return 0;
  const subs = (await pushSubs()).filter((s) => s.userId === user.id);
  const payload = JSON.stringify({ title: 'STT Logistika', body: 'Obavijesti rade na ovom uređaju.', url: '/#postavke', tag: 'test' });
  let ok = 0;
  for (const s of subs) {
    try { await webpush.sendNotification(s.sub, payload); ok += 1; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) await pushSubDel(s.id); }
  }
  return ok;
}

export async function notificationsFor(user, limit = 60) {
  const [list, lastRead, prefs] = await Promise.all([notifList(), readMarkGet(user.id), prefsGet(user.id)]);
  const mine = list.filter((n) => isForUser(n, user, prefs)).slice(0, limit);
  return { list: mine, lastRead, unread: mine.filter((n) => n.at > lastRead).length, muted: prefs.muted || [] };
}

/** People named with @ in a comment: "@amra", "@Selma", "@din.h". */
export function mentionedUsers(text, users) {
  const t = ' ' + fold(text) + ' ';
  if (!t.includes('@')) return [];
  return users.filter((u) => {
    const names = [u.username, u.name, String(u.name || '').split(/\s+/)[0]].map(fold).filter((x) => x && x.length >= 2);
    return names.some((nm) => new RegExp('@' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])').test(t));
  }).map((u) => u.id);
}
