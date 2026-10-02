// Emails forwarded by an inbound-email service (Postmark, Mailgun, SendGrid, a Cloudflare Email Worker) or by the
// office agent's IMAP reader. The secret in the URL is EMAIL_INBOUND_SECRET. Each email is sorted by ingestEmail():
// shop order emails become full orders, then the admin's rules, then keywords pick the tab. People choose the rest.
import { json, errorResponse } from '@/lib/http.js';
import { safeEqual } from '@/lib/integrations.js';
import { ingestEmail } from '@/lib/domain.js';

export async function POST(req, { params }) {
  const secret = process.env.EMAIL_INBOUND_SECRET || '';
  const { secret: given } = await params;
  if (secret.length < 16 || !safeEqual(given, secret)) return json({ error: 'not_found' }, 404);
  try {
    const ct = req.headers.get('content-type') || '';
    let payload;
    if (ct.includes('application/json')) payload = await req.json();
    else if (ct.includes('form')) {
      const fd = await req.formData();
      payload = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
    } else payload = { text: await req.text() };
    const r = await ingestEmail(payload || {});
    return json({ ok: true, id: r.item?.id || null, kind: r.item?.kind || null, duplicate: !!r.duplicate, skipped: !!r.skipped, reason: r.reason || null });
  } catch (e) {
    return errorResponse(e);
  }
}
