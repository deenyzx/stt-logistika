// The rules: orders and tasks, laptop reservations, comments, the inbox (web shop + email), stock exports.
// API routes stay thin and call these.
import { all, one, insert, mutate, remove, nextSeq, kvGet, kvSet } from './store.js';
import {
  TASK_TYPES, TASK_STATUS, SOURCES, DEPTS, RES_STATUS, RES_PURPOSE, PAYMENT, LIMITS, ROLE_KEYS, INBOX_KIND, can, isOpenTask,
} from './constants.js';
import { HttpError, str, isoDate, num, oneOf } from './errors.js';
import { notify, mentionedUsers, withAdmin } from './notify.js';
import { listUsers } from './users.js';
import { toSnapshot, diffSnapshots } from './csv.js';
import { fmtDelta, fmtMoney, fmtQty, todayISO, snippet, preview } from './format.js';
import { cleanRules, matchRule, RULE_ACTIONS } from './emailRules.js';
import { emailToInbox, wooOrderToInbox, WOO_STATUS } from './integrations.js';
import { parseWooEmail } from './wooEmail.js';
import { listShops, getShop, matchShop, orderKey, adminUrl, hasApi, publicShop, findOrder, completeOrder, recentOrders } from './shops.js';

const who = (u) => (u ? { id: u.id, name: u.name, role: u.role } : { id: 'system', name: 'Sistem', role: null });
const newId = (p) => p + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const pad = (n) => String(n).padStart(4, '0');
const log = (obj, user, text) => { obj.history = [...(obj.history || []), { at: Date.now(), by: user?.name || 'Sistem', text }].slice(-100); };
const ALL_ROLES = ROLE_KEYS;

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Buffer.from(d).toString('hex');
}

/* ================= settings ================= */
// keepOther: true (default) = every email enters Prijem; false = ones that look like newsletters, automatic or internal
// mail go to "Preskočeno" instead.
export const DEFAULT_SETTINGS = { stockMapping: { key: '', qty: '', name: '' }, autoAcceptWeb: false, webDept: 'veleprodaja', emailRules: [], keepOther: true };

export async function getSettings() {
  const s = (await kvGet('settings')) || {};
  return { ...DEFAULT_SETTINGS, ...s, stockMapping: { ...DEFAULT_SETTINGS.stockMapping, ...(s.stockMapping || {}) } };
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur };
  if (patch.stockMapping) next.stockMapping = { key: str(patch.stockMapping.key, 80), qty: str(patch.stockMapping.qty, 80), name: str(patch.stockMapping.name, 80) };
  if (patch.autoAcceptWeb !== undefined) next.autoAcceptWeb = !!patch.autoAcceptWeb;
  if (patch.webDept) next.webDept = oneOf(patch.webDept, DEPTS, cur.webDept);
  if (patch.emailRules !== undefined) next.emailRules = cleanRules(patch.emailRules);
  if (patch.keepOther !== undefined) next.keepOther = !!patch.keepOther;
  await kvSet('settings', next);
  return next;
}

/* ================= shared cleaning ================= */
function cleanItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, LIMITS.items)
    .map((i) => ({ code: str(i?.code, 60), name: str(i?.name, 200), qty: num(i?.qty), price: num(i?.price) }))
    .filter((i) => i.code || i.name);
}

async function checkAssignee(id) {
  if (!id) return null;
  const users = await listUsers();
  const u = users.find((x) => x.id === id && !x.disabled);
  if (!u) throw new HttpError(400, 'bad_assignee', 'Taj korisnik ne postoji.');
  return u.id;
}

const deptRoles = (dept) => [dept === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja'];
const participants = (obj) => [obj.createdBy?.id, obj.assignee, ...(obj.watchers || []), ...(obj.comments || []).map((c) => c.by?.id)].filter((x) => x && x !== 'system' && x !== 'agent');

/* ================= orders and tasks ================= */
function cleanCustomer(c) {
  return {
    name: str(c?.name, 120),
    contact: str(c?.contact, 160), // contact person at a company, or any other contact note
    phone: str(c?.phone, 60),
    email: str(c?.email, 160),
    address: str(c?.address, 240),
  };
}

function taskPatch(input) {
  const p = {};
  if (input.title !== undefined) p.title = str(input.title, LIMITS.title);
  if (input.customer !== undefined) p.customer = cleanCustomer(input.customer);
  if (input.source !== undefined) p.source = oneOf(input.source, SOURCES, 'ostalo');
  if (input.dept !== undefined) p.dept = oneOf(input.dept, DEPTS, 'veleprodaja');
  if (input.due !== undefined) p.due = isoDate(input.due);
  if (input.orderedAt !== undefined) p.orderedAt = isoDate(input.orderedAt);
  if (input.expectedAt !== undefined) p.expectedAt = isoDate(input.expectedAt);
  if (input.needsInfo !== undefined) p.needsInfo = !!input.needsInfo;
  if (input.status !== undefined) p.status = oneOf(input.status, TASK_STATUS, null);
  if (input.items !== undefined) p.items = cleanItems(input.items);
  if (input.note !== undefined) p.note = str(input.note, LIMITS.text);
  if (input.supplier !== undefined) p.supplier = str(input.supplier, 120);
  if (input.payment !== undefined) p.payment = str(input.payment, 120);
  if (input.delivery !== undefined) p.delivery = str(input.delivery, 300);
  if (input.total !== undefined) p.total = num(input.total);
  return p;
}

const dmy = (iso) => (iso ? iso.split('-').reverse().map(Number).join('. ') + '.' : '');

export async function createTask(input, user, extra = {}) {
  const type = oneOf(input.type, TASK_TYPES, 'narudzba');
  const p = taskPatch({ source: 'ostalo', dept: user.role === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja', ...input });
  if (!p.title) throw new HttpError(400, 'no_title', 'Upiši naslov.');
  const assignee = await checkAssignee(input.assignee === undefined ? (user.id === 'system' ? null : user.id) : input.assignee);
  const n = await nextSeq(TASK_TYPES[type].prefix);
  const now = Date.now();
  const task = {
    id: newId('t'),
    type,
    number: `${TASK_TYPES[type].prefix}-${pad(n)}`,
    title: p.title,
    customer: p.customer || cleanCustomer({}),
    source: type === 'zadatak' && !input.source ? 'interno' : p.source,
    dept: p.dept,
    supplier: p.supplier || '',
    assignee,
    watchers: [],
    orderedAt: p.orderedAt || todayISO(now),
    expectedAt: p.expectedAt || null,
    due: p.due || null,
    needsInfo: !!p.needsInfo,
    status: p.status || 'nova',
    statusAt: now,
    items: p.items || [],
    payment: p.payment || '',
    delivery: p.delivery || '',
    total: p.total ?? null,
    currency: extra.currency || 'KM',
    note: p.note || '',
    comments: [],
    history: [],
    links: extra.links || {},
    createdBy: who(user),
    createdAt: now,
    updatedAt: now,
  };
  log(task, user, extra.logText || 'Napravio/la ' + (type === 'zadatak' ? 'zadatak' : 'narudžbu'));
  const saved = await insert('tasks', task);
  const c = saved.customer;
  await notify({
    type: 'task_new',
    title: `${saved.number} · ${saved.title}`,
    body: [
      [user.name || 'Sistem', SOURCES[saved.source]?.label, c.name, c.phone].filter(Boolean).join(' · '),
      saved.items.length ? saved.items.slice(0, 4).map((i) => `${fmtQty(i.qty)}× ${i.name || i.code}`).join(', ') : '',
      saved.expectedAt ? 'Roba stiže ' + dmy(saved.expectedAt) : '',
      saved.needsInfo ? 'Unesena na brzinu, treba dopuniti podatke' : '',
    ].filter(Boolean).join('\n'),
    link: 'zadaci/' + saved.id,
    roles: deptRoles(saved.dept),
    users: [saved.assignee],
    by: user.id === 'system' ? null : user,
  });
  return saved;
}

export async function updateTask(id, input, user) {
  const p = taskPatch(input);
  if (p.title === '') throw new HttpError(400, 'no_title', 'Naslov ne može biti prazan.');
  if (input.status !== undefined && !p.status) throw new HttpError(400, 'bad_status', 'Nepoznat status.');
  if (input.orderedAt !== undefined && !p.orderedAt) delete p.orderedAt; // the order date can't be cleared
  const assignee = input.assignee !== undefined ? await checkAssignee(input.assignee) : undefined;
  const users = assignee !== undefined ? await listUsers() : [];
  let before = null;
  const t = await mutate('tasks', id, (t) => {
    before = structuredClone(t);
    Object.assign(t, p);
    if (assignee !== undefined) t.assignee = assignee;
    if (input.watch !== undefined) {
      const w = new Set(t.watchers || []);
      if (input.watch) w.add(user.id); else w.delete(user.id);
      t.watchers = [...w];
    }
    if (p.status && p.status !== before.status) {
      t.statusAt = Date.now();
      log(t, user, `Status: ${TASK_STATUS[before.status]?.label} → ${TASK_STATUS[p.status].label}`);
    }
    if (assignee !== undefined && assignee !== before.assignee) log(t, user, assignee ? `Dodijeljeno: ${users.find((u) => u.id === assignee)?.name || '?'}` : 'Bez dodjele');
    if (p.due !== undefined && p.due !== before.due) log(t, user, p.due ? `Rok: ${dmy(p.due)}` : 'Rok uklonjen');
    if (p.expectedAt !== undefined && p.expectedAt !== (before.expectedAt || null)) log(t, user, p.expectedAt ? `Roba stiže: ${dmy(p.expectedAt)}` : 'Datum dolaska robe uklonjen');
    if (p.orderedAt && p.orderedAt !== before.orderedAt) log(t, user, `Datum narudžbe: ${dmy(p.orderedAt)}`);
    if (before.needsInfo && p.needsInfo === false) log(t, user, 'Podaci dopunjeni');
    return t;
  });
  if (!t) throw new HttpError(404, 'not_found', 'Ne postoji (možda je obrisano).');
  if (before && p.status && p.status !== before.status) {
    await notify({
      type: 'task_status',
      title: `${t.number}: ${TASK_STATUS[t.status].label}`,
      body: `${user.name} · ${t.title}`,
      link: 'zadaci/' + t.id,
      users: participants(t),
      by: user,
    });
  }
  if (before && p.expectedAt && p.expectedAt !== (before.expectedAt || null)) {
    await notify({
      type: 'task_arrival',
      title: `${t.number}: roba stiže ${dmy(p.expectedAt)}`,
      body: `${user.name} · ${t.title}`,
      link: 'zadaci/' + t.id,
      users: participants(t),
      by: user,
    });
  }
  if (before && assignee && assignee !== before.assignee && assignee !== user.id) {
    await notify({ type: 'task_assigned', title: `Dodijeljeno tebi: ${t.number}`, body: `${user.name} · ${t.title}`, link: 'zadaci/' + t.id, users: [assignee], by: user });
  }
  return t;
}

export async function deleteTask(id, user) {
  const t = await one('tasks', id);
  if (!t) return;
  if (user.role !== 'admin' && t.createdBy?.id !== user.id) throw new HttpError(403, 'forbidden', 'Brisati može onaj ko je napravio ili administrator. Možeš staviti status Otkazano.');
  await remove('tasks', id);
}

/* ================= laptop reservations ================= */
function resPatch(input) {
  const p = {};
  if (input.model !== undefined) p.model = str(input.model, 160);
  if (input.code !== undefined) p.code = str(input.code, 80);
  if (input.qty !== undefined) p.qty = Math.max(1, Math.round(num(input.qty) || 1));
  if (input.price !== undefined) p.price = num(input.price);
  if (input.customer !== undefined) p.customer = { name: str(input.customer?.name, 120), phone: str(input.customer?.phone, 60) };
  if (input.purposeType !== undefined) p.purposeType = oneOf(input.purposeType, RES_PURPOSE, 'ostalo');
  if (input.purpose !== undefined) p.purpose = str(input.purpose, 600);
  if (input.payment !== undefined) p.payment = oneOf(input.payment, PAYMENT, 'nije_dogovoreno');
  if (input.deposit !== undefined) p.deposit = num(input.deposit);
  if (input.until !== undefined) p.until = isoDate(input.until);
  if (input.status !== undefined) p.status = oneOf(input.status, RES_STATUS, null);
  return p;
}

export async function createReservation(input, user) {
  const p = resPatch({ qty: 1, purposeType: 'prodaja', payment: 'nije_dogovoreno', ...input });
  if (!p.model) throw new HttpError(400, 'no_model', 'Upiši koji laptop se rezerviše.');
  if (!p.purpose && !p.purposeType) throw new HttpError(400, 'no_purpose', 'Upiši svrhu rezervacije.');
  const n = await nextSeq('R');
  const now = Date.now();
  const r = {
    id: newId('r'),
    number: `R-${pad(n)}`,
    model: p.model,
    code: p.code || '',
    qty: p.qty || 1,
    price: p.price ?? null,
    customer: p.customer || { name: '', phone: '' },
    purposeType: p.purposeType,
    purpose: p.purpose || '',
    payment: p.payment,
    deposit: p.deposit ?? null,
    until: p.until || null,
    status: 'aktivna',
    comments: [],
    history: [],
    createdBy: who(user),
    createdAt: now,
    updatedAt: now,
  };
  const first = str(input.comment, LIMITS.comment);
  if (first) r.comments.push({ id: newId('c'), at: now, by: who(user), text: first });
  log(r, user, 'Napravio/la rezervaciju');
  const saved = await insert('reservations', r);
  await notify({
    type: 'res_new',
    title: `Nova rezervacija ${saved.number}: ${saved.model}${saved.qty > 1 ? ' ×' + saved.qty : ''}`,
    body: `${user.name} · ${RES_PURPOSE[saved.purposeType]}${saved.customer.name ? ' · za ' + saved.customer.name : ''} · ${PAYMENT[saved.payment]}`,
    link: 'rezervacije/' + saved.id,
    roles: ALL_ROLES,
    by: user,
  });
  return saved;
}

export async function updateReservation(id, input, user) {
  const p = resPatch(input);
  if (p.model === '') throw new HttpError(400, 'no_model', 'Model ne može biti prazan.');
  if (input.status !== undefined && !p.status) throw new HttpError(400, 'bad_status', 'Nepoznat status.');
  let before = null;
  const r = await mutate('reservations', id, (r) => {
    before = structuredClone(r);
    Object.assign(r, p);
    if (p.status && p.status !== before.status) {
      log(r, user, `Status: ${RES_STATUS[before.status].label} → ${RES_STATUS[p.status].label}`);
      if (p.status === 'preuzeto') r.closedAt = Date.now();
      if (p.status === 'aktivna') r.closedAt = null;
      if (p.status === 'otkazana') r.closedAt = Date.now();
    }
    if (p.until !== undefined && p.until !== before.until) log(r, user, p.until ? 'Produženo do ' + p.until.split('-').reverse().map(Number).join('. ') + '.' : 'Bez roka');
    return r;
  });
  if (!r) throw new HttpError(404, 'not_found', 'Ne postoji (možda je obrisano).');
  if (before && p.status && p.status !== before.status) {
    await notify({
      type: 'res_status',
      title: `${r.number} ${r.model}: ${RES_STATUS[r.status].label.toLowerCase()}`,
      body: `${user.name}${r.customer.name ? ' · ' + r.customer.name : ''}`,
      link: 'rezervacije/' + r.id,
      roles: ALL_ROLES,
      by: user,
    });
  }
  return r;
}

export async function deleteReservation(id, user) {
  const r = await one('reservations', id);
  if (!r) return;
  if (user.role !== 'admin' && r.createdBy?.id !== user.id) throw new HttpError(403, 'forbidden', 'Brisati može onaj ko je napravio ili administrator. Možeš je otkazati.');
  await remove('reservations', id);
}

/* ================= comments (on anything) ================= */
const KINDS = {
  task: { coll: 'tasks', area: 'zadaci', link: 'zadaci/', label: (o) => `${o.number} · ${o.title}` },
  reservation: { coll: 'reservations', area: 'rezervacije', link: 'rezervacije/', label: (o) => `${o.number} · ${o.model}` },
  inbox: { coll: 'inbox', area: 'prijem', link: 'prijem/', label: (o) => o.title },
  stock: { coll: 'stockdiffs', area: 'zalihe', link: 'zalihe/', label: (o) => 'Promjene zaliha · ' + (o.next?.filename || '') },
};

export async function addComment(kind, id, text, user) {
  const k = KINDS[kind];
  if (!k) throw new HttpError(400, 'bad_kind', 'Nepoznata vrsta.');
  if (!can(user.role, k.area)) throw new HttpError(403, 'forbidden', 'Nemaš pristup.');
  const t = str(text, LIMITS.comment);
  if (!t) throw new HttpError(400, 'empty', 'Komentar je prazan.');
  const c = { id: newId('c'), at: Date.now(), by: who(user), text: t };
  const obj = await mutate(k.coll, id, (o) => {
    o.comments = [...(o.comments || []), c].slice(-LIMITS.comments);
    return o;
  });
  if (!obj) throw new HttpError(404, 'not_found', 'Ne postoji (možda je obrisano).');
  const users = await listUsers();
  const mentions = mentionedUsers(t, users);
  const areaUsers = new Set(users.filter((u) => can(u.role, k.area)).map((u) => u.id));
  const targets = [...new Set([...participants(obj), ...(obj.handledBy ? [obj.handledBy.id] : []), ...mentions])].filter((x) => areaUsers.has(x));
  await notify({
    type: 'comment',
    title: `${user.name} je komentarisao/la: ${k.label(obj)}`.slice(0, 160),
    body: t.slice(0, 200),
    link: k.link + obj.id,
    users: targets,
    by: user,
  });
  return { comment: c, obj };
}

export async function deleteComment(kind, id, commentId, user) {
  const k = KINDS[kind];
  if (!k) throw new HttpError(400, 'bad_kind', 'Nepoznata vrsta.');
  const obj = await mutate(k.coll, id, (o) => {
    const c = (o.comments || []).find((x) => x.id === commentId);
    if (!c) return null;
    if (c.by?.id !== user.id && user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Možeš brisati samo svoje komentare.');
    o.comments = o.comments.filter((x) => x.id !== commentId);
    return o;
  });
  if (!obj) throw new HttpError(404, 'not_found', 'Ne postoji.');
  return obj;
}

/* ================= inbox: web shop orders and emails waiting to become tasks ================= */
const fromLabel = (f) => (f?.name && f?.email ? `${f.name} <${f.email}>` : f?.name || f?.email || 'nepoznato');
const shopLabel = (item) => item.shopName || item.order?.shopName || 'Web shop';

// Everything the shop sent, in a few lines: who, what, how it's paid and delivered.
function webOrderText(o, from) {
  const who_ = [from.name, o.company && o.company !== from.name ? o.company : '', o.city].filter(Boolean).join(', ');
  const items = o.items || [];
  return [
    [who_, from.phone].filter(Boolean).join(' · '),
    ...items.slice(0, 5).map((i) => `${fmtQty(i.qty)}× ${i.name}${i.code ? ' (' + i.code + ')' : ''}`),
    items.length > 5 ? `+ još ${items.length - 5} stavki` : '',
    [o.payment, o.shippingMethod].filter(Boolean).join(' · '),
    o.customerNote ? 'Napomena kupca: ' + o.customerNote : '',
    o.note || '',
  ].filter(Boolean).join('\n');
}

async function notifyInbox(item) {
  if (item.kind === 'ostalo') return; // kept in Prijem → Ostalo, no notification
  if (item.source === 'web') {
    const o = item.order || {};
    await notify({
      type: 'inbox_web',
      title: [`${shopLabel(item)} #${o.number}`, o.total != null ? fmtMoney(o.total, o.currency) : '', o.status && o.status !== 'processing' && o.statusLabel ? o.statusLabel : ''].filter(Boolean).join(' · '),
      body: webOrderText(o, item.from),
      link: 'prijem/' + item.id,
      roles: ['veleprodaja'],
    });
    return;
  }
  const order = item.kind === 'narudzba';
  await notify({
    type: order ? 'inbox_email_order' : 'inbox_email_msg',
    title: `${order ? 'Narudžba emailom' : 'Upit kupca'}: ${item.title}`,
    body: [
      `Od: ${fromLabel(item.from)}${item.from.phone ? ' · ' + item.from.phone : ''}`,
      preview(item.body, 420),
    ].join('\n'),
    link: 'prijem/' + item.id,
    roles: ['veleprodaja'],
  });
}

/**
 * Adds an order or an email to Prijem (or refreshes it if it is already there).
 * Orders carry an orderKey ("kupitelevizor:5202") so the webhook, the API and the shop's email are the same item.
 * quiet: no notification (orders pulled in by a sync that are not new any more).
 */
export async function addInbox(input, { updateOnly = false, quiet = false } = {}) {
  const { source, extId, title, from, body, order, receivedAt } = input;
  const id = 'in_' + (await sha(input.orderKey ? 'order:' + input.orderKey : source + ':' + extId)).slice(0, 16);
  const existing = await one('inbox', id);
  if (!existing && updateOnly) return { item: null, ignored: true };
  if (existing) {
    // The same order again (order.updated, a sync, or the email after the webhook): keep the item, take the
    // fuller data, and tell people if the shop's status changed (e.g. the customer cancelled).
    if (order) {
      const prev = existing.order?.status;
      const changed = !!(prev && order.status && prev !== order.status);
      await mutate('inbox', id, (o) => {
        o.order = { ...o.order, ...Object.fromEntries(Object.entries(order).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))) };
        if (!o.from?.phone && from?.phone) o.from = { ...o.from, phone: from.phone };
        if (changed) log(o, null, `Status u shopu: ${existing.order.statusLabel || prev} → ${order.statusLabel || order.status}`);
        return o;
      });
      if (changed) {
        const task = existing.taskId ? await one('tasks', existing.taskId) : null;
        if (task) await mutate('tasks', task.id, (t) => { log(t, null, `${shopLabel(existing)}: narudžba je sada „${order.statusLabel || order.status}”`); return t; });
        await notify({
          type: 'inbox_web',
          title: `${shopLabel(existing)} #${order.number}: ${order.statusLabel || order.status}`,
          body: `Status u web shopu je promijenjen iz „${existing.order.statusLabel || prev}” u „${order.statusLabel || order.status}”.${task ? ' Narudžba ' + task.number + '.' : ''}`,
          link: task ? 'zadaci/' + task.id : 'prijem/' + id,
          roles: ['veleprodaja'],
          users: task ? participants(task) : [],
        });
      }
    }
    return { item: existing, duplicate: true };
  }
  // A shop email we couldn't read in full, about an order the webhook already brought in: don't add it twice.
  if (source === 'email' && input.orderRef) {
    const web = (await all('inbox')).find((x) => x.source === 'web' && x.order?.number === input.orderRef);
    if (web) return { item: web, duplicate: true, sameAs: web.id };
  }
  const item = {
    id,
    source,
    kind: source === 'web' ? 'narudzba' : oneOf(input.kind, INBOX_KIND, 'upit'),
    via: input.via || (source === 'web' ? 'webhook' : 'email'),
    orderKey: input.orderKey || '',
    shopId: input.shopId || '',
    shopName: str(input.shopName, 60),
    orderRef: str(input.orderRef, 20),
    extId: String(extId),
    receivedAt: receivedAt || Date.now(),
    title: str(title, 240) || '(bez naslova)',
    from: { name: str(from?.name, 120), email: str(from?.email, 160), phone: str(from?.phone, 60), address: str(from?.address, 240) },
    to: str(input.to, 300),
    body: str(body, 20000),
    order: order || null,
    rule: input.rule || null,
    status: 'novo',
    taskId: null,
    comments: [],
    history: [],
    createdAt: Date.now(),
  };
  const saved = await insert('inbox', item);
  // The web order arrived after a shop email about it that we couldn't read in full: that email is done.
  if (source === 'web' && order?.number) {
    const twins = (await all('inbox')).filter((x) => x.source === 'email' && x.orderRef === String(order.number) && x.status === 'novo');
    for (const tw of twins) await mutate('inbox', tw.id, (x) => { x.status = 'rijeseno'; x.sameAs = saved.id; log(x, null, `Isto kao ${shopLabel(saved)} #${order.number}`); return x; });
  }
  const settings = await getSettings();
  if (source === 'web' && settings.autoAcceptWeb) {
    const { task } = await acceptInbox(saved.id, { id: 'system', name: 'Sistem', role: 'admin' }, { dept: settings.webDept });
    return { item: saved, task };
  }
  if (!quiet) await notifyInbox(saved);
  return { item: saved };
}

// A parsed shop email as an order item, in the same shape as a webhook order.
function shopEmailToItem(p, shop, email) {
  const name = shop?.name || p.shopName || 'Web shop';
  const order = {
    id: null,
    number: p.number,
    status: '',
    statusLabel: '',
    total: p.total,
    shippingTotal: p.shippingTotal,
    tax: p.tax,
    currency: p.currency || 'KM',
    payment: p.payment,
    shippingMethod: p.shippingMethod,
    shipping: [p.shippingMethod, p.customer.address].filter(Boolean).join(' · '),
    address: p.customer.address,
    city: p.customer.city,
    company: '',
    customerNote: p.customerNote,
    note: p.note,
    items: p.items.map(({ code, name: n, qty, price }) => ({ code, name: n, qty, price })),
    url: adminUrl(shop, { number: p.number }),
    shopName: name,
  };
  return {
    source: 'web',
    via: 'email',
    orderKey: orderKey(shop?.id || name, p.number),
    shopId: shop?.id || '',
    shopName: name,
    extId: `${name}#${p.number}`,
    title: p.items.length ? p.items.map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ').slice(0, 240) : `Narudžba #${p.number}`,
    from: { name: p.customer.name, email: p.customer.email, phone: p.customer.phone, address: p.customer.address },
    to: email.to,
    body: webOrderText(order, { name: p.customer.name, phone: p.customer.phone }),
    order,
    receivedAt: p.date ? Date.parse(p.date + 'T12:00:00Z') : email.receivedAt,
  };
}

/** A webhook or API order from a configured shop, as an inbox item. */
export function shopOrderToItem(o, shop) {
  const x = wooOrderToInbox(o, shop?.url || '');
  return { ...x, via: 'webhook', orderKey: orderKey(shop?.id || 'web', x.order.number), shopId: shop?.id || 'web', shopName: shop?.name || 'Web shop', order: { ...x.order, shopName: shop?.name || 'Web shop' } };
}

/* ---- skipped emails: not stored in Prijem, kept briefly so nothing is lost ---- */
const MAX_SKIPPED = 200;
async function skipEmail(email, reason) {
  const rec = {
    id: 'sk_' + (await sha('email:' + email.extId)).slice(0, 14),
    at: Date.now(),
    receivedAt: email.receivedAt,
    from: email.from,
    to: email.to || '',
    title: email.title,
    body: String(email.body || '').slice(0, 8000),
    extId: email.extId,
    orderRef: email.orderRef || '',
    reason,
  };
  if (await one('skipped', rec.id)) return { skipped: true, duplicate: true };
  await insert('skipped', rec);
  const list = await all('skipped');
  if (list.length > MAX_SKIPPED) {
    list.sort((a, b) => b.at - a.at);
    for (const old of list.slice(MAX_SKIPPED)) await remove('skipped', old.id);
  }
  return { skipped: true, reason };
}

/** A skipped email that did matter: into Prijem as the chosen kind; optionally always for this sender. */
export async function restoreSkipped(id, kind, user, { remember = false } = {}) {
  const rec = await one('skipped', id);
  if (!rec) throw new HttpError(404, 'not_found', 'Taj email više nije u listi preskočenih.');
  const k = oneOf(kind, INBOX_KIND, 'upit');
  const r = await addInbox({ source: 'email', kind: k, extId: rec.extId, title: rec.title, from: rec.from, to: rec.to, body: rec.body, receivedAt: rec.receivedAt, orderRef: rec.orderRef });
  await remove('skipped', id);
  if (remember && rec.from?.email) await addRule({ field: 'from', contains: rec.from.email, action: k });
  if (r.item) await mutate('inbox', r.item.id, (x) => { log(x, user, 'Vraćeno iz preskočenih'); return x; });
  return r;
}

export async function addRule(rule) {
  const s = await getSettings();
  const rules = cleanRules([rule, ...s.emailRules.filter((r) => !(r.field === rule.field && r.contains.toLowerCase() === String(rule.contains).toLowerCase()))]);
  await saveSettings({ emailRules: rules });
  return rules[0];
}

/**
 * Every incoming email goes through here (the office agent, or an inbound-email service). Nothing is decided for
 * the team: emails land in Prijem and someone chooses which ones become an order or a task.
 *   1. the shop's own "Nova narudžba" email → a full web order (same item as the webhook, if both arrive)
 *   2. the admin's own rules (Postavke → Email): narudžba / upit kupca / ostalo / ignoriši
 *   3. keywords only pick the tab it shows under (Narudžbe, Upiti kupaca, Ostalo)
 * Only an "Ignoriši" rule keeps an email out of Prijem (it goes to Preskočeno); "ostalo" too if keepOther is off.
 */
export async function ingestEmail(payload) {
  const email = emailToInbox(payload);
  const [settings, shops] = await Promise.all([getSettings(), listShops()]);

  const parsed = parseWooEmail({ subject: email.title, text: email.body, fromName: email.from.name })
    || (email.htmlText ? parseWooEmail({ subject: email.title, text: email.htmlText, fromName: email.from.name }) : null);
  if (parsed) {
    const shop = matchShop(shops, { name: parsed.shopName, email: email.from.email });
    return addInbox(shopEmailToItem(parsed, shop, email));
  }

  const { htmlText, ...e } = email;
  const rule = matchRule(settings.emailRules, e);
  if (rule?.action === 'ignore') return skipEmail(e, `Pravilo: ${RULE_LABEL[rule.field]} sadrži „${rule.contains}”`);
  const kind = rule?.action || e.kind;
  if (kind === 'ostalo' && !settings.keepOther) {
    return skipEmail(e, rule ? 'Pravilo: ostalo' : 'Nije narudžba ni upit kupca (newsletter, automatski ili interni email)');
  }
  return addInbox({ ...e, kind, rule: rule ? { id: rule.id, field: rule.field, contains: rule.contains } : null });
}
const RULE_LABEL = { from: 'pošiljalac', to: 'primalac', subject: 'naslov', text: 'tekst', any: 'email' };

/** Turns an inbox item into an order (or, for a customer's email, a task to answer it). */
export async function acceptInbox(id, user, opts = {}) {
  const item = await one('inbox', id);
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  if (item.status === 'prihvaceno' && item.taskId) throw new HttpError(409, 'done', 'Već je prihvaćeno.');
  const as = oneOf(opts.as, TASK_TYPES, item.kind === 'upit' ? 'zadatak' : 'narudzba');
  const o = item.order;
  const f = item.from || {};
  const base = {
    customer: { name: f.name || f.email, contact: o?.company || '', phone: f.phone, email: f.email, address: f.address || o?.address || '' },
    source: item.source === 'web' ? 'web' : 'email',
    dept: opts.dept || (user.role === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja'),
    assignee: opts.assignee !== undefined ? opts.assignee : user.id === 'system' ? null : user.id,
    orderedAt: todayISO(item.receivedAt),
  };
  let input;
  if (o) {
    input = {
      ...base,
      type: 'narudzba',
      title: `${shopLabel(item)} #${o.number}${o.items?.[0] ? ': ' + o.items.map((i) => i.name).slice(0, 2).join(', ') : ''}`,
      items: o.items || [],
      payment: o.payment,
      delivery: [o.shippingMethod, o.address].filter(Boolean).join(' · '),
      total: o.total,
      note: [o.customerNote ? 'Napomena kupca: ' + o.customerNote : '', o.note || ''].filter(Boolean).join('\n'),
    };
  } else if (as === 'zadatak') {
    input = { ...base, type: 'zadatak', title: 'Odgovoriti: ' + item.title.replace(/^((re|fw|fwd|odg)\s*:\s*)+/i, ''), note: snippet(item.body, LIMITS.text) };
  } else {
    // An order that came by email: the details are in the text, so it is marked to be filled in.
    input = { ...base, type: 'narudzba', title: item.title.replace(/^((re|fw|fwd|odg)\s*:\s*)+/i, ''), items: [], note: snippet(item.body, LIMITS.text), needsInfo: true };
  }
  const task = await createTask(input, user, {
    links: { inboxId: item.id, wooId: o?.id || null, wooUrl: o?.url || '', shopId: item.shopId || '', shopName: item.source === 'web' ? shopLabel(item) : '', orderNumber: o?.number || '' },
    currency: o?.currency || 'KM',
    logText: 'Prihvaćeno iz prijema',
  });
  const updated = await mutate('inbox', id, (x) => {
    x.status = 'prihvaceno';
    x.taskId = task.id;
    x.handledBy = who(user);
    x.handledAt = Date.now();
    log(x, user, 'Prihvaćeno kao ' + task.number);
    return x;
  });
  return { task, item: updated };
}

/** A customer writes about an order that already exists: the email goes onto that order as a comment. */
export async function attachInbox(id, taskId, user) {
  const item = await one('inbox', id);
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  const task = await one('tasks', taskId);
  if (!task) throw new HttpError(404, 'not_found', 'Ta narudžba ne postoji.');
  const text = `Email od ${fromLabel(item.from)}: „${item.title}”\n\n${snippet(item.body, 1500)}`;
  await addComment('task', taskId, text, user);
  await mutate('tasks', taskId, (t) => {
    t.links = { ...(t.links || {}), emails: [...new Set([...(t.links?.emails || []), item.id])] };
    return t;
  });
  const updated = await mutate('inbox', id, (x) => {
    x.status = 'prihvaceno';
    x.taskId = taskId;
    x.handledBy = who(user);
    x.handledAt = Date.now();
    log(x, user, 'Dodano u ' + task.number);
    return x;
  });
  return { task, item: updated };
}

export async function setInboxStatus(id, status, user) {
  const labels = { odbaceno: 'Odbačeno', rijeseno: 'Riješeno', novo: 'Vraćeno u prijem' };
  if (!labels[status]) throw new HttpError(400, 'bad_status', 'Nepoznat status.');
  const item = await mutate('inbox', id, (x) => {
    x.status = status;
    x.handledBy = status === 'novo' ? null : who(user);
    x.handledAt = status === 'novo' ? null : Date.now();
    log(x, user, labels[status]);
    return x;
  });
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  return item;
}

/** Re-sort an email; remember = every email from this sender goes the same way from now on. */
export async function setInboxKind(id, kind, user, { remember = false } = {}) {
  const k = oneOf(kind, INBOX_KIND, null);
  if (!k) throw new HttpError(400, 'bad_kind', 'Nepoznata vrsta.');
  const item = await mutate('inbox', id, (x) => {
    if (x.source === 'web' || x.kind === k) return null;
    log(x, user, 'Vrsta: ' + INBOX_KIND[k].label);
    x.kind = k;
    return x;
  });
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  if (remember && item.from?.email) await addRule({ field: 'from', contains: item.from.email, action: k });
  return item;
}

/** "This sender never concerns me": a rule, and this email is dismissed. */
export async function ignoreSender(id, user) {
  const item = await one('inbox', id);
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  if (!item.from?.email) throw new HttpError(400, 'no_sender', 'Email nema adresu pošiljaoca.');
  const rule = await addRule({ field: 'from', contains: item.from.email, action: 'ignore' });
  await setInboxStatus(id, 'odbaceno', user);
  return rule;
}

/* ================= the web shops: live status, Procesuiranje → Završeno, pulling recent orders ================= */
async function shopFor({ shopId, inboxId, taskId }) {
  let item = inboxId ? await one('inbox', inboxId) : null;
  const task = taskId ? await one('tasks', taskId) : null;
  if (!item && task?.links?.inboxId) item = await one('inbox', task.links.inboxId);
  const id = shopId || item?.shopId || task?.links?.shopId || '';
  const shops = await listShops();
  const shop = shops.find((s) => s.id === id) || (item?.shopName ? matchShop(shops, { name: item.shopName }) : null);
  return { shop, item, task };
}

const statusLabel = (st) => { const l = WOO_STATUS[st] || st || ''; return l.charAt(0).toUpperCase() + l.slice(1); };

/** What the shop says about an order right now (read only). */
export async function shopOrderInfo({ shopId, inboxId, taskId }) {
  const { shop, item, task } = await shopFor({ shopId, inboxId, taskId });
  const number = item?.order?.number || task?.links?.orderNumber || '';
  const id = item?.order?.id || task?.links?.wooId || null;
  if (!shop) return { connected: false, reason: 'no_shop', shopName: item?.shopName || task?.links?.shopName || '' };
  if (!hasApi(shop)) return { connected: false, reason: 'no_api', shop: publicShop(shop) };
  const order = await findOrder(shop, { id, number });
  // Remember the shop's own id for this order (email orders only know the number).
  if (item && !item.order?.id) await mutate('inbox', item.id, (x) => { x.order = { ...x.order, id: order.id, url: adminUrl(shop, { id: order.id }) }; return x; });
  if (task && !task.links?.wooId) await mutate('tasks', task.id, (t) => { t.links = { ...t.links, wooId: order.id, wooUrl: adminUrl(shop, { id: order.id }) }; return t; });
  return {
    connected: true,
    shop: publicShop(shop),
    order: { id: order.id, number: String(order.number || order.id), status: order.status, statusLabel: statusLabel(order.status), total: Number(order.total), currency: order.currency, modified: order.date_modified_gmt ? order.date_modified_gmt + 'Z' : order.date_modified, url: adminUrl(shop, { id: order.id }) },
    canComplete: order.status === 'processing',
  };
}

/** The one change the app makes in a shop: Procesuiranje → Završeno. Recorded on the order and the task here. */
export async function completeShopOrder({ shopId, inboxId, taskId, orderId }, user) {
  const { shop, item, task } = await shopFor({ shopId, inboxId, taskId });
  if (!shop) throw new HttpError(400, 'no_shop', 'Ne znam iz kojeg je shopa ova narudžba. Dodaj shop u Postavke → Web shopovi.');
  const id = orderId || item?.order?.id || task?.links?.wooId;
  if (!id) throw new HttpError(400, 'no_order', 'Prvo otvori narudžbu da se pronađe u shopu.');
  const order = await completeOrder(shop, id);
  const label = statusLabel(order.status);
  const what = `${shop.name}: status „Procesuiranje” → „${label}”`;
  if (item) {
    await mutate('inbox', item.id, (x) => { x.order = { ...x.order, status: order.status, statusLabel: WOO_STATUS[order.status] || order.status }; log(x, user, what); return x; });
  }
  const t = task || (item?.taskId ? await one('tasks', item.taskId) : null);
  if (t) {
    await mutate('tasks', t.id, (x) => { log(x, user, what); return x; });
    await notify({
      type: 'task_status',
      title: `${t.number}: ${shop.name} narudžba je „${label}”`,
      body: `${user.name} · ${t.title}`,
      link: 'zadaci/' + t.id,
      users: participants(t),
      by: user,
    });
  }
  return { status: order.status, statusLabel: label };
}

/** Pulls the last few days of orders from every shop with API keys: new ones into Prijem, statuses refreshed. */
export async function syncShops({ days = 3 } = {}) {
  const shops = (await listShops()).filter(hasApi);
  const result = [];
  for (const shop of shops) {
    try {
      const orders = await recentOrders(shop, days);
      let added = 0;
      for (const o of orders) {
        const fresh = Date.now() - (Date.parse(o.date_created_gmt ? o.date_created_gmt + 'Z' : o.date_created) || 0) < 2 * 3600000;
        const r = await addInbox(shopOrderToItem(o, shop), { quiet: !fresh });
        if (!r.duplicate) added += 1;
      }
      result.push({ shop: shop.name, checked: orders.length, added });
    } catch (e) {
      result.push({ shop: shop.name, error: e.message });
    }
  }
  return result;
}

/* ================= stock: EKI EDI export compared with the previous one ================= */
const MAX_DIFFS = 40;

export async function ingestStock(text, { filename = 'izvoz.csv', source = 'rucno', user = null } = {}) {
  const csv = String(text || '');
  if (!csv.trim()) throw new HttpError(400, 'empty', 'Datoteka je prazna.');
  if (csv.length > 5_000_000) throw new HttpError(413, 'too_big', 'Datoteka je prevelika (najviše 5 MB).');
  const hash = await sha(csv);
  const latest = await kvGet('stock_latest');
  if (latest && latest.hash === hash) return { unchanged: true };
  const settings = await getSettings();
  const snap = toSnapshot(csv, settings.stockMapping);
  if (snap.error) throw new HttpError(422, 'bad_csv', snap.error);
  const meta = {
    filename: str(filename, 160) || 'izvoz.csv',
    at: Date.now(),
    by: who(user),
    source,
    count: snap.count,
    lines: snap.lines,
    columns: snap.columns.slice(0, 40),
    keyCol: snap.keyCol,
    qtyCol: snap.qtyCol,
    nameCol: snap.nameCol,
    guessed: snap.guessed,
  };
  const changes = latest ? diffSnapshots(latest.rows, snap.rows) : [];
  const diff = {
    id: newId('sd'),
    at: meta.at,
    baseline: !latest,
    prev: latest ? latest.meta : null,
    next: meta,
    changes,
    counts: countKinds(changes),
    done: {},
    comments: [],
    history: [],
  };
  await kvSet('stock_latest', { hash, meta, rows: snap.rows }, { silent: true });
  const saved = await insert('stockdiffs', diff);
  await pruneDiffs();
  if (changes.length) {
    const top = changes.slice(0, 3).map((c) => `${c.name || c.key} ${c.kind === 'new' ? '(novo)' : c.kind === 'removed' ? '(nestalo)' : fmtDelta(c.delta)}`).join(', ');
    await notify({
      type: 'stock',
      title: `Novi izvoz iz EKI EDI: ${changes.length} ${changes.length === 1 ? 'promjena' : 'promjena'} za web`,
      body: top,
      link: 'zalihe/' + saved.id,
      roles: ['veleprodaja'],
      by: user,
    });
  }
  return { diff: saved };
}

function countKinds(changes) {
  const c = { qty: 0, new: 0, removed: 0 };
  for (const x of changes) c[x.kind] += 1;
  return c;
}

async function pruneDiffs() {
  const diffs = await all('stockdiffs');
  if (diffs.length <= MAX_DIFFS) return;
  diffs.sort((a, b) => b.at - a.at);
  for (const d of diffs.slice(MAX_DIFFS)) await remove('stockdiffs', d.id);
}

export async function markStock(id, keys, done, user) {
  const list = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k)).slice(0, 5000);
  const d = await mutate('stockdiffs', id, (d) => {
    const valid = new Set(d.changes.map((c) => c.key));
    for (const k of list) {
      if (!valid.has(k)) continue;
      if (done) d.done[k] = { by: user.name, at: Date.now() };
      else delete d.done[k];
    }
    return d;
  });
  if (!d) throw new HttpError(404, 'not_found', 'Ne postoji.');
  return d;
}

export async function deleteStockDiff(id) {
  await remove('stockdiffs', id);
}

/* ================= the morning reminder (Vercel Cron calls /api/cron/daily once a day) ================= */
export async function dailyDigest(now = Date.now()) {
  const today = todayISO(now);
  const key = 'daily:' + today;
  if (await kvGet(key)) return { skipped: true, today };
  await kvSet(key, { at: now }, { silent: true });
  const [tasks, reservations, users] = await Promise.all([all('tasks'), all('reservations'), listUsers()]);
  const open = tasks.filter(isOpenTask);
  const arriving = open.filter((t) => t.expectedAt && t.expectedAt <= today).sort((a, b) => (a.expectedAt < b.expectedAt ? -1 : 1));
  const due = open.filter((t) => t.due && t.due <= today);
  const incomplete = open.filter((t) => t.needsInfo);
  const expiring = reservations.filter((r) => r.status === 'aktivna' && r.until && r.until <= today);
  const label = (t) => `${t.number} ${t.customer?.name || t.title}`.slice(0, 60);
  const list = (xs) => xs.slice(0, 4).map(label).join(', ') + (xs.length > 4 ? ` i još ${xs.length - 4}` : '');
  let sent = 0;
  for (const u of users.filter((x) => !x.disabled)) {
    const mine = (t) => u.role === 'admin' || t.assignee === u.id || t.createdBy?.id === u.id || (t.watchers || []).includes(u.id) || (!t.assignee && t.dept === u.role);
    const parts = [];
    const lines = [];
    if (can(u.role, 'zadaci')) {
      const a = arriving.filter(mine);
      const d = due.filter(mine);
      const n = incomplete.filter(mine);
      if (a.length) { parts.push(`${a.length} ${a.length === 1 ? 'isporuka stiže' : 'isporuke stižu'}`); lines.push('Roba stiže: ' + list(a)); }
      if (d.length) { parts.push(`${d.length} ${d.length === 1 ? 'rok' : 'rokova'}`); lines.push('Rok danas ili kasni: ' + list(d)); }
      if (n.length) { parts.push(`${n.length} za dopuniti`); lines.push('Treba dopuniti: ' + list(n)); }
    }
    if (can(u.role, 'rezervacije') && expiring.length) {
      parts.push(`${expiring.length} ${expiring.length === 1 ? 'rezervacija ističe' : 'rezervacije ističu'}`);
      lines.push('Rezervacije: ' + expiring.slice(0, 4).map((r) => `${r.number} ${r.model}`).join(', '));
    }
    if (!parts.length) continue;
    await notify({ type: 'daily', title: 'Danas: ' + parts.join(', '), body: lines.join('\n'), link: 'pregled', users: [u.id] });
    sent += 1;
  }
  return { today, sent };
}

/* ================= everything one person sees ================= */
export async function dataFor(user) {
  const [tasks, reservations, inbox, diffs, users, settings, latest, shops, skipped] = await Promise.all([
    can(user.role, 'zadaci') ? all('tasks') : [],
    can(user.role, 'rezervacije') ? all('reservations') : [],
    can(user.role, 'prijem') ? all('inbox') : [],
    can(user.role, 'zalihe') ? all('stockdiffs') : [],
    listUsers(),
    getSettings(),
    can(user.role, 'zalihe') ? kvGet('stock_latest') : null,
    listShops(),
    can(user.role, 'prijem') ? all('skipped') : [],
  ]);
  skipped.sort((a, b) => b.at - a.at);
  diffs.sort((a, b) => b.at - a.at);
  inbox.sort((a, b) => b.receivedAt - a.receivedAt);
  return {
    tasks,
    reservations,
    inbox: inbox.filter((x, i) => x.status === 'novo' || i < 150),
    // Full rows for the newest few exports; older ones load when opened.
    stock: diffs.map((d, i) => (i < 3 ? d : { ...d, changes: null })),
    stockLatest: latest ? latest.meta : null,
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role, disabled: !!u.disabled })),
    settings,
    shops: shops.map((sh) => publicShop(sh, { admin: user.role === 'admin' })),
    skipped: skipped.slice(0, 100).map(({ body, ...x }) => ({ ...x, preview: preview(body, 200) })),
  };
}
