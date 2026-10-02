// An order as the web shop sees it right now, and the one change the app may make there.
//   GET  ?inboxId=…  or  ?taskId=…               → { connected, order: { status, … }, canComplete }
//   POST { inboxId?, taskId?, orderId }           → Procesuiranje → Završeno in the shop (nothing else is sent)
import { route, json, body } from '@/lib/http.js';
import { shopOrderInfo, completeShopOrder } from '@/lib/domain.js';

export const dynamic = 'force-dynamic';

export const GET = route('webshop', async (req) => {
  const q = req.nextUrl.searchParams;
  return json(await shopOrderInfo({ shopId: q.get('shopId') || '', inboxId: q.get('inboxId') || '', taskId: q.get('taskId') || '' }));
});

export const POST = route('webshop', async (req, { user }) => {
  const b = await body(req);
  return json(await completeShopOrder({ shopId: b.shopId, inboxId: b.inboxId, taskId: b.taskId, orderId: b.orderId }, user));
});
