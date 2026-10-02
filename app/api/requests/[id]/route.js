// PATCH: the question's fields, or { answer, status } (veleprodaja), or { status: 'zavrseno' | 'novi' }.
import { route, json, body } from '@/lib/http.js';
import { updateRequest, deleteRequest } from '@/lib/requests.js';

export const PATCH = route('upiti', async (req, { user, params }) => json({ request: await updateRequest(params.id, await body(req), user) }));

export const DELETE = route('upiti', async (req, { user, params }) => {
  await deleteRequest(params.id, user);
  return json({ ok: true });
});
