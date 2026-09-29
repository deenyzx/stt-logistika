// { read: true } marks all of this person's notifications as read.
import { route, json } from '@/lib/http.js';
import { readMarkSet } from '@/lib/store.js';

export const POST = route(null, async (req, { user }) => {
  await readMarkSet(user.id, Date.now());
  return json({ ok: true });
});
