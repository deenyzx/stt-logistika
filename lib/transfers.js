// Prijenosnice: goods moving from one warehouse (polazno skladište) to another (dolazno skladište), usually from the
// VP skladište to a maloprodaja. Replaces the PRIJENOSNICE sheet: one prijenosnica holds one or more lines, and each
// line has its own status. The sending side answers (Dostupno / Parcijalno dostupan / Nedostupno) and ships
// (Otpremljen); the receiving side confirms it arrived (Primljen, with the date).
import { all, one, insert, mutate, remove, nextSeq, kvGet } from './store.js';
import {
  LINE_STATUS, TRANSFER_STATUS, KIND_ROLE, DEFAULT_WAREHOUSES, LIMITS, transferStatus, transferSides,
} from './constants.js';
import { HttpError, str, isoDate, num, oneOf } from './errors.js';
import { notify } from './notify.js';
import { who, newId, pad, log, participants } from './common.js';
import { fillFromStock } from './articles.js';
import { todayISO, fmtDate, fmtQty } from './format.js';

export async function warehouses() {
  return (await kvGet('settings'))?.warehouses || DEFAULT_WAREHOUSES;
}

// The warehouse as it was when the prijenosnica was made (its name stays readable if it is renamed later).
function pickWarehouse(list, id, label) {
  const w = list.find((x) => x.id === id);
  if (!w) throw new HttpError(400, 'bad_warehouse', `Izaberi ${label}.`);
  return { id: w.id, name: w.name, kind: w.kind };
}

const lineName = (l) => [l.qty != null ? fmtQty(l.qty) + '×' : '', l.name || l.code, l.code && l.name ? `(${l.code})` : ''].filter(Boolean).join(' ');
const route = (t) => `${t.from.name} → ${t.to.name}`;

function cleanLines(items, prev = []) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, LIMITS.items).map((i) => {
    const old = prev.find((p) => p.id && p.id === i?.id);
    return {
      id: old?.id || newId('l'),
      code: str(i?.code, 60),
      name: str(i?.name, 200),
      qty: num(i?.qty) ?? 1,
      buy: num(i?.buy),
      sell: num(i?.sell),
      note: str(i?.note, 500),
      status: old?.status || 'novi',
      sentQty: old?.sentQty ?? null,
      statusAt: old?.statusAt || null,
      statusBy: old?.statusBy || null,
      shippedAt: old?.shippedAt || null,
      receivedOn: old?.receivedOn || null,
    };
  }).filter((l) => l.code || l.name);
}

export async function createTransfer(input, user) {
  const list = await warehouses();
  const from = pickWarehouse(list, input.from, 'polazno skladište');
  const to = pickWarehouse(list, input.to, 'dolazno skladište');
  if (from.id === to.id) throw new HttpError(400, 'same', 'Polazno i dolazno skladište ne mogu biti isto.');
  const items = await fillFromStock(cleanLines(input.items));
  if (!items.length) throw new HttpError(400, 'no_items', 'Dodaj bar jedan artikal (šifru ili naziv).');
  const now = Date.now();
  const n = await nextSeq('PR');
  const t = {
    id: newId('tr'),
    number: `PR-${pad(n)}`,
    date: isoDate(input.date) || todayISO(now),
    from,
    to,
    items,
    note: str(input.note, LIMITS.text),
    cancelled: false,
    comments: [],
    history: [],
    watchers: [],
    createdBy: who(user),
    createdAt: now,
    updatedAt: now,
  };
  t.status = transferStatus(t);
  const first = str(input.comment, LIMITS.comment);
  if (first) t.comments.push({ id: newId('c'), at: now, by: who(user), text: first });
  log(t, user, `Napravio/la prijenosnicu: ${route(t)}`);
  const saved = await insert('transfers', t);
  await notify({
    type: 'tr_new',
    title: `Nova prijenosnica ${saved.number}: ${route(saved)}`,
    body: `${user.name} · ${saved.items.map(lineName).join(', ')}`.slice(0, 600),
    link: 'prijenosnice/' + saved.id,
    roles: [KIND_ROLE[from.kind]],
    by: user,
  });
  return saved;
}

/**
 * Changes a prijenosnica. input may hold:
 *   date, from, to, note, items      the content (who made it, or admin; not after something was shipped)
 *   lines: [{ id, status, sentQty, note }]   per-line status: answer and ship (sending side), receive (receiving side)
 *   action: 'ship' | 'receive' | 'cancel' | 'reopen'
 *   receivedOn: 'YYYY-MM-DD'          the day it arrived (default today)
 */
export async function updateTransfer(id, input, user) {
  const list = input.from || input.to ? await warehouses() : null;
  const fresh = input.items ? await fillFromStock(cleanLines(input.items)) : null;
  const ev = { answered: [], shipped: [], received: [], cancelled: false, reopened: false };
  let before = null;
  const t = await mutate('transfers', id, (t) => {
    before = structuredClone(t);
    const side = transferSides(t, user);
    const owner = user.role === 'admin' || t.createdBy?.id === user.id;
    const moved = t.items.some((i) => i.status === 'otpremljen' || i.status === 'primljen');
    const now = Date.now();
    const today = todayISO(now);

    if (input.date !== undefined || input.from || input.to || fresh || input.note !== undefined) {
      if (!owner && !side.from && !side.to) throw new HttpError(403, 'forbidden', 'Ovu prijenosnicu mijenja onaj ko ju je napravio ili administrator.');
      if (input.date !== undefined) t.date = isoDate(input.date) || t.date;
      if (input.note !== undefined) t.note = str(input.note, LIMITS.text);
      if (input.from || input.to || fresh) {
        if (!owner) throw new HttpError(403, 'forbidden', 'Artikle i skladišta mijenja onaj ko je napravio prijenosnicu ili administrator.');
        if (moved) throw new HttpError(409, 'moved', 'Roba je već otpremljena, pa se artikli i skladišta više ne mijenjaju. Napravi novu prijenosnicu.');
        if (input.from) t.from = pickWarehouse(list, input.from, 'polazno skladište');
        if (input.to) t.to = pickWarehouse(list, input.to, 'dolazno skladište');
        if (t.from.id === t.to.id) throw new HttpError(400, 'same', 'Polazno i dolazno skladište ne mogu biti isto.');
        if (fresh) {
          const kept = fresh.map((l) => {
            const old = before.items.find((p) => p.id === l.id);
            return old && (old.code !== l.code || old.qty !== l.qty) ? { ...l, status: 'novi', statusAt: null, statusBy: null, sentQty: null } : l;
          });
          if (!kept.length) throw new HttpError(400, 'no_items', 'Prijenosnica mora imati bar jedan artikal.');
          t.items = kept;
        }
        log(t, user, 'Izmijenio/la prijenosnicu');
      }
    }

    const setLine = (l, status, extra = {}) => {
      l.status = status;
      l.statusAt = now;
      l.statusBy = user.name;
      Object.assign(l, extra);
    };

    for (const ch of Array.isArray(input.lines) ? input.lines : []) {
      const l = t.items.find((x) => x.id === ch?.id);
      if (!l) continue;
      if (ch.note !== undefined && str(ch.note, 500) !== l.note) l.note = str(ch.note, 500);
      if (ch.sentQty !== undefined) {
        if (!side.from) throw new HttpError(403, 'forbidden', `Količinu koja ide javlja ${t.from.name}.`);
        l.sentQty = num(ch.sentQty);
      }
      const s = ch.status ? oneOf(ch.status, LINE_STATUS, null) : null;
      if (!s || s === l.status) continue;
      if (['novi', 'dostupno', 'parcijalno', 'nedostupno'].includes(s)) {
        if (!side.from) throw new HttpError(403, 'forbidden', `Dostupnost javlja ${t.from.name} (polazno skladište).`);
        if (l.status === 'primljen') throw new HttpError(409, 'received', 'Artikal je već primljen.');
        setLine(l, s, { shippedAt: null });
        ev.answered.push(l);
      } else if (s === 'otpremljen') {
        if (l.status === 'primljen') {
          if (!side.to) throw new HttpError(403, 'forbidden', `Prijem potvrđuje ${t.to.name}.`);
          setLine(l, s, { receivedOn: null });
          log(t, user, `${l.name || l.code}: prijem poništen`);
          continue;
        }
        if (!side.from) throw new HttpError(403, 'forbidden', `Otpremu javlja ${t.from.name} (polazno skladište).`);
        if (l.status === 'nedostupno') throw new HttpError(409, 'unavailable', 'Artikal je označen kao nedostupan.');
        setLine(l, s, { shippedAt: now });
        ev.shipped.push(l);
      } else if (s === 'primljen') {
        if (!side.to) throw new HttpError(403, 'forbidden', `Prijem potvrđuje ${t.to.name} (dolazno skladište).`);
        if (l.status !== 'otpremljen') throw new HttpError(409, 'not_shipped', 'Prvo mora biti otpremljeno.');
        setLine(l, s, { receivedOn: isoDate(input.receivedOn) || today });
        ev.received.push(l);
      }
    }

    if (input.action === 'ship') {
      if (!side.from) throw new HttpError(403, 'forbidden', `Otpremu javlja ${t.from.name} (polazno skladište).`);
      for (const l of t.items) if (l.status === 'dostupno' || l.status === 'parcijalno') { setLine(l, 'otpremljen', { shippedAt: now }); ev.shipped.push(l); }
      if (!ev.shipped.length) throw new HttpError(409, 'nothing', 'Nema artikala označenih kao dostupni.');
    }
    if (input.action === 'receive') {
      if (!side.to) throw new HttpError(403, 'forbidden', `Prijem potvrđuje ${t.to.name} (dolazno skladište).`);
      const day = isoDate(input.receivedOn) || today;
      for (const l of t.items) if (l.status === 'otpremljen') { setLine(l, 'primljen', { receivedOn: day }); ev.received.push(l); }
      if (!ev.received.length) throw new HttpError(409, 'nothing', 'Ništa nije na putu.');
    }
    if (input.action === 'cancel') {
      if (!owner && !side.from) throw new HttpError(403, 'forbidden', 'Otkazati može onaj ko je napravio, polazno skladište ili administrator.');
      if (t.items.some((i) => i.status === 'otpremljen')) throw new HttpError(409, 'on_way', 'Roba je na putu. Prvo je primi ili vrati status.');
      t.cancelled = true;
      ev.cancelled = true;
      log(t, user, 'Otkazao/la prijenosnicu');
    }
    if (input.action === 'reopen' && t.cancelled) {
      if (!owner && !side.from) throw new HttpError(403, 'forbidden', 'Nemaš pravo na ovo.');
      t.cancelled = false;
      ev.reopened = true;
      log(t, user, 'Vratio/la prijenosnicu');
    }

    if (ev.answered.length) log(t, user, 'Dostupnost: ' + ev.answered.map((l) => `${l.name || l.code} → ${LINE_STATUS[l.status].label}`).join(', '));
    if (ev.shipped.length) log(t, user, `Otpremljeno iz ${t.from.name}: ` + ev.shipped.map(lineName).join(', '));
    if (ev.received.length) log(t, user, `Primljeno u ${t.to.name} ${fmtDate(ev.received[0].receivedOn)}: ` + ev.received.map(lineName).join(', '));
    t.status = transferStatus(t);
    if (TRANSFER_STATUS[t.status] && ['primljena', 'nedostupna', 'otkazana'].includes(t.status)) t.closedAt = t.closedAt || now;
    else t.closedAt = null;
    return t;
  });
  if (!t) throw new HttpError(404, 'not_found', 'Ne postoji (možda je obrisano).');

  const people = participants(t);
  const toRole = KIND_ROLE[t.to.kind];
  const fromRole = KIND_ROLE[t.from.kind];
  const link = 'prijenosnice/' + t.id;
  if (ev.answered.length) {
    const by = Object.entries(ev.answered.reduce((a, l) => ({ ...a, [l.status]: (a[l.status] || 0) + 1 }), {}))
      .map(([s, n]) => `${n} ${LINE_STATUS[s].label.toLowerCase()}`).join(', ');
    await notify({ type: 'tr_update', title: `${t.number}: ${t.from.name} javlja dostupnost (${by})`, body: ev.answered.map((l) => `${lineName(l)}: ${LINE_STATUS[l.status].label}${l.note ? ' · ' + l.note : ''}`).join('\n'), link, roles: [toRole], users: people, by: user });
  }
  if (ev.shipped.length) {
    await notify({ type: 'tr_update', title: `${t.number} otpremljena: ${route(t)}`, body: ev.shipped.map(lineName).join(', '), link, roles: [toRole], users: people, by: user });
  }
  if (ev.received.length) {
    await notify({ type: 'tr_update', title: `${t.number} primljena u ${t.to.name}`, body: ev.received.map(lineName).join(', '), link, roles: [fromRole], users: people, by: user });
  }
  if (ev.cancelled || ev.reopened) {
    await notify({ type: 'tr_update', title: `${t.number} ${ev.cancelled ? 'otkazana' : 'vraćena'}: ${route(t)}`, body: user.name, link, roles: [fromRole, toRole], users: people, by: user });
  }
  return t;
}

export async function deleteTransfer(id, user) {
  const t = await one('transfers', id);
  if (!t) return;
  if (user.role !== 'admin' && t.createdBy?.id !== user.id) throw new HttpError(403, 'forbidden', 'Brisati može onaj ko je napravio ili administrator. Možeš je otkazati.');
  if (user.role !== 'admin' && t.items.some((i) => i.status === 'otpremljen' || i.status === 'primljen')) throw new HttpError(409, 'moved', 'Roba je već otpremljena; prijenosnica ostaje zbog evidencije. Možeš je otkazati.');
  await remove('transfers', id);
}

export const listTransfers = () => all('transfers');
