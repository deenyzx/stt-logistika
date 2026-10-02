// The shop's own "Nova narudžba" email, exactly as KupiTelevizor sends it (plain text of the email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWooEmail, parseAmount, wooOrderNumber } from '../lib/wooEmail.js';

const KUPITELEVIZOR = `KupiTelevizor
Nova narudžba
You’ve received a new order from Omer Moćić:

Sažetak narudžbe
Narudžba #5202 (30/09/2026)
Proizvod\tKoličina\tCijena
LG NanoCell 75" 4K UHD webOS 26 — 75NU800B3LA\t
LG NanoCell 75" 4K UHD webOS 26 — 75NU800B3LA
(#75NU800B3LA)
×1\t1.262 KM
Omega zidni nosač za TV 32–80", fiksni — OUTV600F — slika 1\t
Omega zidni nosač za TV 32–80", fiksni — OUTV600F
(#OUTV600F)
×1\t24 KM
Međuzbir:\t1.286 KM
Dostava: Dostava na adresu\t15 KM
Ukupno:\t1.301 KM
(uključuje 186,86 KM PDV)
Način plaćanja:\tPlaćanje prilikom preuzimanja
Adresa za naplatu
Omer Moćić
Biberovo Polje 143 Vučkovci
Gradacac
76250
061733132
omer.mocic@gmail.com
Adresa za dostavu
Omer Moćić
Biberovo Polje 143 Vučkovci
Gradacac
76250
061733132

Narudžba je pouzećem — nazvati kupca radi potvrde i dogovora isporuke.

Process your orders on the go. Get the app.
KupiTelevizor · STT d.o.o. Sarajevo · Akifa Šeremeta 15, 71000 Sarajevo · 033 448 504 · Viber/WhatsApp 062 331 332 · info@stt.ba`;

test('amounts in KM', () => {
  assert.equal(parseAmount('1.262 KM'), 1262);
  assert.equal(parseAmount('186,86 KM'), 186.86);
  assert.equal(parseAmount('1.301,50'), 1301.5);
  assert.equal(parseAmount('24'), 24);
});

test('the KupiTelevizor new-order email becomes a full order', () => {
  const o = parseWooEmail({ subject: '[KupiTelevizor] Nova narudžba (#5202)', text: KUPITELEVIZOR });
  assert.equal(o.shopName, 'KupiTelevizor');
  assert.equal(o.number, '5202');
  assert.equal(o.date, '2026-09-30');
  assert.deepEqual(o.customer, { name: 'Omer Moćić', phone: '061733132', email: 'omer.mocic@gmail.com', address: 'Biberovo Polje 143 Vučkovci, 76250 Gradacac', city: 'Gradacac' });
  assert.equal(o.items.length, 2);
  assert.deepEqual(o.items[0], { code: '75NU800B3LA', name: 'LG NanoCell 75" 4K UHD webOS 26 — 75NU800B3LA', qty: 1, price: 1262, lineTotal: 1262 });
  assert.equal(o.items[1].code, 'OUTV600F');
  assert.equal(o.items[1].name, 'Omega zidni nosač za TV 32–80", fiksni — OUTV600F');
  assert.equal(o.subtotal, 1286);
  assert.equal(o.shippingMethod, 'Dostava na adresu');
  assert.equal(o.shippingTotal, 15);
  assert.equal(o.total, 1301);
  assert.equal(o.tax, 186.86);
  assert.equal(o.payment, 'Plaćanje prilikom preuzimanja');
  assert.equal(o.note, 'Narudžba je pouzećem — nazvati kupca radi potvrde i dogovora isporuke.');
});

test('works without the subject, with an English template and a one-row item table', () => {
  const text = `KupiLenovo\nNew order\nYou’ve received the following order from Amra H.:\nOrder #1288 (01/10/2026)\nProduct\tQuantity\tPrice\nLenovo IdeaPad Slim 3 (#82XB00GXSC)\t2\t1.798 KM\nSubtotal:\t1.798 KM\nShipping:\tFree shipping\nTotal:\t1.798 KM\nPayment method:\tDirect bank transfer\nNote:\tMolim račun na firmu\nBilling address\nAmra H.\nFirma d.o.o.\nTitova 1\n71000 Sarajevo\n062 123 456\namra@firma.ba\n`;
  const o = parseWooEmail({ text });
  assert.equal(o.shopName, 'KupiLenovo');
  assert.equal(o.number, '1288');
  assert.equal(o.customer.name, 'Amra H.');
  assert.equal(o.customer.phone, '062 123 456');
  assert.equal(o.customer.city, 'Sarajevo');
  assert.deepEqual(o.items, [{ code: '82XB00GXSC', name: 'Lenovo IdeaPad Slim 3', qty: 2, price: 1798 }]);
  assert.equal(o.shippingTotal, 0);
  assert.equal(o.total, 1798);
  assert.equal(o.payment, 'Direct bank transfer');
  assert.equal(o.customerNote, 'Molim račun na firmu');
});

test('ordinary emails are not shop orders', () => {
  assert.equal(parseWooEmail({ subject: 'Narudžba #12', text: 'Pozdrav, šaljem narudžbu #12 za 3 miša.' }), null);
  assert.equal(wooOrderNumber('Upit', 'Imate li laptope?'), null);
});
