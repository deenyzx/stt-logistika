import { route, json, body } from '@/lib/http.js';
import { updateTask, deleteTask } from '@/lib/domain.js';

export const PATCH = route('zadaci', async (req, { user, params }) => {
  const task = await updateTask(params.id, await body(req), user);
  return json({ task });
});

export const DELETE = route('zadaci', async (req, { user, params }) => {
  await deleteTask(params.id, user);
  return json({ ok: true });
});
