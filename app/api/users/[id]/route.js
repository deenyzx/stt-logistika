import { route, json, body } from '@/lib/http.js';
import { updateUser, deleteUser, publicUser } from '@/lib/users.js';

// { name?, role?, password?, disabled? }
export const PATCH = route('korisnici', async (req, { user, params }) => {
  const u = await updateUser(params.id, await body(req), user);
  return json({ user: publicUser(u) });
});

export const DELETE = route('korisnici', async (req, { user, params }) => {
  await deleteUser(params.id, user);
  return json({ ok: true });
});
