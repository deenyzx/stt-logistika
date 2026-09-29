// Change your own password: { oldPassword, newPassword }. The session is renewed so you stay signed in.
import { route, json, body } from '@/lib/http.js';
import { changeOwnPassword } from '@/lib/users.js';
import { COOKIE, signSession, cookieOptions, passVersion } from '@/lib/auth.js';

export const PATCH = route(null, async (req, { user }) => {
  const b = await body(req);
  const u = await changeOwnPassword(user, String(b.oldPassword || ''), String(b.newPassword || ''));
  const res = json({ ok: true });
  res.cookies.set(COOKIE, await signSession({ uid: u.id, role: u.role, pv: await passVersion(u) }), cookieOptions());
  return res;
});
