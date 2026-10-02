// Admin: check that a shop's API key works (reads the newest order; changes nothing).
import { route, json, body, HttpError } from '@/lib/http.js';
import { getShop, testShop } from '@/lib/shops.js';

export const POST = route('korisnici', async (req) => {
  const b = await body(req);
  const shop = await getShop(String(b.id || ''));
  if (!shop) throw new HttpError(404, 'not_found', 'Taj shop ne postoji.');
  return json(await testShop(shop));
});
