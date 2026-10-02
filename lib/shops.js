// The company's web shops (KupiLenovo, KupiTelevizor, …) and the WooCommerce REST API: read orders, and one write
// only: an order's status from "processing" (Procesuiranje) to "completed" (Završeno). wc() refuses anything else,
// so no notes, no customer emails and no other changes can leave the app.
//
// Shops are added by the admin in Postavke → Web shopovi (stored in Redis). A shop set up the old way through env
// vars (WOO_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET, WOO_WEBHOOK_SECRET, WOO_SHOP_NAME) still works as shop "web".
import { kvGet, kvSet } from './store.js';
import { HttpError, str } from './errors.js';

const fold = (s) => String(s || '').toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const slug = (s) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shop';
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const randomSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');

function envShop() {
  if (!process.env.WOO_URL && !process.env.WOO_WEBHOOK_SECRET) return null;
  return {
    id: 'web',
    name: process.env.WOO_SHOP_NAME || 'Web shop',
    url: (process.env.WOO_URL || '').replace(/\/+$/, ''),
    key: process.env.WOO_CONSUMER_KEY || '',
    secret: process.env.WOO_CONSUMER_SECRET || '',
    webhookSecret: process.env.WOO_WEBHOOK_SECRET || '',
    env: true,
  };
}

/** All shops, with their secrets. Server-side only; send publicShop() to the browser. */
export async function listShops() {
  const saved = (await kvGet('shops')) || [];
  const e = envShop();
  return e ? [e, ...saved.filter((s) => s.id !== e.id)] : saved;
}

export async function getShop(id) {
  return (await listShops()).find((s) => s.id === id) || null;
}

export const hasApi = (s) => !!(s && s.url && s.key && s.secret);

export function publicShop(s, { admin = false } = {}) {
  return {
    id: s.id,
    name: s.name,
    url: s.url,
    env: !!s.env,
    api: hasApi(s),
    webhook: !!s.webhookSecret,
    ...(admin ? { webhookPath: '/api/integrations/woocommerce?shop=' + encodeURIComponent(s.id), webhookSecret: s.webhookSecret, keyHint: s.key ? s.key.slice(0, 7) + '…' + s.key.slice(-4) : '' } : {}),
  };
}

export async function saveShop(input) {
  const name = str(input.name, 60);
  let url = str(input.url, 200).replace(/\/+$/, '');
  if (!name) throw new HttpError(400, 'no_name', 'Upiši naziv shopa, npr. KupiLenovo.');
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (url && !/^https:\/\//i.test(url)) throw new HttpError(400, 'https', 'Adresa shopa mora počinjati s https:// (ključevi se ne šalju bez šifrovane veze).');
  const shops = (await kvGet('shops')) || [];
  const id = input.id || slug(name);
  if (id === 'web' && envShop()) throw new HttpError(400, 'env', 'Ovaj shop je podešen u Vercelu (WOO_* varijable) i mijenja se tamo.');
  const cur = shops.find((s) => s.id === id);
  if (!input.id && cur) throw new HttpError(409, 'taken', 'Shop s tim nazivom već postoji.');
  const key = str(input.key, 200);
  const secret = str(input.secret, 200);
  if (key && !/^ck_/.test(key)) throw new HttpError(400, 'bad_key', 'Consumer key počinje s ck_ (WooCommerce → Postavke → Napredno → REST API).');
  if (secret && !/^cs_/.test(secret)) throw new HttpError(400, 'bad_secret', 'Consumer secret počinje s cs_.');
  const shop = {
    id,
    name,
    url,
    key: key || cur?.key || '',
    secret: secret || cur?.secret || '',
    webhookSecret: cur?.webhookSecret || randomSecret(),
    createdAt: cur?.createdAt || Date.now(),
  };
  await kvSet('shops', [...shops.filter((s) => s.id !== id), shop]);
  return shop;
}

export async function deleteShop(id) {
  const shops = (await kvGet('shops')) || [];
  await kvSet('shops', shops.filter((s) => s.id !== id));
}

/** Which configured shop an email or webhook belongs to: by name ("KupiTelevizor") or by web address. */
export function matchShop(shops, { name = '', url = '', email = '' } = {}) {
  const n = fold(name).replace(/\s+/g, '');
  const host = hostOf(url) || (String(email).split('@')[1] || '').toLowerCase();
  return shops.find((s) => n && fold(s.name).replace(/\s+/g, '') === n)
    || shops.find((s) => host && hostOf(s.url) && (host === hostOf(s.url) || host.endsWith('.' + hostOf(s.url))))
    || shops.find((s) => n && hostOf(s.url).replace(/\.[a-z]+$/, '').replace(/[^a-z0-9]/g, '') === n)
    || null;
}

/** A stable key for an order, so the same order from the webhook, the API and the email is one item. */
export const orderKey = (shopIdOrName, number) => `${slug(shopIdOrName)}:${String(number).replace(/\D/g, '')}`;

export function adminUrl(shop, { id, number } = {}) {
  if (!shop?.url) return '';
  if (id) return `${shop.url}/wp-admin/post.php?post=${id}&action=edit`;
  if (number) return `${shop.url}/wp-admin/edit.php?post_type=shop_order&s=${encodeURIComponent(number)}`;
  return '';
}

/* ---------------- WooCommerce REST API (wc/v3) ---------------- */
/** The only request that may change anything in a shop. */
export const isAllowedWrite = (method, path, body) =>
  method === 'PUT' && /^\/orders\/\d+$/.test(path) && !!body && Object.keys(body).length === 1 && body.status === 'completed';

function shopError(shop, status, data) {
  const msg = data && typeof data === 'object' ? data.message || data.code : '';
  if (status === 401) return `${shop.name} odbija ključ (401). Provjeri Consumer key/secret i da ključ ima dozvolu Čitanje/Pisanje.`;
  if (status === 403) return `${shop.name} ne dozvoljava pristup (403). Provjeri da ključ ima dozvolu Čitanje/Pisanje, i da zaštita sajta (Wordfence, Cloudflare, hosting) ne blokira /wp-json/wc/v3.`;
  if (status === 404) return msg && /order|narud|invalid id/i.test(msg) ? `Ta narudžba ne postoji u shopu ${shop.name}.` : `${shop.name}: REST API nije pronađen na ${shop.url} (provjeri adresu i da je WooCommerce aktivan).`;
  return `${shop.name} je vratio grešku ${status}${msg ? ': ' + String(msg).slice(0, 160) : ''}.`;
}

export async function wc(shop, method, path, { query = {}, body, fetchImpl = fetch } = {}) {
  if (!hasApi(shop)) throw new HttpError(400, 'no_api', `${shop?.name || 'Shop'} nema API ključeve. Dodaj ih u Postavke → Web shopovi.`);
  if (method !== 'GET' && !isAllowedWrite(method, path, body)) throw new HttpError(403, 'write_blocked', 'Aplikacija u shopu smije samo promijeniti status iz „Procesuiranje” u „Završeno”.');
  const u = new URL(shop.url + '/wp-json/wc/v3' + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const headers = { Accept: 'application/json', 'User-Agent': 'STT-Logistika/1.0' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const send = (url, auth) => fetchImpl(url, {
    method,
    headers: auth ? { ...headers, Authorization: 'Basic ' + Buffer.from(shop.key + ':' + shop.secret).toString('base64') } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let r;
  try {
    r = await send(u, true);
    // Some hosts strip the Authorization header before WordPress sees it; WooCommerce also accepts the key in the
    // query string over HTTPS.
    if (r.status === 401) {
      const q = new URL(u);
      q.searchParams.set('consumer_key', shop.key);
      q.searchParams.set('consumer_secret', shop.secret);
      r = await send(q, false);
    }
  } catch (e) {
    throw new HttpError(502, 'shop_unreachable', `${shop.name} se ne javlja (${e.name === 'TimeoutError' ? 'isteklo vrijeme' : e.message}).`);
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!r.ok) throw new HttpError(502, 'shop_error', shopError(shop, r.status, data));
  if (data === null) throw new HttpError(502, 'shop_bad_reply', `${shop.name} nije vratio ispravan odgovor (možda blokira API zahtjeve).`);
  return data;
}

export async function testShop(shop, { fetchImpl } = {}) {
  const orders = await wc(shop, 'GET', '/orders', { query: { per_page: 1 }, fetchImpl });
  const last = Array.isArray(orders) ? orders[0] : null;
  return { ok: true, lastOrder: last ? { number: String(last.number || last.id), date: last.date_created } : null };
}

/** An order by its WooCommerce id, or by the number customers see (usually the same; not with numbering plugins). */
export async function findOrder(shop, { id, number }, { fetchImpl } = {}) {
  if (id) return wc(shop, 'GET', `/orders/${encodeURIComponent(id)}`, { fetchImpl });
  const n = String(number || '').replace(/\D/g, '');
  if (!n) throw new HttpError(400, 'no_order', 'Nedostaje broj narudžbe.');
  try {
    const o = await wc(shop, 'GET', `/orders/${n}`, { fetchImpl });
    if (String(o.number || o.id) === n) return o;
  } catch (e) { if (!/ne postoji/.test(e.message)) throw e; }
  const found = await wc(shop, 'GET', '/orders', { query: { search: n, per_page: 10 }, fetchImpl });
  const o = (Array.isArray(found) ? found : []).find((x) => String(x.number) === n);
  if (!o) throw new HttpError(404, 'not_found', `Narudžba #${n} ne postoji u shopu ${shop.name}.`);
  return o;
}

/**
 * Procesuiranje → Završeno, and nothing else: the order is read first and only a "processing" order is changed.
 * The request body is exactly { status: "completed" }.
 */
export async function completeOrder(shop, id, { fetchImpl } = {}) {
  const cur = await wc(shop, 'GET', `/orders/${encodeURIComponent(id)}`, { fetchImpl });
  if (cur.status !== 'processing') throw new HttpError(409, 'not_processing', `Narudžba #${cur.number || id} u shopu ${shop.name} nije u statusu „Procesuiranje”, pa se ne mijenja.`);
  return wc(shop, 'PUT', `/orders/${encodeURIComponent(cur.id)}`, { body: { status: 'completed' }, fetchImpl });
}

/** Orders created or changed in the last `days` days, newest first (up to 100). */
export async function recentOrders(shop, days = 3, { fetchImpl } = {}) {
  const after = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19);
  const out = [];
  for (let page = 1; page <= 2; page += 1) {
    const rows = await wc(shop, 'GET', '/orders', { query: { modified_after: after, per_page: 50, page, orderby: 'date', order: 'desc' }, fetchImpl });
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < 50) break;
  }
  return out;
}
