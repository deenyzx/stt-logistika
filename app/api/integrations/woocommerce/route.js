// WooCommerce → Postavke → Napredno → Webhooks: topic "Order created" (and optionally "Order updated"),
// delivery URL https://<domain>/api/integrations/woocommerce?shop=<shop id> with that shop's secret
// (both shown in Postavke → Web shopovi). Without ?shop= the WOO_WEBHOOK_SECRET shop from env is used.
import { json, errorResponse } from '@/lib/http.js';
import { verifyWoo } from '@/lib/integrations.js';
import { listShops } from '@/lib/shops.js';
import { addInbox, shopOrderToItem } from '@/lib/domain.js';

export async function POST(req) {
  const shops = await listShops();
  const shopId = req.nextUrl.searchParams.get('shop') || 'web';
  const shop = shops.find((s) => s.id === shopId);
  if (!shop || !shop.webhookSecret) return json({ error: 'unknown_shop' }, 404);
  const raw = await req.text();
  // When the webhook is saved WooCommerce sends a ping ("webhook_id=12"). Answer 200 so it stays active.
  if (!raw.trim().startsWith('{')) return json({ ok: true, ping: true });
  if (!(await verifyWoo(raw, req.headers.get('x-wc-webhook-signature'), shop.webhookSecret))) return json({ error: 'bad_signature' }, 401);
  let order;
  try { order = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
  const topic = req.headers.get('x-wc-webhook-topic') || 'order.created';
  if (!topic.startsWith('order.') || !order?.id || !Array.isArray(order.line_items)) return json({ ok: true, ignored: true });
  try {
    const src = shop.url || req.headers.get('x-wc-webhook-source') || '';
    const r = await addInbox(shopOrderToItem(order, { ...shop, url: src.replace(/\/+$/, '') }), { updateOnly: topic !== 'order.created' });
    return json({ ok: true, id: r.item?.id || null, duplicate: !!r.duplicate, ignored: !!r.ignored });
  } catch (e) {
    return errorResponse(e);
  }
}
