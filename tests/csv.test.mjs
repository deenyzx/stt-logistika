import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, detectDelimiter, toSnapshot, diffSnapshots, parseNumber } from '../lib/csv.js';

test('detects ; and , and tab delimiters', () => {
  assert.equal(detectDelimiter('Šifra;Naziv;Količina\nA1;Laptop;3\n'), ';');
  assert.equal(detectDelimiter('code,name,qty\nA1,Laptop,3\n'), ',');
  assert.equal(detectDelimiter('code\tname\tqty\nA1\tLaptop\t3\n'), '\t');
});

test('parses quotes, doubled quotes, CRLF and a BOM', () => {
  const { rows } = parseCSV('﻿a;b\r\n"x;1";"he said ""hi"""\r\n');
  assert.deepEqual(rows, [['a', 'b'], ['x;1', 'he said "hi"']]);
});

test('numbers: comma decimals with dot thousands, or dot decimals', () => {
  assert.equal(parseNumber('1.234,50', true), 1234.5);
  assert.equal(parseNumber('10,000', true), 10);
  assert.equal(parseNumber('1234.5', false), 1234.5);
  assert.equal(parseNumber('', true), null);
});

test('snapshot finds Bosnian column names and adds up repeated codes', () => {
  const csv = [
    'Faktura;Šifra;Naziv artikla;Količina;Cijena',
    'F-1;21JK0008SC;Lenovo ThinkPad E14;2,000;1.899,00',
    'F-2;21JK0008SC;Lenovo ThinkPad E14;3,000;1.899,00',
    'F-2;P2425H;Dell monitor P2425H;10,000;399,00',
    ';;Ukupno;15,000;',
  ].join('\n');
  const s = toSnapshot(csv);
  assert.equal(s.error, undefined);
  assert.equal(s.keyCol, 'Šifra');
  assert.equal(s.qtyCol, 'Količina');
  assert.equal(s.nameCol, 'Naziv artikla');
  assert.equal(s.count, 2);
  assert.deepEqual(s.rows['21JK0008SC'], { name: 'Lenovo ThinkPad E14', qty: 5 });
  assert.equal(s.rows.P2425H.qty, 10);
});

test('snapshot honours a chosen column mapping', () => {
  const csv = 'Artikl;Opis robe;Komada izdato\nX1;Miš;4\n';
  const s = toSnapshot(csv, { key: 'Artikl', qty: 'Komada izdato', name: 'Opis robe' });
  assert.equal(s.rows.X1.qty, 4);
  assert.equal(s.rows.X1.name, 'Miš');
});

test('snapshot without a header guesses: first column code, last numeric column quantity', () => {
  const s = toSnapshot('A1;Laptop;3\nB2;Miš;10\n');
  assert.equal(s.guessed, true);
  assert.equal(s.rows.A1.qty, 3);
  assert.equal(s.rows.B2.qty, 10);
});

test('an empty file or one without codes is an error', () => {
  assert.ok(toSnapshot('').error);
  assert.ok(toSnapshot('Šifra;Količina\n;\n').error);
});

test('diff lists quantity changes, new and removed codes', () => {
  const prev = { A: { name: 'A', qty: 5 }, B: { name: 'B', qty: 1 }, C: { name: 'C', qty: 2 } };
  const next = { A: { name: 'A', qty: 3 }, C: { name: 'C', qty: 2 }, D: { name: 'D', qty: 7 } };
  const d = diffSnapshots(prev, next);
  assert.deepEqual(d.map((x) => [x.key, x.kind, x.delta]), [['A', 'qty', -2], ['D', 'new', 7], ['B', 'removed', -1]]);
});
