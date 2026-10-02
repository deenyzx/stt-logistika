// Prijenosnice: POST { date, from, to, items: [{ code, name, qty, buy, sell, note }], note, comment } → a new one.
import { route, json, body } from '@/lib/http.js';
import { createTransfer } from '@/lib/transfers.js';

export const POST = route('prijenosnice', async (req, { user }) => json({ transfer: await createTransfer(await body(req), user) }));
