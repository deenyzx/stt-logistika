// Email sorting (shop emails, rules, keywords, skipped) and the WooCommerce API (read and change an order),
// against a stand-in shop. In-memory store; no real network.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.ADMIN_PASSWORD = 'admin-test-pw';
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const { createUser } = await import('../lib/users.js');
const d = await import('../lib/domain.js');
const { notificationsFor } = await import('../lib/notify.js');
const { saveShop, getShop } = await import('../lib/shops.js');
const { matchRule, cleanRules } = await import('../lib/emailRules.js');

const din = await createUser({ username: 'din', name: 'Din', role: 'veleprodaja', password: 'lozinka1' });
const newest = async (type) => (await notificationsFor(din)).list.find((n) => n.type === type);
const view = () => d.dataFor(din);

/* ---- a stand-in WooCommerce shop at https://kupitelevizor.ba ---- */
const shopState = {
  stripAuth: false,
  orders: {
    5202: { id: 5202, number: '5202', status: 'processing', total: '1301.00', currency: 'BAM', date_created_gmt: '2026-09-30T08:00:00', date_modified_gmt: '2026-09-30T08:00:00', billing: { first_name: 'Omer', last_name: 'Moćić', phone: '061733132', email: 'omer.mocic@gmail.com', city: 'Gradacac', address_1: 'Biberovo Polje 143' }, shipping: {}, shipping_lines: [], line_items: [{ name: 'LG NanoCell 75"', sku: '75NU800B3LA', quantity: 1, total: '1262.00', price: 1262 }] },
    5203: { id: 5203, number: '5203', status: 'pending', total: '899.00', currency: 'BAM', date_created_gmt: '2026-09-29T08:00:00', date_modified_gmt: '2026-09-29T08:00:00', billing: { first_name: 'Ana', last_name: 'K.' }, shipping: {}, shipping_lines: [], line_items: [{ name: 'Samsung 55"', sku: 'UE55', quantity: 1, total: '899', price: 899 }] },
  },
  notes: { 5202: [] },
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.hostname !== 'kupitelevizor.ba') return realFetch(url, init);
  const auth = init.headers?.Authorization;
  const okAuth = auth === 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64') && !shopState.stripAuth;
  const okQuery = u.searchParams.get('consumer_key') === 'ck_test' && u.searchParams.get('consumer_secret') === 'cs_test';
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (!okAuth && !okQuery) return reply(401, { code: 'woocommerce_rest_cannot_view', message: 'Sorry, you cannot list resources.' });
  const path = u.pathname.replace('/wp-json/wc/v3', '');
  let m;
  if (path === '/reports/orders/totals') return reply(200, [{ slug: 'pending', name: 'Na čekanju uplate' }, { slug: 'processing', name: 'U obradi' }, { slug: 'completed', name: 'Završena' }, { slug: 'poslano', name: 'Poslano' }, { slug: 'cancelled', name: 'Otkazana' }]);
  if (path === '/orders' && init.method === 'GET') return reply(200, Object.values(shopState.orders).sort((a, b) => b.id - a.id).slice(0, Number(u.searchParams.get('per_page')) || 10));
  if ((m = path.match(/^\/orders\/(\d+)$/))) {
    const o = shopState.orders[m[1]];
    if (!o) return reply(404, { code: 'woocommerce_rest_shop_order_invalid_id', message: 'Invalid ID.' });
    if (init.method === 'PUT') Object.assign(o, JSON.parse(init.body), { date_modified_gmt: '2026-10-02T10:00:00' });
    return reply(200, o);
  }
  if ((m = path.match(/^\/orders\/(\d+)\/notes$/))) {
    const list = shopState.notes[m[1]] || (shopState.notes[m[1]] = []);
    if (init.method === 'POST') { const b = JSON.parse(init.body); const n = { id: list.length + 1, note: b.note, customer_note: b.customer_note, author: 'api', date_created_gmt: '2026-10-02T10:00:00' }; list.unshift(n); return reply(201, n); }
    return reply(200, list);
  }
  return reply(404, { code: 'rest_no_route', message: 'No route' });
};

const KUPITELEVIZOR_EMAIL = {
  from: 'KupiTelevizor <info@kupitelevizor.ba>',
  to: 'info@stt.ba',
  subject: '[KupiTelevizor] Nova narudžba (#5202)',
  messageId: 'kt-5202',
  text: 'KupiTelevizor\nNova narudžba\nYou’ve received a new order from Omer Moćić:\n\nSažetak narudžbe\nNarudžba #5202 (30/09/2026)\nProizvod\tKoličina\tCijena\nLG NanoCell 75" 4K UHD webOS 26 — 75NU800B3LA\t\nLG NanoCell 75" 4K UHD webOS 26 — 75NU800B3LA\n(#75NU800B3LA)\n×1\t1.262 KM\nOmega zidni nosač za TV 32–80", fiksni — OUTV600F — slika 1\t\nOmega zidni nosač za TV 32–80", fiksni — OUTV600F\n(#OUTV600F)\n×1\t24 KM\nMeđuzbir:\t1.286 KM\nDostava: Dostava na adresu\t15 KM\nUkupno:\t1.301 KM\n(uključuje 186,86 KM PDV)\nNačin plaćanja:\tPlaćanje prilikom preuzimanja\nAdresa za naplatu\nOmer Moćić\nBiberovo Polje 143 Vučkovci\nGradacac\n76250\n061733132\nomer.mocic@gmail.com\nAdresa za dostavu\nOmer Moćić\nBiberovo Polje 143 Vučkovci\nGradacac\n76250\n061733132\n\nNarudžba je pouzećem — nazvati kupca radi potvrde i dogovora isporuke.\n\nProcess your orders on the go. Get the app.\nKupiTelevizor · STT d.o.o. Sarajevo · Akifa Šeremeta 15, 71000 Sarajevo · 033 448 504 · info@stt.ba',
};

test('rules: first match wins, alternatives with commas, without diacritics', () => {
  const rules = cleanRules([
    { field: 'from', contains: '@dobavljac.ba, @distributer.com', action: 'ignore' },
    { field: 'subject', contains: 'ponud', action: 'upit' }, // a word stem catches ponuda, ponudu, ponude
  ]);
  assert.equal(matchRule(rules, { from: { email: 'prodaja@distributer.com' }, title: 'Cjenovnik' }).action, 'ignore');
  assert.equal(matchRule(rules, { from: { email: 'kupac@gmail.com' }, title: 'Molim PONUDU' }).action, 'upit');
  assert.equal(matchRule(rules, { from: { email: 'kupac@gmail.com' }, title: 'Pozdrav' }), null);
});

test("the shop's order email becomes a full order with everything in the notification", async () => {
  await saveShop({ name: 'KupiTelevizor', url: 'https://kupitelevizor.ba', key: 'ck_test', secret: 'cs_test' });
  const r = await d.ingestEmail(KUPITELEVIZOR_EMAIL);
  assert.equal(r.item.source, 'web');
  assert.equal(r.item.shopId, 'kupitelevizor');
  assert.equal(r.item.order.total, 1301);
  assert.equal(r.item.order.items.length, 2);
  const n = await newest('inbox_web');
  assert.equal(n.title, 'KupiTelevizor #5202 · 1.301,00 KM');
  for (const part of ['Omer Moćić', 'Gradacac', '061733132', '1× LG NanoCell', '(75NU800B3LA)', 'Plaćanje prilikom preuzimanja', 'Dostava na adresu', 'nazvati kupca']) assert.ok(n.body.includes(part), 'missing ' + part);
  // The same order through the webhook is the same item, not a second one.
  const shop = await getShop('kupitelevizor');
  const again = await d.addInbox(d.shopOrderToItem(shopState.orders[5202], shop));
  assert.equal(again.duplicate, true);
  assert.equal(again.item.id, r.item.id);
  assert.equal((await view()).inbox.filter((x) => x.order?.number === '5202').length, 1);
});

test('read and change the order in the shop: status, note to the customer, history and notification', async () => {
  const item = (await view()).inbox.find((x) => x.order?.number === '5202');
  const { task } = await d.acceptInbox(item.id, din);
  assert.equal(task.title.startsWith('KupiTelevizor #5202'), true);
  const info = await d.shopOrderInfo({ taskId: task.id });
  assert.equal(info.connected, true);
  assert.equal(info.order.status, 'processing');
  assert.equal(info.order.statusLabel, 'U obradi');
  assert.ok(info.statuses.some((s) => s.slug === 'poslano'), 'custom statuses come from the shop');
  const r = await d.changeShopOrder({ taskId: task.id, orderId: info.order.id, status: 'poslano', note: 'Poslano brzom poštom, broj 123', customerNote: true }, din);
  assert.equal(r.statusLabel, 'Poslano');
  assert.equal(shopState.orders[5202].status, 'poslano');
  assert.equal(shopState.notes[5202][0].customer_note, true);
  assert.match(shopState.notes[5202][0].note, /Poslano brzom poštom, broj 123 \(Din\)/);
  const t = (await view()).tasks.find((x) => x.id === task.id);
  assert.ok(t.history.some((h) => /KupiTelevizor: status → „Poslano”, napomena poslana kupcu/.test(h.text)));
  assert.equal((await view()).inbox.find((x) => x.id === item.id).order.status, 'poslano');
  await assert.rejects(() => d.changeShopOrder({ taskId: task.id, orderId: info.order.id, status: 'nepostoji' }, din), /ne poznaje/);
});

test('a host that strips the Authorization header still works (key in the query string)', async () => {
  shopState.stripAuth = true;
  const shop = await getShop('kupitelevizor');
  const { testShop } = await import('../lib/shops.js');
  assert.equal((await testShop(shop)).ok, true);
  shopState.stripAuth = false;
  const bad = { ...shop, key: 'ck_wrong', secret: 'cs_wrong' };
  await assert.rejects(() => testShop(bad), /odbija ključ/);
});

test('sync pulls recent orders in quietly and skips ones already there', async () => {
  const res = await d.syncShops({ days: 3 });
  assert.deepEqual(res, [{ shop: 'KupiTelevizor', checked: 2, added: 1 }]);
  assert.ok((await view()).inbox.some((x) => x.order?.number === '5203'));
  assert.ok(!(await notificationsFor(din)).list.some((n) => n.title.includes('#5203')), 'an old order pulled in later does not ring');
});

test('rules decide first; "ignore" goes to Preskočeno, not Prijem', async () => {
  await d.saveSettings({ emailRules: [{ field: 'from', contains: '@distributer.com', action: 'ignore' }, { field: 'to', contains: 'maloprodaja@stt.ba', action: 'upit' }] });
  const a = await d.ingestEmail({ from: 'Prodaja <prodaja@distributer.com>', subject: 'Novi cjenovnik', text: 'U prilogu cjenovnik.', messageId: 's1' });
  assert.equal(a.skipped, true);
  assert.match(a.reason, /Pravilo: pošiljalac sadrži/);
  const b = await d.ingestEmail({ from: 'x@y.ba', to: 'maloprodaja@stt.ba', subject: 'Pozdrav', text: 'Zanima me nešto', messageId: 's2' });
  assert.equal(b.item.kind, 'upit');
  assert.equal(b.item.rule.contains, 'maloprodaja@stt.ba');
});

test('every email lands in Prijem for someone to choose; only "Ostalo" stays quiet', async () => {
  const a = await d.ingestEmail({ from: 'newsletter@banka.ba', subject: 'Oktobarske novosti', text: 'Novosti...', messageId: 'n1', bulk: true });
  assert.equal(a.item.kind, 'ostalo', 'not hidden: it shows under Ostalo');
  assert.ok(!(await notificationsFor(din)).list.some((n) => /Oktobarske/.test(n.title)), 'no notification for Ostalo');
  // Any email can be taken as a task.
  const { task } = await d.acceptInbox(a.item.id, din, { as: 'zadatak' });
  assert.equal(task.type, 'zadatak');
  assert.match(task.note, /Novosti/);

  // The admin can choose to keep newsletters and robots out (they wait in Preskočeno).
  await d.saveSettings({ keepOther: false });
  const b = await d.ingestEmail({ from: 'newsletter@banka.ba', subject: 'Novembarske novosti', text: 'Novosti...', messageId: 'n2', bulk: true });
  assert.equal(b.skipped, true);
  assert.ok((await view()).skipped.some((x) => x.title === 'Novembarske novosti'));
});

test('a skipped email that matters comes back, and its sender is remembered', async () => {
  const s = await d.ingestEmail({ from: 'Kupac <kupac@firma.ba>', subject: 'Re: aw: info', text: 'Hvala', messageId: 'k1', bulk: true });
  assert.equal(s.skipped, true);
  const id = (await view()).skipped.find((x) => x.extId === 'k1').id;
  const r = await d.restoreSkipped(id, 'upit', din, { remember: true });
  assert.equal(r.item.kind, 'upit');
  assert.ok(!(await view()).skipped.some((x) => x.id === id));
  const next = await d.ingestEmail({ from: 'kupac@firma.ba', subject: 'Opet', text: 'x', messageId: 'k2', bulk: true });
  assert.equal(next.item.kind, 'upit', 'the remembered sender goes straight to Upiti kupaca');
});

test('re-sorting by hand can be remembered; a sender can be ignored for good', async () => {
  const a = await d.ingestEmail({ from: 'servis@partner.ba', subject: 'Pitanje', text: 'Zdravo', messageId: 'm1' });
  await d.setInboxKind(a.item.id, 'narudzba', din, { remember: true });
  const b = await d.ingestEmail({ from: 'servis@partner.ba', subject: 'Drugo', text: 'Zdravo opet', messageId: 'm2' });
  assert.equal(b.item.kind, 'narudzba');
  await d.ignoreSender(b.item.id, din);
  const c = await d.ingestEmail({ from: 'servis@partner.ba', subject: 'Treće', text: '...', messageId: 'm3' });
  assert.equal(c.skipped, true);
});
