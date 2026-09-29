import { route, json, body } from '@/lib/http.js';
import { createTask } from '@/lib/domain.js';

export const POST = route('zadaci', async (req, { user }) => {
  const task = await createTask(await body(req), user);
  return json({ task });
});
