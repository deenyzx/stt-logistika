// PATCH: content, per-line status ({ lines: [{ id, status, sentQty, note }] }), or { action: ship|receive|cancel|reopen }.
import { route, json, body } from '@/lib/http.js';
import { updateTransfer, deleteTransfer } from '@/lib/transfers.js';

export const PATCH = route('prijenosnice', async (req, { user, params }) => json({ transfer: await updateTransfer(params.id, await body(req), user) }));

export const DELETE = route('prijenosnice', async (req, { user, params }) => {
  await deleteTransfer(params.id, user);
  return json({ ok: true });
});
