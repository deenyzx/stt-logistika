// Which notification categories this person wants: { muted: ['stock', 'res', …] } (everything else is on).
import { route, json, body } from '@/lib/http.js';
import { prefsGet, prefsSet } from '@/lib/store.js';
import { NOTIF_CATS } from '@/lib/constants.js';

export const PATCH = route(null, async (req, { user }) => {
  const b = await body(req);
  const muted = (Array.isArray(b.muted) ? b.muted : []).filter((c) => Object.prototype.hasOwnProperty.call(NOTIF_CATS, c));
  const prefs = { ...(await prefsGet(user.id)), muted: [...new Set(muted)] };
  await prefsSet(user.id, prefs);
  return json({ prefs });
});
