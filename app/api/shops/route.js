// Admin: the web shops (KupiLenovo, KupiTelevizor, …) and their WooCommerce API keys.
import { route, json, body, HttpError } from '@/lib/http.js';
import { listShops, saveShop, deleteShop, publicShop } from '@/lib/shops.js';

export const GET = route('korisnici', async () => json({ shops: (await listShops()).map((s) => publicShop(s, { admin: true })) }));

// { id?, name, url, key?, secret? } — leave key/secret empty to keep the saved ones.
export const POST = route('korisnici', async (req) => {
  const shop = await saveShop(await body(req));
  return json({ shop: publicShop(shop, { admin: true }) });
});

export const DELETE = route('korisnici', async (req) => {
  const b = await body(req);
  if (!b.id) throw new HttpError(400, 'no_id', 'Nedostaje shop.');
  await deleteShop(String(b.id));
  return json({ ok: true });
});
