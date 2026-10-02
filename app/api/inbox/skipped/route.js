// A skipped email that does matter: { id, kind: 'narudzba' | 'upit' | 'ostalo', remember? } brings it into Prijem
// (remember = every email from this sender goes the same way from now on).
import { route, json, body } from '@/lib/http.js';
import { restoreSkipped } from '@/lib/domain.js';

export const POST = route('prijem', async (req, { user }) => {
  const b = await body(req);
  const r = await restoreSkipped(String(b.id || ''), b.kind, user, { remember: !!b.remember });
  return json({ item: r.item });
});
