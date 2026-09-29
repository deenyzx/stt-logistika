// { action: 'accept', dept?, assignee? } turns the item into an order; 'dismiss' and 'restore' move it out of / back into the inbox.
import { route, json, body, HttpError } from '@/lib/http.js';
import { acceptInbox, setInboxStatus } from '@/lib/domain.js';

export const POST = route('prijem', async (req, { user, params }) => {
  const b = await body(req);
  if (b.action === 'accept') return json(await acceptInbox(params.id, user, { dept: b.dept, assignee: b.assignee }));
  if (b.action === 'dismiss') return json({ item: await setInboxStatus(params.id, 'odbaceno', user) });
  if (b.action === 'restore') return json({ item: await setInboxStatus(params.id, 'novo', user) });
  throw new HttpError(400, 'bad_action', 'Nepoznata radnja.');
});
