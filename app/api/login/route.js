import { NextResponse } from 'next/server';
import { COOKIE, signSession, cookieOptions, passVersion } from '@/lib/auth.js';
import { login } from '@/lib/users.js';

export async function POST(req) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!process.env.ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  const user = username && password ? await login(String(username), String(password)) : null;
  if (!user) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    return NextResponse.json({ ok: false, error: 'wrong' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await signSession({ uid: user.id, role: user.role, pv: await passVersion(user) }), cookieOptions());
  return res;
}
