// Reads the CSV that comes out of the EKI EDI PDF scraper and compares two exports.
// Pure functions, no I/O: tested in tests/csv.test.mjs.
import { fold } from './format.js';

// Column names we recognise (compared without diacritics, lower case). First match wins.
const KEY_NAMES = ['sifra artikla', 'sifra robe', 'sifra', 'sif', 'sifra proizvoda', 'kataloski broj', 'code', 'sku', 'kod', 'barkod', 'barcode', 'ean', 'part number', 'pn', 'id'];
const QTY_NAMES = ['kolicina', 'kol', 'kol.', 'qty', 'quantity', 'stanje', 'zaliha', 'zalihe', 'komada', 'kom', 'kom.'];
const NAME_NAMES = ['naziv artikla', 'naziv robe', 'naziv', 'opis', 'name', 'description', 'proizvod', 'artikal', 'roba'];
const TOTAL_WORDS = ['ukupno', 'total', 'svega', 'suma', 'zbir'];

export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    const multi = counts.filter((c) => c > 1);
    if (!multi.length) continue;
    // Prefer the delimiter that splits most lines into the same number of cells.
    const freq = {};
    for (const c of multi) freq[c] = (freq[c] || 0) + 1;
    const [cells, n] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    const score = n * 10 + Number(cells);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function splitLine(line, d) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// Full parser: quoted fields may contain the delimiter and line breaks.
export function parseCSV(text, delimiter) {
  const src = String(text || '').replace(/^﻿/, '');
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
      continue;
    }
    if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
    else if (c === d) { row.push(cur.trim()); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cur.trim());
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      cur = '';
    } else cur += c;
  }
  row.push(cur.trim());
  if (row.some((x) => x !== '')) rows.push(row);
  return { rows, delimiter: d };
}

function findCol(header, names, taken = []) {
  const h = header.map((x) => fold(x).replace(/\s+/g, ' '));
  for (const n of names) {
    const i = h.findIndex((x, idx) => !taken.includes(idx) && x === n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    if (n.length < 3) continue; // "id", "pn", "kol" only as exact matches
    const i = h.findIndex((x, idx) => !taken.includes(idx) && (x.startsWith(n + ' ') || x.startsWith(n + '.') || x.endsWith(' ' + n)));
    if (i >= 0) return i;
  }
  return -1;
}

const looksNumeric = (s) => /^[-+]?\d[\d.,\s]*$/.test(String(s).trim());

// Picks the header row and the key / quantity / name columns. mapping = { key, qty, name } header names chosen in Postavke.
export function detectColumns(rows, mapping = {}) {
  const pick = (header, name) => (name ? header.findIndex((x) => fold(x) === fold(name)) : -1);
  const scan = Math.min(rows.length, 15);
  for (let r = 0; r < scan; r += 1) {
    const header = rows[r];
    let key = pick(header, mapping.key);
    if (key < 0) key = findCol(header, KEY_NAMES);
    let qty = pick(header, mapping.qty);
    if (qty < 0) qty = findCol(header, QTY_NAMES, [key]);
    if (key >= 0 && qty >= 0) {
      let name = pick(header, mapping.name);
      if (name < 0) name = findCol(header, NAME_NAMES, [key, qty]);
      return { headerRow: r, header, key, qty, name, guessed: false };
    }
  }
  // No recognisable header: first column is the code, the next text column the name, the last numeric column the quantity.
  const sample = rows.slice(0, 30);
  const width = Math.max(...sample.map((r) => r.length));
  let qty = -1;
  for (let c = width - 1; c > 0; c -= 1) {
    const vals = sample.map((r) => r[c]).filter((v) => v !== undefined && v !== '');
    if (vals.length && vals.filter(looksNumeric).length / vals.length > 0.7) { qty = c; break; }
  }
  const hasHeader = rows[0] && !looksNumeric(rows[0][qty] ?? '');
  return { headerRow: hasHeader ? 0 : -1, header: hasHeader ? rows[0] : [], key: 0, qty, name: width > 2 ? 1 : -1, guessed: true };
}

// "1.234,50" or "1234.5" or "10,000" → number. decimalComma is decided once per file.
export function parseNumber(s, decimalComma) {
  let t = String(s ?? '').replace(/\s| /g, '').replace(/[^\d,.\-+]/g, '');
  if (!t || !/\d/.test(t)) return null;
  if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Turns the CSV text into { rows: { code: { name, qty } }, columns, ... }. Rows with the same code are added up. */
export function toSnapshot(text, mapping = {}) {
  const { rows, delimiter } = parseCSV(text);
  if (!rows.length) return { error: 'Datoteka je prazna.' };
  const cols = detectColumns(rows, mapping);
  if (cols.qty < 0) return { error: 'Ne mogu naći kolonu s količinom. Izaberi kolone u Postavkama → Zalihe.' };
  const body = rows.slice(cols.headerRow + 1);
  const qtyVals = body.map((r) => r[cols.qty]).filter(Boolean);
  const decimalComma = qtyVals.some((v) => v.includes(','));
  const out = {};
  let lines = 0;
  for (const r of body) {
    const key = (r[cols.key] || '').trim();
    if (!key) continue;
    const name = cols.name >= 0 ? (r[cols.name] || '').trim() : '';
    const fk = fold(key);
    if (TOTAL_WORDS.some((w) => fk.startsWith(w) || fold(name).startsWith(w))) continue;
    const qty = parseNumber(r[cols.qty], decimalComma);
    lines += 1;
    if (!out[key]) out[key] = { name, qty: qty ?? 0 };
    else {
      out[key].qty = round(out[key].qty + (qty ?? 0));
      if (!out[key].name && name) out[key].name = name;
    }
  }
  if (!lines) return { error: 'Nisam našao nijedan red sa šifrom artikla.' };
  return {
    rows: out,
    count: Object.keys(out).length,
    lines,
    delimiter,
    columns: cols.header,
    keyCol: cols.header[cols.key] ?? 'kolona 1',
    qtyCol: cols.header[cols.qty] ?? 'kolona ' + (cols.qty + 1),
    nameCol: cols.name >= 0 ? cols.header[cols.name] ?? 'kolona ' + (cols.name + 1) : null,
    guessed: cols.guessed,
  };
}

const round = (n) => Math.round(n * 1000) / 1000;
const ORDER = { qty: 0, new: 1, removed: 2 };

/** What changed between two snapshots: quantity changes, new codes and codes that disappeared. */
export function diffSnapshots(prev = {}, next = {}, max = 3000) {
  const changes = [];
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (!a) changes.push({ key, name: b.name, before: null, after: b.qty, delta: b.qty, kind: 'new' });
    else if (!b) changes.push({ key, name: a.name, before: a.qty, after: null, delta: -a.qty, kind: 'removed' });
    else if (Math.abs((a.qty || 0) - (b.qty || 0)) > 1e-9) changes.push({ key, name: b.name || a.name, before: a.qty, after: b.qty, delta: round(b.qty - a.qty), kind: 'qty' });
  }
  changes.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || Math.abs(y.delta) - Math.abs(x.delta) || String(x.name).localeCompare(String(y.name), 'bs'));
  return changes.slice(0, max);
}
