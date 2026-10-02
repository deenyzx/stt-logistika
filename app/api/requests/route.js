// Upiti MP: POST { date, pn, code, name, qty, customer, question } → a new one (veleprodaja is notified).
import { route, json, body } from '@/lib/http.js';
import { createRequest } from '@/lib/requests.js';

export const POST = route('upiti', async (req, { user }) => json({ request: await createRequest(await body(req), user) }));
