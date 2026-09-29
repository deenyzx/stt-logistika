import { route, json, body } from '@/lib/http.js';
import { createReservation } from '@/lib/domain.js';

export const POST = route('rezervacije', async (req, { user }) => {
  const reservation = await createReservation(await body(req), user);
  return json({ reservation });
});
