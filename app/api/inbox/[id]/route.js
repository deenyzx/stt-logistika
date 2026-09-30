// Actions on a Prijem item:
//   { action: 'accept', as?: 'narudzba' | 'zadatak', dept?, assignee? }  → becomes an order (or a task to answer it)
//   { action: 'attach', taskId }                                          → added to an existing order as a comment
//   { action: 'resolve' | 'dismiss' | 'restore' }                        → riješeno / odbačeno / back to Novo
//   { action: 'kind', kind: 'narudzba' | 'upit' | 'ostalo' }              → re-sort an email
import { route, json, body, HttpError } from '@/lib/http.js';
import { acceptInbox, attachInbox, setInboxStatus, setInboxKind } from '@/lib/domain.js';

export const POST = route('prijem', async (req, { user, params }) => {
  const b = await body(req);
  switch (b.action) {
    case 'accept': return json(await acceptInbox(params.id, user, { as: b.as, dept: b.dept, assignee: b.assignee }));
    case 'attach': return json(await attachInbox(params.id, String(b.taskId || ''), user));
    case 'resolve': return json({ item: await setInboxStatus(params.id, 'rijeseno', user) });
    case 'dismiss': return json({ item: await setInboxStatus(params.id, 'odbaceno', user) });
    case 'restore': return json({ item: await setInboxStatus(params.id, 'novo', user) });
    case 'kind': return json({ item: await setInboxKind(params.id, b.kind, user) });
    default: throw new HttpError(400, 'bad_action', 'Nepoznata radnja.');
  }
});
