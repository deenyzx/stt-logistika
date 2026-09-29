import { route, json, body } from '@/lib/http.js';
import { updateReservation, deleteReservation } from '@/lib/domain.js';

export const PATCH = route('rezervacije', async (req, { user, params }) => {
  const reservation = await updateReservation(params.id, await body(req), user);
  return json({ reservation });
});

export const DELETE = route('rezervacije', async (req, { user, params }) => {
  await deleteReservation(params.id, user);
  return json({ ok: true });
});
