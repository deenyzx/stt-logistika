import { route, json, body, HttpError } from '@/lib/http.js';
import { one } from '@/lib/store.js';
import { markStock, deleteStockDiff } from '@/lib/domain.js';

export const GET = route('zalihe', async (req, { params }) => {
  const diff = await one('stockdiffs', params.id);
  if (!diff) throw new HttpError(404, 'not_found', 'Ne postoji.');
  return json({ diff });
});

// { keys: ['21JK0008SC', ...], done: true } marks rows as updated on the web shop.
export const PATCH = route('zalihe', async (req, { user, params }) => {
  const b = await body(req);
  return json({ diff: await markStock(params.id, b.keys, !!b.done, user) });
});

export const DELETE = route('zalihe', async (req, { user, params }) => {
  if (user.role !== 'admin') throw new HttpError(403, 'forbidden', 'Samo administrator briše izvoze.');
  await deleteStockDiff(params.id);
  return json({ ok: true });
});
