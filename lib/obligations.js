// "Moje obaveze": everything waiting on this person, from every part of the app, in one list.
//   Prijenosnice  the sending warehouse answers and ships, the receiving one confirms arrival
//   Upiti MP      veleprodaja answers; whoever asked tells the customer and closes it
//   Rezervacije   veleprodaja confirms forwarded ones; whoever made one sees it run out
//   Prijem        new web shop orders and customers' emails (veleprodaja)
//   Zadaci        open orders and tasks that are theirs (assigned, or unassigned in their department)
// Pure: used by the browser (the list) and the server (tests, counts).
import { transferTodo, transferSides, TASK_STATUS, REQUEST_STATUS, isOpenTask, can } from './constants.js';
import { todayISO, daysFromToday, fmtDue, taskDate } from './format.js';

export const OBLIGATION_KINDS = {
  prijenosnica: { label: 'Prijenosnica', plural: 'Prijenosnice', icon: 'truck', view: 'prijenosnice' },
  upit: { label: 'Upit MP', plural: 'Upiti MP', icon: 'chat', view: 'upiti' },
  rezervacija: { label: 'Rezervacija', plural: 'Rezervacije', icon: 'laptop', view: 'rezervacije' },
  prijem: { label: 'Prijem', plural: 'Prijem', icon: 'inbox', view: 'prijem' },
  zadatak: { label: 'Zadatak', plural: 'Narudžbe i zadaci', icon: 'tasks', view: 'zadaci' },
};

const lines = (t, s) => t.items.filter((i) => i.status === s);
const items = (ls) => ls.map((l) => `${l.qty > 1 ? l.qty + '× ' : ''}${l.name || l.code}`).join(', ');

export function obligationsFor(data, me, now = Date.now()) {
  if (!me) return [];
  const today = todayISO(now);
  const role = me.role;
  const admin = role === 'admin';
  const out = [];
  const add = (o) => out.push({ ...o, view: OBLIGATION_KINDS[o.kind].view, key: o.kind + ':' + o.id });

  /* Prijenosnice */
  for (const t of data.transfers || []) {
    if (t.cancelled) continue;
    const todo = transferTodo(t);
    const side = transferSides(t, me);
    const acts = [];
    if (side.from && todo.from === 'odgovori') acts.push({ text: `Javi dostupnost (${lines(t, 'novi').length})`, tone: 'wait' });
    if (side.from && todo.from === 'otpremi') acts.push({ text: 'Otpremi robu', tone: 'info' });
    if (side.to && todo.to === 'primi') acts.push({ text: 'Potvrdi prijem', tone: 'accent' });
    if (!acts.length) continue;
    const waiting = side.from && todo.from === 'odgovori' ? lines(t, 'novi') : side.from && todo.from === 'otpremi' ? [...lines(t, 'dostupno'), ...lines(t, 'parcijalno')] : lines(t, 'otpremljen');
    add({
      kind: 'prijenosnica', id: t.id, number: t.number, date: t.date,
      title: items(waiting) || t.number,
      route: { from: t.from.name, to: t.to.name },
      sub: t.createdBy?.name,
      actions: acts,
      urgent: daysFromToday(t.date, now) <= -2,
      at: t.updatedAt || t.createdAt,
    });
  }

  /* Upiti MP */
  for (const r of data.requests || []) {
    const mine = r.createdBy?.id === me.id || (role === 'maloprodaja' && r.createdBy?.role === 'maloprodaja');
    let act = null;
    if (r.status === 'novi' && (admin || role === 'veleprodaja')) act = { text: 'Odgovori na upit', tone: 'wait' };
    else if ((r.status === 'dostupno' || r.status === 'nije_dostupno') && (mine || admin)) act = { text: `${REQUEST_STATUS[r.status].label}: javi kupcu i zatvori`, tone: r.status === 'dostupno' ? 'ok' : 'danger' };
    if (!act) continue;
    add({
      kind: 'upit', id: r.id, number: r.number, date: r.date,
      title: [r.name || r.code || r.pn, r.qty > 1 ? '×' + r.qty : ''].filter(Boolean).join(' ') || r.question.slice(0, 80),
      sub: [r.question && r.status === 'novi' ? r.question : r.answer, r.customer && 'Kupac: ' + r.customer].filter(Boolean).join(' · '),
      actions: [act],
      urgent: r.status === 'novi' && daysFromToday(r.date, now) <= -2,
      at: r.answeredAt || r.createdAt,
    });
  }

  /* Rezervacije */
  for (const r of data.reservations || []) {
    const mine = r.createdBy?.id === me.id || (role === 'maloprodaja' && r.createdBy?.role === 'maloprodaja');
    let act = null;
    let urgent = false;
    if (r.status === 'ceka_vp' && (admin || role === 'veleprodaja')) act = { text: 'Potvrdi i odvoji', tone: 'wait' };
    else if (r.status === 'aktivna' && r.until && (mine || admin)) {
      const d = daysFromToday(r.until, now);
      if (d < 0) { act = { text: 'Istekla: preuzeto ili otkaži', tone: 'danger' }; urgent = true; }
      else if (d <= 1) act = { text: `Ističe ${fmtDue(r.until, now)}`, tone: 'wait' };
    }
    if (!act) continue;
    add({
      kind: 'rezervacija', id: r.id, number: r.number, date: todayISO(r.createdAt),
      title: `${r.model}${r.qty > 1 ? ' ×' + r.qty : ''}`,
      sub: [r.customer?.name && 'Za ' + r.customer.name, r.createdBy?.name].filter(Boolean).join(' · '),
      actions: [act],
      urgent,
      at: r.updatedAt || r.createdAt,
    });
  }

  /* Prijem: web shop orders and emails */
  if (can(role, 'prijem')) {
    for (const x of data.inbox || []) {
      if (x.status !== 'novo' || x.kind === 'ostalo') continue;
      const web = x.source === 'web';
      add({
        kind: 'prijem', id: x.id, number: web ? `${x.shopName || 'Web'} #${x.order?.number || ''}` : 'Email', date: todayISO(x.receivedAt),
        title: x.title,
        sub: x.from?.name || x.from?.email || '',
        actions: [{ text: web || x.kind === 'narudzba' ? 'Prihvati narudžbu' : 'Odgovori kupcu', tone: 'accent' }],
        urgent: daysFromToday(todayISO(x.receivedAt), now) <= -2,
        at: x.receivedAt,
      });
    }
  }

  /* Narudžbe i zadaci */
  const myDept = role === 'maloprodaja' ? 'maloprodaja' : role === 'veleprodaja' ? 'veleprodaja' : null;
  for (const t of data.tasks || []) {
    if (!isOpenTask(t)) continue;
    const mine = t.assignee === me.id || (!t.assignee && (admin || t.dept === myDept || t.createdBy?.id === me.id));
    if (!mine) continue;
    const late = t.due && daysFromToday(t.due, now) < 0;
    const arr = t.expectedAt ? daysFromToday(t.expectedAt, now) : null;
    const acts = [];
    if (t.needsInfo) acts.push({ text: 'Dopuni podatke', tone: 'accent' });
    if (t.status === 'ceka_robu' && arr !== null && arr <= 0) acts.push({ text: arr < 0 ? 'Kasni roba' : 'Roba stiže danas', tone: arr < 0 ? 'danger' : 'wait' });
    if (t.status === 'ceka_kalkulaciju') acts.push({ text: 'Ulazna kalkulacija', tone: 'accent' });
    if (t.status === 'za_fakturu') acts.push({ text: 'Fakturisati', tone: 'accent' });
    if (late) acts.push({ text: 'Rok prošao ' + fmtDue(t.due, now), tone: 'danger' });
    if (!acts.length) acts.push({ text: TASK_STATUS[t.status].label, tone: TASK_STATUS[t.status].tone });
    add({
      kind: 'zadatak', id: t.id, number: t.number, date: taskDate(t),
      title: t.title,
      sub: [t.customer?.name, t.due && !late ? 'Rok ' + fmtDue(t.due, now) : ''].filter(Boolean).join(' · '),
      actions: acts,
      urgent: !!late || (arr !== null && arr < 0),
      at: t.updatedAt || t.createdAt,
    });
  }

  // Late first, then newest day first (like the sheet: today's rows on top), then most recently touched.
  return out.sort((a, b) => (b.urgent - a.urgent) || (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
}

/** How many obligations of each kind (for the navigation badges and filter chips). */
export function countByKind(list) {
  const c = {};
  for (const o of list) c[o.kind] = (c[o.kind] || 0) + 1;
  return c;
}

