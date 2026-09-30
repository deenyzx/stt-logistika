// Morning reminder: goods arriving today (or late), due dates, orders to fill in, reservations running out.
// Vercel Cron calls this once a day (vercel.json) with Authorization: Bearer <CRON_SECRET>. Safe to call twice:
// each day's reminder goes out only once.
import { json, errorResponse } from '@/lib/http.js';
import { safeEqual } from '@/lib/integrations.js';
import { dailyDigest } from '@/lib/domain.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const secret = process.env.CRON_SECRET || '';
  if (secret.length < 16) return json({ error: 'not_configured', message: 'Postavi CRON_SECRET u Vercelu.' }, 503);
  if (!safeEqual(req.headers.get('authorization') || '', 'Bearer ' + secret)) return json({ error: 'unauthorized' }, 401);
  try {
    return json(await dailyDigest());
  } catch (e) {
    return errorResponse(e);
  }
}
