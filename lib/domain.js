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
export const DEFAULT_SETTINGS = { stockMapping: { key: '', qty: '', name: '' }, autoAcceptWeb: false, webDept: 'veleprodaja' };

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
  ].filter(Boolean).join('\n');
}

async function notifyInbox(item) {
  if (item.kind === 'ostalo') return; // newsletters and robots: visible in Prijem, no notification
  if (item.source === 'web') {
    const o = item.order || {};
    await notify({
      type: 'inbox_web',
      title: [`Web narudžba #${o.number}`, o.total != null ? fmtMoney(o.total, o.currency) : '', o.status && o.status !== 'processing' ? o.statusLabel : ''].filter(Boolean).join(' · '),
      body: webOrderText(o, item.from),
      link: 'prijem/' + item.id,
      roles: ['veleprodaja'],
    });
    return;
  }
  const order = item.kind === 'narudzba';
  await notify({
    type: order ? 'inbox_email_order' : 'inbox_email_msg',
    title: `${order ? 'Narudžba emailom' : 'Email kupca'}: ${item.title}`,
    body: `Od: ${fromLabel(item.from)}${item.from.phone ? ' · ' + item.from.phone : ''}\n${preview(item.body, 420)}`,
    link: 'prijem/' + item.id,
    roles: ['veleprodaja'],
  });
}

export async function addInbox(input, { updateOnly = false } = {}) {
  const { source, extId, title, from, body, order, receivedAt } = input;
  const id = 'in_' + (await sha(source + ':' + extId)).slice(0, 16);
  const existing = await one('inbox', id);
  if (!existing && updateOnly) return { item: null, ignored: true };
  if (existing) {
    // WooCommerce sends order.updated too: keep the item, refresh what the shop says, and tell people if the
    // shop's status changed (e.g. the customer cancelled or the payment went through).
    if (order) {
      const prev = existing.order?.status;
      const changed = prev && order.status && prev !== order.status;
      await mutate('inbox', id, (o) => {
        o.order = order;
        o.body = str(body, 20000) || o.body;
        if (changed) log(o, null, `Status u web shopu: ${existing.order.statusLabel || prev} → ${order.statusLabel || order.status}`);
        return o;
      });
      if (changed) {
        const task = existing.taskId ? await one('tasks', existing.taskId) : null;
        if (task) await mutate('tasks', task.id, (t) => { log(t, null, `Web shop: narudžba je sada „${order.statusLabel || order.status}”`); return t; });
        await notify({
          type: 'inbox_web',
          title: `Web narudžba #${order.number}: ${order.statusLabel || order.status}`,
          body: `Status u web shopu je promijenjen iz „${existing.order.statusLabel || prev}” u „${order.statusLabel || order.status}”.${task ? ' Narudžba ' + task.number + '.' : ''}`,
          link: task ? 'zadaci/' + task.id : 'prijem/' + id,
          roles: ['veleprodaja'],
          users: task ? participants(task) : [],
        });
      }
    }
    return { item: existing, duplicate: true };
  }
  // The shop's own "Nova narudžba #2294" email for an order the webhook already brought in: don't add it twice.
  if (source === 'email' && input.orderRef) {
    const web = (await all('inbox')).find((x) => x.source === 'web' && x.order?.number === input.orderRef);
    if (web) return { item: web, duplicate: true, sameAs: web.id };
  }
  const item = {
    id,
    source,
    kind: source === 'web' ? 'narudzba' : oneOf(input.kind, INBOX_KIND, 'upit'),
    orderRef: str(input.orderRef, 20),
    extId: String(extId),
    receivedAt: receivedAt || Date.now(),
    title: str(title, 240) || '(bez naslova)',
    from: { name: str(from?.name, 120), email: str(from?.email, 160), phone: str(from?.phone, 60), address: str(from?.address, 240) },
    body: str(body, 20000),
    order: order || null,
    status: 'novo',
    taskId: null,
    comments: [],
    history: [],
    createdAt: Date.now(),
  };
  const saved = await insert('inbox', item);
  // The web order arrived after the shop's email about it: the email is done.
  if (source === 'web' && order?.number) {
    const twins = (await all('inbox')).filter((x) => x.source === 'email' && x.orderRef === order.number && x.status === 'novo');
    for (const tw of twins) await mutate('inbox', tw.id, (x) => { x.status = 'rijeseno'; x.sameAs = saved.id; log(x, null, `Isto kao web narudžba #${order.number}`); return x; });
  }
  const settings = await getSettings();
  if (source === 'web' && settings.autoAcceptWeb) {
    const { task } = await acceptInbox(saved.id, { id: 'system', name: 'Sistem', role: 'admin' }, { dept: settings.webDept });
    return { item: saved, task };
  }
  await notifyInbox(saved);
  return { item: saved };
}

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
      title: `Web narudžba #${o.number}${o.items?.[0] ? ': ' + o.items.map((i) => i.name).slice(0, 2).join(', ') : ''}`,
      items: o.items || [],
      payment: o.payment,
      delivery: [o.shippingMethod, o.address].filter(Boolean).join(' · '),
      total: o.total,
      note: o.customerNote ? 'Napomena kupca: ' + o.customerNote : '',
    };
  } else if (as === 'zadatak') {
    input = { ...base, type: 'zadatak', title: 'Odgovoriti: ' + item.title.replace(/^((re|fw|fwd|odg)\s*:\s*)+/i, ''), note: snippet(item.body, LIMITS.text) };
  } else {
    // An order that came by email: the details are in the text, so it is marked to be filled in.
    input = { ...base, type: 'narudzba', title: item.title.replace(/^((re|fw|fwd|odg)\s*:\s*)+/i, ''), note: snippet(item.body, LIMITS.text), needsInfo: true };
  }
  const task = await createTask(input, user, {
    links: { inboxId: item.id, wooId: o?.id || null, wooUrl: o?.url || '' },
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

export async function setInboxKind(id, kind, user) {
  const k = oneOf(kind, INBOX_KIND, null);
  if (!k) throw new HttpError(400, 'bad_kind', 'Nepoznata vrsta.');
  const item = await mutate('inbox', id, (x) => {
    if (x.source === 'web' || x.kind === k) return null;
    log(x, user, 'Vrsta: ' + INBOX_KIND[k].label);
    x.kind = k;
    return x;
  });
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  return item;
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
  const [tasks, reservations, inbox, diffs, users, settings, latest] = await Promise.all([
    can(user.role, 'zadaci') ? all('tasks') : [],
    can(user.role, 'rezervacije') ? all('reservations') : [],
    can(user.role, 'prijem') ? all('inbox') : [],
    can(user.role, 'zalihe') ? all('stockdiffs') : [],
    listUsers(),
    getSettings(),
    can(user.role, 'zalihe') ? kvGet('stock_latest') : null,
  ]);
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
  };
}
