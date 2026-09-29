import { route, json, body } from '@/lib/http.js';
import { listUsers, createUser, publicUser } from '@/lib/users.js';

export const GET = route('korisnici', async () => json({ users: (await listUsers()).map(publicUser) }));

export const POST = route('korisnici', async (req) => {
  const user = await createUser(await body(req));
  return json({ user: publicUser(user) });
});
