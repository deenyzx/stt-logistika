import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyWoo, wooOrderToInbox, emailToInbox, parseAddress, htmlToText } from '../lib/integrations.js';

const order = {
  id: 2291,
  number: '2291',
  status: 'processing',
  currency: 'BAM',
  total: '1149.00',
  date_created_gmt: '2026-09-29T07:12:00',
  payment_method_title: 'Plaćanje pouzećem',
  customer_note: 'Zvati prije dostave',
  billing: { first_name: 'Emina', last_name: 'K.', email: 'emina@example.com', phone: '061 000 000', city: 'Zenica', address_1: 'Ulica 1' },
  shipping: {},
  shipping_lines: [{ method_title: 'Brza pošta' }],
  line_items: [{ name: 'ASUS Vivobook 15', sku: 'X1504VA-NJ', quantity: 1, total: '1149.00', price: 1149 }],
};

test('WooCommerce signature is checked against the raw body', async () => {
  const raw = JSON.stringify(order);
  const sig = createHmac('sha256', 'tajna').update(raw).digest('base64');
  assert.equal(await verifyWoo(raw, sig, 'tajna'), true);
  assert.equal(await verifyWoo(raw, sig, 'druga'), false);
  assert.equal(await verifyWoo(raw + ' ', sig, 'tajna'), false);
  assert.equal(await verifyWoo(raw, null, 'tajna'), false);
});

test('a WooCommerce order becomes an inbox item with items and KM', () => {
  const x = wooOrderToInbox(order, 'https://shop.example.ba/');
  assert.equal(x.source, 'web');
  assert.equal(x.extId, '2291');
  assert.equal(x.from.name, 'Emina K.');
  assert.equal(x.order.currency, 'KM');
  assert.equal(x.order.total, 1149);
  assert.deepEqual(x.order.items[0], { code: 'X1504VA-NJ', name: 'ASUS Vivobook 15', qty: 1, price: 1149 });
  assert.match(x.order.shipping, /Brza pošta/);
  assert.equal(x.order.url, 'https://shop.example.ba/wp-admin/post.php?post=2291&action=edit');
  assert.equal(x.receivedAt, Date.parse('2026-09-29T07:12:00Z'));
});

test('email payloads from Postmark, Mailgun and plain JSON', () => {
  const pm = emailToInbox({ FromFull: { Email: 'nabavka@primjer.ba', Name: 'Nabavka' }, Subject: 'Upit: 15 laptopa', TextBody: 'Pozdrav', MessageID: 'abc' });
  assert.deepEqual([pm.from.email, pm.from.name, pm.title, pm.body, pm.extId], ['nabavka@primjer.ba', 'Nabavka', 'Upit: 15 laptopa', 'Pozdrav', 'abc']);
  const mg = emailToInbox({ from: 'Amra <amra@firma.ba>', subject: 'Narudžba', 'body-plain': 'Tekst', 'Message-Id': '<m1>' });
  assert.deepEqual([mg.from.email, mg.from.name, mg.extId], ['amra@firma.ba', 'Amra', '<m1>']);
  const html = emailToInbox({ from: 'x@y.ba', subject: 'S', html: '<p>Red 1</p><p>Red&nbsp;2</p>' });
  assert.equal(html.body, 'Red 1\nRed 2');
});

test('address parsing and html to text', () => {
  assert.deepEqual(parseAddress('"Din H." <din@firma.ba>'), { name: 'Din H.', email: 'din@firma.ba' });
  assert.deepEqual(parseAddress('din@firma.ba'), { name: '', email: 'din@firma.ba' });
  assert.equal(htmlToText('<style>x</style>A<br>B'), 'A\nB');
});
