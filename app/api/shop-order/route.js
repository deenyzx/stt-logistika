// An order as the web shop sees it right now, and changing it there.
//   GET  ?inboxId=…  or  ?taskId=…            → { connected, order: { status, … }, notes, statuses }
//   POST { inboxId?, taskId?, orderId, status?, note?, customerNote? } → changes it in the shop
import { route, json, body } from '@/lib/http.js';
import { shopOrderInfo, changeShopOrder } from '@/lib/domain.js';

export const dynamic = 'force-dynamic';

export const GET = route('webshop', async (req) => {
  const q = req.nextUrl.searchParams;
  return json(await shopOrderInfo({ shopId: q.get('shopId') || '', inboxId: q.get('inboxId') || '', taskId: q.get('taskId') || '' }));
});

export const POST = route('webshop', async (req, { user }) => {
  const b = await body(req);
  return json(await changeShopOrder({
    shopId: b.shopId, inboxId: b.inboxId, taskId: b.taskId, orderId: b.orderId,
    status: b.status ? String(b.status) : '', note: b.note, customerNote: !!b.customerNote,
  }, user));
});
