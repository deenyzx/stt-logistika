// Looking an article up by its šifra (code): name, prices and VP stock from the latest EKI EDI export, minus what is
// reserved. This is what the sheet's VLOOKUPs into ARTIKLI and STANJE did.
import { all, kvGet } from './store.js';
import { fold } from './format.js';

const OPEN_RES = ['ceka_vp', 'aktivna'];
const norm = (code) => fold(code).replace(/\s+/g, '');

/** Quantities held by open reservations, per code. */
export async function reservedByCode() {
  const out = {};
  for (const r of await all('reservations')) {
    if (!OPEN_RES.includes(r.status) || !r.code) continue;
    const k = norm(r.code);
    out[k] = (out[k] || 0) + (Number(r.qty) || 1);
  }
  return out;
}

function toArticle(code, row, reserved) {
  const res = reserved[norm(code)] || 0;
  return {
    code,
    name: row?.name || '',
    qty: row ? row.qty ?? null : null,
    reserved: res,
    free: row && row.qty != null ? Math.round((row.qty - res) * 1000) / 1000 : null,
    buy: row?.buy ?? null,
    sell: row?.sell ?? null,
  };
}

/**
 * findArticles({ code }) → the article with exactly that code (ignoring case and spaces), or none.
 * findArticles({ q }) → up to `limit` articles whose code starts with q or whose name contains it.
 */
export async function findArticles({ code = '', q = '', limit = 8 } = {}) {
  const [latest, reserved] = await Promise.all([kvGet('stock_latest'), reservedByCode()]);
  const rows = latest?.rows || {};
  const stockAt = latest?.meta?.at || null;
  if (code) {
    const k = norm(code);
    const hit = Object.keys(rows).find((c) => norm(c) === k);
    return { stockAt, items: hit ? [toArticle(hit, rows[hit], reserved)] : [] };
  }
  const f = fold(q);
  if (f.length < 2) return { stockAt, items: [] };
  const items = [];
  for (const [c, row] of Object.entries(rows)) {
    if (norm(c).startsWith(f.replace(/\s+/g, '')) || fold(row.name).includes(f)) items.push(toArticle(c, row, reserved));
    if (items.length >= limit) break;
  }
  return { stockAt, items };
}

/** The whole latest export as articles (for the Zalihe → Artikli list). */
export async function listArticles({ q = '', limit = 300 } = {}) {
  const [latest, reserved] = await Promise.all([kvGet('stock_latest'), reservedByCode()]);
  const rows = latest?.rows || {};
  const f = fold(q);
  const items = [];
  let total = 0;
  for (const [c, row] of Object.entries(rows)) {
    if (f && !norm(c).includes(f.replace(/\s+/g, '')) && !fold(row.name).includes(f)) continue;
    total += 1;
    if (items.length < limit) items.push(toArticle(c, row, reserved));
  }
  return { stockAt: latest?.meta?.at || null, filename: latest?.meta?.filename || '', total, items };
}

/** Fills in what a line is missing (name, prices) from the stock export, never overwriting what was typed. */
export async function fillFromStock(lines) {
  if (!lines.some((l) => l.code)) return lines;
  const latest = await kvGet('stock_latest');
  const rows = latest?.rows || {};
  const index = new Map(Object.keys(rows).map((c) => [norm(c), c]));
  return lines.map((l) => {
    const c = l.code ? index.get(norm(l.code)) : null;
    if (!c) return l;
    const row = rows[c];
    return { ...l, name: l.name || row.name || '', buy: l.buy ?? row.buy ?? null, sell: l.sell ?? row.sell ?? null };
  });
}
