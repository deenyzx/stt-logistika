// Upiti MP: maloprodaja asks veleprodaja about an article (price, availability, delivery time) for a customer.
// Replaces the UPITI MP sheet: veleprodaja writes the answer and the status, and the answer's date and author are
// recorded by themselves.
import { all, one, insert, mutate, remove, nextSeq } from './store.js';
import { REQUEST_STATUS, LIMITS } from './constants.js';
import { HttpError, str, isoDate, num, oneOf } from './errors.js';
import { notify } from './notify.js';
import { who, newId, pad, log, participants } from './common.js';
import { fillFromStock } from './articles.js';
import { todayISO } from './format.js';

// Who answers upiti, and who works with the customer afterwards.
const ANSWERS = ['admin', 'veleprodaja'];
const title = (r) => r.name || r.code || r.pn || r.question.slice(0, 60);

function patchOf(input) {
  const p = {};
  if (input.date !== undefined) p.date = isoDate(input.date);
  for (const [k, n] of [['pn', 80], ['code', 80], ['name', 200], ['customer', 300]]) if (input[k] !== undefined) p[k] = str(input[k], n);
  if (input.qty !== undefined) p.qty = num(input.qty);
  if (input.question !== undefined) p.question = str(input.question, LIMITS.text);
  return p;
}

export async function createRequest(input, user) {
  const p = patchOf({ qty: 1, ...input });
  if (!p.name && !p.code && !p.pn && !p.question) throw new HttpError(400, 'empty', 'Upiši artikal ili pitanje.');
  if (p.code && !p.name) [p.name] = (await fillFromStock([{ code: p.code, name: '' }])).map((l) => l.name);
  const now = Date.now();
  const n = await nextSeq('U');
  const r = {
    id: newId('rq'),
    number: `U-${pad(n)}`,
    date: p.date || todayISO(now),
    pn: p.pn || '',
    code: p.code || '',
    name: p.name || '',
    qty: p.qty ?? 1,
    customer: p.customer || '',
    question: p.question || '',
    answer: '',
    status: 'novi',
    answeredAt: null,
    answeredBy: null,
    comments: [],
    history: [],
    watchers: [],
    createdBy: who(user),
    createdAt: now,
    updatedAt: now,
  };
  log(r, user, 'Postavio/la upit');
  const saved = await insert('requests', r);
  await notify({
    type: 'rq_new',
    title: `Upit MP ${saved.number}: ${title(saved)}${saved.qty > 1 ? ' ×' + saved.qty : ''}`,
    body: [user.name, saved.question, saved.customer && 'Kupac: ' + saved.customer].filter(Boolean).join(' · '),
    link: 'upiti/' + saved.id,
    roles: ['veleprodaja'],
    by: user,
  });
  return saved;
}

/**
 * input: the question's fields (who asked, or admin), and/or
 *   answer + status 'dostupno' | 'nije_dostupno'   veleprodaja answers (date and name recorded automatically)
 *   status 'zavrseno'                              done (the customer was told)
 *   status 'novi'                                  asked again
 */
export async function updateRequest(id, input, user) {
  const p = patchOf(input);
  let ev = null;
  const r = await mutate('requests', id, (r) => {
    const owner = user.role === 'admin' || r.createdBy?.id === user.id;
    const answerer = ANSWERS.includes(user.role);
    if (Object.keys(p).length) {
      if (!owner) throw new HttpError(403, 'forbidden', 'Upit mijenja onaj ko ga je postavio ili administrator.');
      const prevDate = r.date;
      Object.assign(r, p);
      if (!r.date) r.date = prevDate || todayISO();
    }
    const answer = input.answer !== undefined ? str(input.answer, LIMITS.text) : r.answer;
    const status = input.status !== undefined ? oneOf(input.status, REQUEST_STATUS, null) : null;
    if (input.status !== undefined && !status) throw new HttpError(400, 'bad_status', 'Nepoznat status.');
    const answering = (input.answer !== undefined && answer !== r.answer) || status === 'dostupno' || status === 'nije_dostupno';
    if (answering) {
      if (!answerer) throw new HttpError(403, 'forbidden', 'Na upit odgovara veleprodaja.');
      if (!answer) throw new HttpError(400, 'no_answer', 'Upiši odgovor (cijena, rok, detalji).');
      r.answer = answer;
      if (status) r.status = status;
      else if (r.status === 'novi' || r.status === 'zavrseno') r.status = 'dostupno';
      r.answeredAt = Date.now();
      r.answeredBy = who(user);
      r.closedAt = null;
      log(r, user, `Odgovor (${REQUEST_STATUS[r.status].label}): ${answer.slice(0, 120)}`);
      ev = 'answer';
    } else if (status && status !== r.status) {
      if (status === 'zavrseno') { r.closedAt = Date.now(); ev = 'done'; }
      if (status === 'novi') { r.closedAt = null; ev = 'again'; }
      log(r, user, `Status: ${REQUEST_STATUS[r.status].label} → ${REQUEST_STATUS[status].label}`);
      r.status = status;
    }
    return r;
  });
  if (!r) throw new HttpError(404, 'not_found', 'Ne postoji (možda je obrisano).');
  const people = participants(r);
  if (ev === 'answer') {
    await notify({
      type: 'rq_update',
      title: `Odgovor na ${r.number} ${title(r)}: ${REQUEST_STATUS[r.status].label}`,
      body: `${user.name}: ${r.answer}`,
      link: 'upiti/' + r.id,
      roles: r.createdBy?.role === 'maloprodaja' ? ['maloprodaja'] : [],
      users: people,
      by: user,
    });
  } else if (ev === 'again') {
    await notify({ type: 'rq_new', title: `${r.number} ponovo čeka odgovor: ${title(r)}`, body: user.name, link: 'upiti/' + r.id, roles: ['veleprodaja'], users: people, by: user });
  }
  return r;
}

export async function deleteRequest(id, user) {
  const r = await one('requests', id);
  if (!r) return;
  if (user.role !== 'admin' && r.createdBy?.id !== user.id) throw new HttpError(403, 'forbidden', 'Brisati može onaj ko je postavio upit ili administrator.');
  await remove('requests', id);
}

export const listRequests = () => all('requests');
