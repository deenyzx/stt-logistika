// WooCommerce → Settings → Advanced → Webhooks: topic "Order created" (and optionally "Order updated"),
// delivery URL https://<domain>/api/integrations/woocommerce, secret = WOO_WEBHOOK_SECRET.
import { json, errorResponse } from '@/lib/http.js';
import { verifyWoo, wooOrderToInbox } from '@/lib/integrations.js';
import { addInbox } from '@/lib/domain.js';

export async function POST(req) {
  const secret = process.env.WOO_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'not_configured' }, 503);
  const raw = await req.text();
  // When the webhook is saved WooCommerce sends a ping ("webhook_id=12"). Answer 200 so it stays active.
  if (!raw.trim().startsWith('{')) return json({ ok: true, ping: true });
  if (!(await verifyWoo(raw, req.headers.get('x-wc-webhook-signature'), secret))) return json({ error: 'bad_signature' }, 401);
  let order;
  try { order = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const topic = req.headers.get('x-wc-webhook-topic') || 'order.created';
  if (!topic.startsWith('order.') || !order?.id || !Array.isArray(order.line_items)) return json({ ok: true, ignored: true });
  try {
    const item = wooOrderToInbox(order, req.headers.get('x-wc-webhook-source') || '');
    const r = await addInbox(item, { updateOnly: topic !== 'order.created' });
    return json({ ok: true, id: r.item?.id || null, duplicate: !!r.duplicate, ignored: !!r.ignored });
  } catch (e) {
    return errorResponse(e);
  }
}
