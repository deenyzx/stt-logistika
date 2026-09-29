// The rules end to end on the in-memory store (no Redis env vars in tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = 'admin-test-pw';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const { createUser, login, currentUser } = await import('../lib/users.js');
const { hashPassword, verifyPassword, signSession, readSession, passVersion } = await import('../lib/auth.js');
const d = await import('../lib/domain.js');
const { notificationsFor, mentionedUsers } = await import('../lib/notify.js');

const din = await createUser({ username: 'Din', name: 'Din', role: 'veleprodaja', password: 'lozinka1' });
const amra = await createUser({ username: 'amra', name: 'Amra', role: 'maloprodaja', password: 'lozinka2' });
const admin = { id: 'admin', name: 'Administrator', role: 'admin', env: true };

test('passwords and sessions', async () => {
  const h = await hashPassword('tajna123');
  assert.equal(await verifyPassword('tajna123', h), true);
  assert.equal(await verifyPassword('pogresno', h), false);
  const tok = await signSession({ uid: din.id, role: din.role, pv: await passVersion(din) });
  assert.equal((await readSession(tok)).uid, din.id);
  assert.equal(await readSession(tok.slice(0, -2) + 'xx'), null);
  assert.equal((await login('DIN', 'lozinka1'))?.id, din.id);
  assert.equal(await login('din', 'krivo'), null);
  assert.equal((await login('admin', 'admin-test-pw'))?.role, 'admin');
  const req = { cookies: { get: () => ({ value: tok }) } };
  assert.equal((await currentUser(req))?.id, din.id);
});

test('duplicate usernames are refused', async () => {
  await assert.rejects(() => createUser({ username: 'din', name: 'X', role: 'maloprodaja', password: '123456' }), /već postoji/);
});

test('an order: create, status to "čeka robu", assign, comment with @mention', async () => {
  const t = await d.createTask({ title: '10× Lenovo ThinkPad za Tehnocentar', source: 'email', customer: { name: 'Tehnocentar' }, items: [{ code: '21JK', name: 'ThinkPad', qty: 10 }] }, din);
  assert.match(t.number, /^N-\d{4}$/);
  assert.equal(t.status, 'nova');
  assert.equal(t.assignee, din.id);
  assert.equal(t.dept, 'veleprodaja');
  const t2 = await d.updateTask(t.id, { status: 'ceka_robu', due: '2026-10-02' }, din);
  assert.equal(t2.status, 'ceka_robu');
  assert.ok(t2.history.some((h) => h.text.includes('Čeka robu')));
  await d.updateTask(t.id, { assignee: amra.id }, din);
  const { obj } = await d.addComment('task', t.id, 'Kamion stiže u četvrtak, @Amra javi kupcu', din);
  assert.equal(obj.comments.length, 1);
  const n = await notificationsFor(amra);
  assert.ok(n.list.some((x) => x.type === 'task_assigned'), 'Amra hears she was assigned');
  assert.ok(n.list.some((x) => x.type === 'comment'), 'Amra hears the mention');
  const own = await notificationsFor(din);
  assert.ok(!own.list.some((x) => x.type === 'comment' && x.by === din.id), 'nobody is notified about their own comment');
});

test('bad input is refused', async () => {
  await assert.rejects(() => d.createTask({ title: '  ' }, din), /naslov/i);
  const t = await d.createTask({ title: 'X' }, din);
  await assert.rejects(() => d.updateTask(t.id, { status: 'nepostojeci' }, din), /status/i);
  await assert.rejects(() => d.updateTask(t.id, { assignee: 'u_nema' }, din), /ne postoji/i);
  await assert.rejects(() => d.deleteTask(t.id, amra), /Brisati/);
  await d.deleteTask(t.id, admin);
});

test('a reservation notifies everyone else, with who made it, purpose and payment', async () => {
  const r = await d.createReservation({ model: 'Lenovo LOQ 15IRX9', customer: { name: 'Haris B.', phone: '062 111 222' }, purposeType: 'prodaja', purpose: 'Dolazi u petak', payment: 'kartica', deposit: '200', until: '2026-10-03', comment: 'Traži i torbu' }, amra);
  assert.match(r.number, /^R-\d{4}$/);
  assert.equal(r.createdBy.name, 'Amra');
  assert.equal(r.payment, 'kartica');
  assert.equal(r.deposit, 200);
  assert.equal(r.comments[0].text, 'Traži i torbu');
  const forDin = await notificationsFor(din);
  assert.ok(forDin.list.some((x) => x.type === 'res_new' && x.title.includes('LOQ')));
  const done = await d.updateReservation(r.id, { status: 'preuzeto' }, din);
  assert.ok(done.closedAt);
  const forAmra = await notificationsFor(amra);
  assert.ok(forAmra.list.some((x) => x.type === 'res_status'));
});

test('inbox: a web order arrives once, is accepted as an order', async () => {
  const item = { source: 'web', extId: '2291', title: 'ASUS Vivobook 15', from: { name: 'Emina K.', email: 'e@x.ba', phone: '' }, body: '...', order: { id: 2291, number: '2291', total: 1149, currency: 'KM', items: [{ code: 'X1504VA', name: 'ASUS Vivobook 15', qty: 1 }] } };
  const a = await d.addInbox(item);
  const b = await d.addInbox(item);
  assert.equal(b.duplicate, true);
  assert.equal(a.item.id, b.item.id);
  assert.equal((await d.addInbox({ ...item, extId: '9999' }, { updateOnly: true })).ignored, true);
  const { task, item: done } = await d.acceptInbox(a.item.id, din);
  assert.equal(task.source, 'web');
  assert.equal(task.items[0].name, 'ASUS Vivobook 15');
  assert.equal(done.status, 'prihvaceno');
  assert.equal(done.taskId, task.id);
  await assert.rejects(() => d.acceptInbox(a.item.id, din), /Već je prihvaćeno/);
});

test('stock: first export is the baseline, the next one shows what changed, rows get ticked', async () => {
  const first = 'Šifra;Naziv;Količina\nA;Laptop A;5\nB;Laptop B;1\n';
  const r1 = await d.ingestStock(first, { filename: 'f1.csv', user: din });
  assert.equal(r1.diff.baseline, true);
  assert.equal((await d.ingestStock(first, { filename: 'f1.csv', user: din })).unchanged, true);
  const r2 = await d.ingestStock('Šifra;Naziv;Količina\nA;Laptop A;3\nC;Laptop C;7\n', { filename: 'f2.csv', source: 'agent' });
  assert.deepEqual(r2.diff.counts, { qty: 1, new: 1, removed: 1 });
  const m = await d.markStock(r2.diff.id, ['A', 'C', 'nema'], true, din);
  assert.deepEqual(Object.keys(m.done).sort(), ['A', 'C']);
  const view = await d.dataFor(din);
  assert.equal(view.stock[0].id, r2.diff.id);
  assert.equal(view.stockLatest.filename, 'f2.csv');
  await assert.rejects(() => d.ingestStock('', {}), /prazna/);
});

test('maloprodaja does not see the inbox or stock', async () => {
  const view = await d.dataFor(amra);
  assert.equal(view.inbox.length, 0);
  assert.equal(view.stock.length, 0);
  await assert.rejects(() => d.addComment('stock', 'x', 'hi', amra), /pristup/);
});

test('mentions match first names without diacritics', () => {
  const users = [{ id: '1', username: 'selma', name: 'Selma Đozo' }, { id: '2', username: 'din', name: 'Din' }];
  assert.deepEqual(mentionedUsers('@selma pogledaj', users), ['1']);
  assert.deepEqual(mentionedUsers('email@dinamo.ba', users), []);
  assert.deepEqual(mentionedUsers('Hvala @Din.', users), ['2']);
});
