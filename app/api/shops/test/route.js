// Admin: check that a shop's API keys work (reads the newest order and the shop's statuses).
import { route, json, body, HttpError } from '@/lib/http.js';
import { getShop, testShop, shopStatuses } from '@/lib/shops.js';
import { kvSet } from '@/lib/store.js';

export const POST = route('korisnici', async (req) => {
  const b = await body(req);
  const shop = await getShop(String(b.id || ''));
  if (!shop) throw new HttpError(404, 'not_found', 'Taj shop ne postoji.');
  const r = await testShop(shop);
  await kvSet('shopstatus:' + shop.id, null, { silent: true }); // re-read the statuses
  const statuses = await shopStatuses(shop);
  return json({ ...r, statuses });
});
