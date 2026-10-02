// What replaces the STT_KupiLenovo_MP_VP sheet: prijenosnice (polazno → dolazno skladište, per-line status), upiti MP
// (answer date recorded by itself), reservations forwarded to veleprodaja, article lookups from the stock export, and
// "Moje obaveze" combining it all. In-memory store.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = 'admin-test-pw';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const { createUser } = await import('../lib/users.js');
const d = await import('../lib/domain.js');
const tr = await import('../lib/transfers.js');
const rq = await import('../lib/requests.js');
const { findArticles } = await import('../lib/articles.js');
const { obligationsFor } = await import('../lib/obligations.js');
const { notificationsFor } = await import('../lib/notify.js');
const { todayISO, addDaysISO } = await import('../lib/format.js');

const din = await createUser({ username: 'din', name: 'Din', role: 'veleprodaja', password: 'lozinka1' });
const amra = await createUser({ username: 'amra', name: 'Amra', role: 'maloprodaja', password: 'lozinka3' });
const lejla = await createUser({ username: 'lejla', name: 'Lejla', role: 'maloprodaja', password: 'lozinka4' });
const today = todayISO();
const latest = async (u, type) => (await notificationsFor(u)).list.find((n) => n.type === type);
const todo = async (u) => obligationsFor(await d.dataFor(u), u);

await d.ingestStock('Šifra;Naziv;Stanje;Nabavna cijena;Prodajna cijena\n1894;Miš Lenovo Legion M600 Wireless;7;45,00;89,00\n6245;Emtec X210G Portable SSD 500GB;2;60,00;119,00\n', { filename: 'stanje.csv' });

test('a code is enough: name, prices and free VP stock come from the stock export', async () => {
  const { items } = await findArticles({ code: ' 1894 ' });
  assert.deepEqual(items[0], { code: '1894', name: 'Miš Lenovo Legion M600 Wireless', qty: 7, reserved: 0, free: 7, buy: 45, sell: 89 });
  assert.equal((await findArticles({ q: 'legion' })).items[0].code, '1894');
  assert.equal((await findArticles({ code: '9999' })).items.length, 0);
});

test('prijenosnica: MP asks, VP answers per line and ships, MP confirms arrival', async () => {
  const t = await tr.createTransfer({ from: 'vp', to: 'mp', items: [{ code: '1894', qty: 3 }, { code: '6245', qty: 1 }, { name: 'powerbank baseus 20k mAh', qty: 1 }] }, amra);
  assert.match(t.number, /^PR-\d{4}$/);
  assert.equal(t.date, today);
  assert.deepEqual([t.from.name, t.to.name], ['VP skladište', 'Maloprodaja KupiLenovo']);
  assert.equal(t.items[0].name, 'Miš Lenovo Legion M600 Wireless', 'filled from the code');
  assert.equal(t.items[0].sell, 89);
  assert.equal(t.status, 'nova');
  assert.match((await latest(din, 'tr_new')).title, /PR-\d{4}: VP skladište → Maloprodaja KupiLenovo/);
  assert.equal(await latest(amra, 'tr_new'), undefined, 'the one who made it is not notified');

  // The sending side (veleprodaja) has to answer; the receiving side has nothing to do yet.
  assert.deepEqual((await todo(din)).filter((o) => o.kind === 'prijenosnica').map((o) => o.actions[0].text), ['Javi dostupnost (3)']);
  assert.equal((await todo(amra)).filter((o) => o.kind === 'prijenosnica').length, 0);

  await assert.rejects(() => tr.updateTransfer(t.id, { lines: [{ id: t.items[0].id, status: 'dostupno' }] }, amra), /polazno skladište/);
  const [a, b, c] = t.items;
  let x = await tr.updateTransfer(t.id, { lines: [{ id: a.id, status: 'dostupno' }, { id: b.id, status: 'parcijalno', sentQty: 1, note: 'Naručeno dva' }, { id: c.id, status: 'nedostupno' }] }, din);
  assert.equal(x.status, 'za_otpremu');
  assert.match((await latest(amra, 'tr_update')).title, /javlja dostupnost \(1 dostupno, 1 parcijalno dostupan, 1 nedostupno\)/);

  x = await tr.updateTransfer(t.id, { action: 'ship' }, din);
  assert.equal(x.status, 'na_putu');
  assert.deepEqual(x.items.map((i) => i.status), ['otpremljen', 'otpremljen', 'nedostupno']);
  assert.match((await latest(amra, 'tr_update')).title, /otpremljena: VP skladište → Maloprodaja KupiLenovo/);
  assert.deepEqual((await todo(amra)).filter((o) => o.kind === 'prijenosnica').map((o) => o.actions[0].text), ['Potvrdi prijem']);
  await assert.rejects(() => tr.updateTransfer(t.id, { items: [{ code: '1894', qty: 5 }] }, amra), /već otpremljena/);

  await assert.rejects(() => tr.updateTransfer(t.id, { action: 'receive' }, din), /dolazno skladište/);
  const day = addDaysISO(today, -1);
  x = await tr.updateTransfer(t.id, { action: 'receive', receivedOn: day }, amra);
  assert.equal(x.status, 'primljena');
  assert.deepEqual(x.items.map((i) => i.receivedOn), [day, day, null]);
  assert.match((await latest(din, 'tr_update')).title, /primljena u Maloprodaja KupiLenovo/);
  assert.equal((await todo(din)).filter((o) => o.kind === 'prijenosnica').length, 0);
  assert.ok(x.history.some((h) => /Primljeno u Maloprodaja KupiLenovo/.test(h.text)));
});

test('a prijenosnica can go the other way (MP → VP), and the sides swap', async () => {
  const t = await tr.createTransfer({ from: 'mp', to: 'vp', items: [{ name: 'Povrat: oštećena kutija', qty: 1 }] }, amra);
  assert.match((await latest(lejla, 'tr_new')).title, /Maloprodaja KupiLenovo → VP skladište/, 'now maloprodaja answers');
  assert.equal((await todo(amra)).find((o) => o.id === t.id).actions[0].text, 'Javi dostupnost (1)');
  await assert.rejects(() => tr.createTransfer({ from: 'vp', to: 'vp', items: [{ name: 'x' }] }, amra), /ne mogu biti isto/);
});

test('upit MP: veleprodaja answers, the date is recorded by itself, maloprodaja closes it', async () => {
  const r = await rq.createRequest({ name: 'oled laptop', qty: 1, customer: 'Rihad 062 994 111', question: 'najjeftiniji laptop s OLED ekranom ili 100% sRGB' }, amra);
  assert.equal(r.status, 'novi');
  assert.match((await latest(din, 'rq_new')).title, /Upit MP U-\d{4}: oled laptop/);
  assert.equal((await todo(din)).find((o) => o.id === r.id).actions[0].text, 'Odgovori na upit');
  await assert.rejects(() => rq.updateRequest(r.id, { answer: 'x', status: 'dostupno' }, amra), /odgovara veleprodaja/);
  const a = await rq.updateRequest(r.id, { answer: '82X3003HMX, u dolasku za 15 dana 1570 KM', status: 'dostupno' }, din);
  assert.equal(a.status, 'dostupno');
  assert.equal(a.answeredBy.name, 'Din');
  assert.ok(Date.now() - a.answeredAt < 5000);
  assert.match((await latest(amra, 'rq_update')).body, /1570 KM/);
  assert.equal((await todo(amra)).find((o) => o.id === r.id).actions[0].text, 'Dostupno: javi kupcu i zatvori');
  const done = await rq.updateRequest(r.id, { status: 'zavrseno' }, amra);
  assert.equal(done.status, 'zavrseno');
  assert.ok(!(await todo(amra)).some((o) => o.id === r.id));
});

test('reservations from maloprodaja go to veleprodaja to confirm; reserved stock is taken off', async () => {
  const r = await d.createReservation({ model: 'Miš Lenovo Legion M600 Wireless', code: '1894', qty: 2, customer: { name: 'Haris', phone: '061 773 662' }, purposeType: 'prodaja', payment: 'gotovina', until: addDaysISO(today, 3) }, amra);
  assert.equal(r.status, 'ceka_vp');
  assert.match((await latest(din, 'res_new')).title, /Rezervacija za potvrdu R-\d{4}/);
  assert.equal((await todo(din)).find((o) => o.id === r.id).actions[0].text, 'Potvrdi i odvoji');
  assert.equal((await findArticles({ code: '1894' })).items[0].free, 5, '7 in stock, 2 reserved');
  await assert.rejects(() => d.updateReservation(r.id, { status: 'aktivna' }, amra), /potvrđuje veleprodaja/);
  const ok = await d.updateReservation(r.id, { status: 'aktivna' }, din);
  assert.equal(ok.confirmedBy.name, 'Din');
  assert.match((await latest(amra, 'res_status')).title, /potvrđena: Miš Lenovo Legion M600 Wireless je odvojen/);
  const own = await d.createReservation({ model: 'Lenovo Digital Pen 2', purposeType: 'izlog' }, din);
  assert.equal(own.status, 'aktivna', 'veleprodaja’s own reservation needs no confirmation');
});

test('Moje obaveze puts what is late on top and covers every part of the app', async () => {
  await d.createTask({ title: 'Ponuda za 25 monitora', status: 'u_obradi', dept: 'veleprodaja', due: addDaysISO(today, -1) }, din);
  await rq.createRequest({ name: 'canon r100', question: 'nabavljamo li kamere uopšte?' }, amra);
  const list = await todo(din);
  assert.equal(list[0].kind, 'zadatak');
  assert.equal(list[0].urgent, true);
  assert.ok(list[0].actions.some((a) => /Rok prošao/.test(a.text)));
  const kinds = new Set(list.map((o) => o.kind));
  for (const k of ['zadatak', 'upit']) assert.ok(kinds.has(k), k);
});

test('settings: warehouses can be renamed and added, but VP and MP must both exist', async () => {
  const s = await d.saveSettings({ warehouses: [{ id: 'vp', name: 'Centralno skladište', kind: 'vp' }, { id: 'mp', name: 'KupiLenovo Sarajevo', kind: 'mp' }, { name: 'KupiLenovo Tuzla', kind: 'mp' }] });
  assert.deepEqual(s.warehouses.map((w) => w.id), ['vp', 'mp', 'kupilenovo-tuzla']);
  await assert.rejects(() => d.saveSettings({ warehouses: [{ name: 'Samo MP', kind: 'mp' }] }), /bar jedno skladište veleprodaje/);
  const t = await tr.createTransfer({ from: 'vp', to: 'kupilenovo-tuzla', items: [{ code: '6245' }] }, amra);
  assert.equal(t.to.name, 'KupiLenovo Tuzla');
});

test('CSV export: one row per prijenosnica line, semicolons, decimal commas, Excel BOM', async () => {
  const { EXPORTS } = await import('../lib/exportCsv.js');
  const { all } = await import('../lib/store.js');
  const csv = EXPORTS.prijenosnice.build({ transfers: await all('transfers') });
  assert.ok(csv.startsWith('﻿Broj;Datum;Polazno skladište;Dolazno skladište;'));
  const row = csv.split('\r\n').find((l) => l.includes('Miš Lenovo Legion M600 Wireless'));
  assert.match(row, /;VP skladište;Maloprodaja KupiLenovo;Primljena;1894;Miš Lenovo Legion M600 Wireless;3;;45;89;267;Primljen;/);
  const up = EXPORTS.upiti.build({ requests: await all('requests') });
  assert.match(up, /"82X3003HMX, u dolasku za 15 dana 1570 KM"|82X3003HMX, u dolasku za 15 dana 1570 KM/);
  const res = EXPORTS.rezervacije.build({ reservations: await all('reservations') });
  assert.match(res, /;Miš Lenovo Legion M600 Wireless;1894;2;;Haris;061 773 662;Prodaja kupcu;;Gotovina;;[\d-]+;Aktivna;Din;Amra;/);
});
