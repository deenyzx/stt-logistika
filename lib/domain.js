// The rules: orders and tasks, laptop reservations, comments, the inbox (web shop + email), stock exports.
// API routes stay thin and call these.
import { all, one, insert, mutate, remove, nextSeq, kvGet, kvSet } from './store.js';
import {
  TASK_TYPES, TASK_STATUS, SOURCES, DEPTS, RES_STATUS, RES_PURPOSE, PAYMENT, LIMITS, ROLE_KEYS, can,
} from './constants.js';
import { HttpError, str, isoDate, num, oneOf } from './errors.js';
import { notify, mentionedUsers, withAdmin } from './notify.js';
import { listUsers } from './users.js';
import { toSnapshot, diffSnapshots } from './csv.js';
import { fmtDelta } from './format.js';

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
const participants = (obj) => [obj.createdBy?.id, obj.assignee, ...(obj.comments || []).map((c) => c.by?.id)].filter((x) => x && x !== 'system');

/* ================= orders and tasks ================= */
function taskPatch(input) {
  const p = {};
  if (input.title !== undefined) p.title = str(input.title, LIMITS.title);
  if (input.customer !== undefined) p.customer = { name: str(input.customer?.name, 120), contact: str(input.customer?.contact, 160) };
  if (input.source !== undefined) p.source = oneOf(input.source, SOURCES, 'ostalo');
  if (input.dept !== undefined) p.dept = oneOf(input.dept, DEPTS, 'veleprodaja');
  if (input.due !== undefined) p.due = isoDate(input.due);
  if (input.status !== undefined) p.status = oneOf(input.status, TASK_STATUS, null);
  if (input.items !== undefined) p.items = cleanItems(input.items);
  if (input.note !== undefined) p.note = str(input.note, LIMITS.text);
  if (input.supplier !== undefined) p.supplier = str(input.supplier, 120);
  return p;
}

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
    customer: p.customer || { name: '', contact: '' },
    source: type === 'zadatak' && !input.source ? 'interno' : p.source,
    dept: p.dept,
    supplier: p.supplier || '',
    assignee,
    due: p.due || null,
    status: p.status || 'nova',
    statusAt: now,
    items: p.items || [],
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
  await notify({
    type: 'task_new',
    title: `${saved.number} · ${saved.title}`,
    body: `${user.name || 'Sistem'} · ${SOURCES[saved.source]?.label || ''}${saved.customer.name ? ' · ' + saved.customer.name : ''}`,
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
  const assignee = input.assignee !== undefined ? await checkAssignee(input.assignee) : undefined;
  const users = assignee !== undefined ? await listUsers() : [];
  let before = null;
  const t = await mutate('tasks', id, (t) => {
    before = structuredClone(t);
    Object.assign(t, p);
    if (assignee !== undefined) t.assignee = assignee;
    if (p.status && p.status !== before.status) {
      t.statusAt = Date.now();
      log(t, user, `Status: ${TASK_STATUS[before.status]?.label} → ${TASK_STATUS[p.status].label}`);
    }
    if (assignee !== undefined && assignee !== before.assignee) log(t, user, assignee ? `Dodijeljeno: ${users.find((u) => u.id === assignee)?.name || '?'}` : 'Bez dodjele');
    if (p.due !== undefined && p.due !== before.due) log(t, user, p.due ? `Rok: ${p.due.split('-').reverse().map(Number).join('. ')}.` : 'Rok uklonjen');
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
export async function addInbox({ source, extId, title, from, body, order, receivedAt }, { updateOnly = false } = {}) {
  const id = 'in_' + (await sha(source + ':' + extId)).slice(0, 16);
  const existing = await one('inbox', id);
  if (!existing && updateOnly) return { item: null, ignored: true };
  if (existing) {
    // WooCommerce sends order.updated too: keep the item, refresh what the shop says.
    if (order) await mutate('inbox', id, (o) => { o.order = order; o.body = str(body, 20000) || o.body; return o; });
    return { item: existing, duplicate: true };
  }
  const item = {
    id,
    source,
    extId: String(extId),
    receivedAt: receivedAt || Date.now(),
    title: str(title, 240) || '(bez naslova)',
    from: { name: str(from?.name, 120), email: str(from?.email, 160), phone: str(from?.phone, 60) },
    body: str(body, 20000),
    order: order || null,
    status: 'novo',
    taskId: null,
    comments: [],
    history: [],
    createdAt: Date.now(),
  };
  const saved = await insert('inbox', item);
  const settings = await getSettings();
  if (source === 'web' && settings.autoAcceptWeb) {
    const { task } = await acceptInbox(saved.id, { id: 'system', name: 'Sistem', role: 'admin' }, { dept: settings.webDept });
    return { item: saved, task };
  }
  await notify({
    type: 'inbox_new',
    title: source === 'web' ? `Web narudžba ${order?.number ? '#' + order.number : ''}: ${saved.title}` : `Email: ${saved.title}`,
    body: [saved.from.name || saved.from.email, order?.total != null ? order.total + ' ' + (order.currency || '') : ''].filter(Boolean).join(' · '),
    link: 'prijem/' + saved.id,
    roles: ['veleprodaja'],
  });
  return { item: saved };
}

export async function acceptInbox(id, user, opts = {}) {
  const item = await one('inbox', id);
  if (!item) throw new HttpError(404, 'not_found', 'Ne postoji.');
  if (item.status === 'prihvaceno' && item.taskId) throw new HttpError(409, 'done', 'Već je prihvaćeno kao zadatak.');
  const o = item.order;
  const contact = [item.from.phone, item.from.email].filter(Boolean).join(' · ');
  const note = o
    ? [o.payment && 'Plaćanje: ' + o.payment, o.shipping && 'Dostava: ' + o.shipping, o.customerNote && 'Napomena kupca: ' + o.customerNote, o.total != null && `Ukupno: ${o.total} ${o.currency || ''}`].filter(Boolean).join('\n')
    : item.body.slice(0, LIMITS.text);
  const input = {
    type: 'narudzba',
    title: o ? `Web narudžba #${o.number}${o.items?.[0] ? ': ' + o.items.map((i) => i.name).slice(0, 2).join(', ') : ''}` : item.title,
    customer: { name: item.from.name || item.from.email, contact },
    source: item.source === 'web' ? 'web' : 'email',
    dept: opts.dept || (user.role === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja'),
    assignee: opts.assignee !== undefined ? opts.assignee : user.id === 'system' ? null : user.id,
    items: o?.items || [],
    note,
  };
  const task = await createTask(input, user, { links: { inboxId: item.id, wooId: o?.id || null }, logText: 'Prihvaćeno iz prijema' });
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

export async function setInboxStatus(id, status, user) {
  const item = await mutate('inbox', id, (x) => {
    if (status === 'odbaceno') { x.status = 'odbaceno'; x.handledBy = who(user); x.handledAt = Date.now(); log(x, user, 'Odbačeno'); }
    else if (status === 'novo') { x.status = 'novo'; x.handledBy = null; x.handledAt = null; log(x, user, 'Vraćeno u prijem'); }
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
