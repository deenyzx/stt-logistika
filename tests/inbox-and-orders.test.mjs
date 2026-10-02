// Prijem sorting, full-detail notifications, quick orders, arrival dates, watching, personal settings, the morning
// reminder. In-memory store (no Redis env vars).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = 'admin-test-pw';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const { createUser } = await import('../lib/users.js');
const d = await import('../lib/domain.js');
const { notificationsFor } = await import('../lib/notify.js');
const { prefsSet } = await import('../lib/store.js');
const { emailToInbox, wooOrderToInbox, classifyEmail } = await import('../lib/integrations.js');
const { todayISO, addDaysISO } = await import('../lib/format.js');

const din = await createUser({ username: 'din', name: 'Din', role: 'veleprodaja', password: 'lozinka1' });
const selma = await createUser({ username: 'selma', name: 'Selma', role: 'veleprodaja', password: 'lozinka2' });
const amra = await createUser({ username: 'amra', name: 'Amra', role: 'maloprodaja', password: 'lozinka3' });
const today = todayISO();
const latest = async (u, type) => (await notificationsFor(u)).list.find((n) => n.type === type);

const woo = {
  id: 3001, number: '3001', status: 'processing', currency: 'BAM', total: '1798.00', date_created_gmt: '2026-09-29T08:00:00',
  payment_method_title: 'Plaćanje pouzećem', customer_note: 'Zvati prije dostave',
  billing: { first_name: 'Mirza', last_name: 'T.', email: 'mirza@example.com', phone: '066 777 888', city: 'Sarajevo', address_1: 'Titova 1', postcode: '71000' },
  shipping: {}, shipping_lines: [{ method_title: 'Brza pošta' }],
  line_items: [{ name: 'Lenovo IdeaPad Slim 3', sku: '82XB00GXSC', quantity: 2, total: '1798.00', price: 899 }],
};

test('emails are sorted into orders, customer emails and the rest', () => {
  const k = (subject, text = '', fromEmail = 'kupac@gmail.com', bulk = false) => classifyEmail({ subject, text, fromEmail, bulk });
  assert.equal(k('Narudžba: 15 laptopa'), 'narudzba');
  assert.equal(k('Pitanje', 'Želimo naručiti 3 miša Logitech'), 'narudzba');
  assert.equal(k('[Shop] Nova narudžba (#2294)', '', 'wordpress@shop.ba'), 'narudzba');
  assert.equal(k('Upit za cijenu monitora'), 'upit');
  assert.equal(k('Re: narudžba 3001', 'Kad stiže?'), 'upit', 'a reply about an order is the customer writing');
  assert.equal(k('Akcija oktobar', '', 'newsletter@dobavljac.ba'), 'ostalo');
  assert.equal(k('Hello', '', 'x@y.ba', true), 'ostalo');
  const pm = emailToInbox({ From: 'Adnan <adnan@firma.ba>', Subject: 'Upit', TextBody: 'Pozdrav,\nTel: 061/234-567', MessageID: 'x', Headers: [{ Name: 'List-Unsubscribe', Value: '<mailto:u@x>' }] });
  assert.equal(pm.kind, 'ostalo');
  assert.equal(pm.from.phone, '061/234-567');
});

test('a web order notifies with everything the shop sent', async () => {
  const r = await d.addInbox(wooOrderToInbox(woo, 'https://shop.example.ba'));
  assert.equal(r.item.kind, 'narudzba');
  const n = await latest(din, 'inbox_web');
  assert.match(n.title, /#3001 · 1\.798,00 KM/);
  for (const part of ['Mirza T.', 'Sarajevo', '066 777 888', '2× Lenovo IdeaPad Slim 3', 'Plaćanje pouzećem', 'Brza pošta', 'Zvati prije dostave']) {
    assert.ok(n.body.includes(part), 'missing ' + part + ' in ' + n.body);
  }
  assert.equal(await latest(amra, 'inbox_web'), undefined, 'maloprodaja has no Prijem');
});

test("the shop's own email about the same order is not added twice", async () => {
  const email = emailToInbox({ from: 'WordPress <wordpress@shop.example.ba>', subject: '[Shop] Nova narudžba (#3001)', text: 'Imate novu narudžbu', messageId: 'woo-3001' });
  const r = await d.addInbox(email);
  assert.equal(r.duplicate, true);
  // …and the other way round: email first, then the webhook.
  const early = await d.addInbox(emailToInbox({ from: 'wordpress@shop.example.ba', subject: '[Shop] Nova narudžba (#3002)', text: '...', messageId: 'woo-3002' }));
  assert.equal(early.item.status, 'novo');
  await d.addInbox(wooOrderToInbox({ ...woo, id: 3002, number: '3002' }));
  const view = await d.dataFor(din);
  assert.equal(view.inbox.find((x) => x.id === early.item.id).status, 'rijeseno');
});

test('an order accepted from the web shop keeps customer, address, payment, delivery, total and the order date', async () => {
  const item = (await d.dataFor(din)).inbox.find((x) => x.order?.number === '3001');
  const { task } = await d.acceptInbox(item.id, din);
  assert.equal(task.customer.phone, '066 777 888');
  assert.equal(task.customer.email, 'mirza@example.com');
  assert.match(task.customer.address, /Titova 1, 71000 Sarajevo/);
  assert.equal(task.payment, 'Plaćanje pouzećem');
  assert.match(task.delivery, /Brza pošta/);
  assert.equal(task.total, 1798);
  assert.equal(task.orderedAt, '2026-09-29');
  assert.equal(task.links.wooUrl, 'https://shop.example.ba/wp-admin/post.php?post=3001&action=edit');
});

test("a customer's email: a task to answer it, or added to the order it is about", async () => {
  const q = await d.addInbox(emailToInbox({ from: 'Nabavka <nabavka@skola.ba>', subject: 'Upit za 15 laptopa', text: 'Pozdrav, trebamo ponudu.\nTel: 033 123 456', messageId: 'q1' }));
  assert.equal(q.item.kind, 'upit');
  const n = await latest(din, 'inbox_email_msg');
  assert.match(n.title, /^Upit kupca: Upit za 15 laptopa/);
  assert.match(n.body, /Od: Nabavka <nabavka@skola.ba> · 033 123 456/);
  const { task } = await d.acceptInbox(q.item.id, din);
  assert.equal(task.type, 'zadatak');
  assert.equal(task.title, 'Odgovoriti: Upit za 15 laptopa');
  assert.equal(task.customer.email, 'nabavka@skola.ba');

  const order = await d.createTask({ title: '10× ThinkPad', customer: { name: 'Tehnocentar', email: 'adnan@tehnocentar.ba' } }, din);
  const f = await d.addInbox(emailToInbox({ from: 'adnan@tehnocentar.ba', subject: 'Re: ThinkPad', text: 'Kad stiže roba?\n\nOn Mon wrote:\n> staro', messageId: 'f1' }));
  const r = await d.attachInbox(f.item.id, order.id, din);
  assert.equal(r.item.status, 'prihvaceno');
  assert.equal(r.item.taskId, order.id);
  const after = (await d.dataFor(din)).tasks.find((t) => t.id === order.id);
  assert.match(after.comments.at(-1).text, /Kad stiže roba\?/);
  assert.ok(!after.comments.at(-1).text.includes('staro'), 'quoted reply is cut');

  const other = await d.addInbox(emailToInbox({ from: 'x@y.ba', subject: 'Pitanje', text: 'hi', messageId: 'o1' }));
  assert.equal((await d.setInboxKind(other.item.id, 'ostalo', din)).kind, 'ostalo');
  assert.equal((await d.setInboxStatus(other.item.id, 'rijeseno', din)).status, 'rijeseno');
});

test('a quick verbal order: dated, marked to fill in, and filled in later', async () => {
  const t = await d.createTask({ title: '2× Lenovo IdeaPad, crni', customer: { name: 'Haris', phone: '062 111 222' }, source: 'telefon', orderedAt: '2026-09-28', needsInfo: true }, din);
  assert.equal(t.orderedAt, '2026-09-28');
  assert.equal(t.needsInfo, true);
  const n = await latest(selma, 'task_new');
  assert.match(n.body, /062 111 222/);
  assert.match(n.body, /treba dopuniti/);
  const t2 = await d.updateTask(t.id, { needsInfo: false, customer: { name: 'Haris B.', phone: '062 111 222', email: 'haris@x.ba' } }, din);
  assert.equal(t2.needsInfo, false);
  assert.ok(t2.history.some((h) => h.text === 'Podaci dopunjeni'));
  const plain = await d.createTask({ title: 'Bez datuma' }, din);
  assert.equal(plain.orderedAt, today);
});

test('arrival dates notify the people on the order, and watchers hear about changes', async () => {
  const t = await d.createTask({ title: 'Pošiljka od distributera', status: 'ceka_robu' }, din);
  await d.updateTask(t.id, { watch: true }, selma);
  await d.updateTask(t.id, { expectedAt: addDaysISO(today, 3) }, din);
  const n = await latest(selma, 'task_arrival');
  assert.match(n.title, /roba stiže/);
  await d.updateTask(t.id, { status: 'ceka_kalkulaciju' }, din);
  assert.ok(await latest(selma, 'task_status'), 'watcher hears the status change');
  const off = await d.updateTask(t.id, { watch: false }, selma);
  assert.ok(!off.watchers.includes(selma.id));
});

test('people can switch off categories for themselves', async () => {
  await prefsSet(selma.id, { muted: ['web'] });
  await d.addInbox(wooOrderToInbox({ ...woo, id: 3003, number: '3003' }));
  const mine = await notificationsFor(selma);
  assert.ok(!mine.list.some((n) => n.title.includes('#3003')));
  assert.deepEqual(mine.muted, ['web']);
  assert.ok((await notificationsFor(din)).list.some((n) => n.title.includes('#3003')));
});

test('the morning reminder: arrivals, due dates, orders to fill in, once a day', async () => {
  const t = await d.createTask({ title: 'Stiže danas', expectedAt: today, status: 'ceka_robu', customer: { name: 'Biro Mostar' } }, din);
  await d.createTask({ title: 'Telefonom: 3 miša', needsInfo: true }, din);
  const r = await d.dailyDigest();
  assert.ok(r.sent >= 1);
  const n = await latest(din, 'daily');
  assert.match(n.title, /^Danas: /);
  assert.match(n.body, new RegExp('Roba stiže: .*' + t.number));
  assert.match(n.body, /Treba dopuniti:/);
  assert.equal((await d.dailyDigest()).skipped, true);
});
