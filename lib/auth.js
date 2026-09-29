// Accounts with roles (admin, veleprodaja, maloprodaja). Passwords are PBKDF2 hashes; the session cookie is a
// signed, expiring token. Uses Web Crypto only, so it runs in the proxy and in API routes alike.
export const COOKIE = 'stt_session';
const SESSION_DAYS = 60;
const ITER = 120000;

const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

function eq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/* ---------- passwords ---------- */
async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITER);
  return `pbkdf2$${ITER}$${b64u(salt)}$${b64u(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64u(salt), Number(iter));
  return eq(b64u(got), hash);
}

/* ---------- the built-in admin from env (always works, so you can never lock yourself out) ---------- */
export function envAdmin() {
  if (!process.env.ADMIN_PASSWORD) return null;
  return {
    id: 'admin',
    username: (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase(),
    name: process.env.ADMIN_NAME || 'Administrator',
    role: 'admin',
    env: true,
  };
}

/* ---------- sessions ---------- */
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.ADMIN_PASSWORD) return 'stt-session:' + process.env.ADMIN_PASSWORD; // works, but set SESSION_SECRET
  return process.env.NODE_ENV === 'production' ? null : 'stt-dev-secret';
}

async function hmac(data) {
  const s = secret();
  if (!s) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// payload: { uid, role, name, pv } — pv changes when the password or role changes, which ends old sessions.
export async function signSession(payload) {
  const body = b64u(enc.encode(JSON.stringify({ ...payload, exp: Date.now() + SESSION_DAYS * 86400000 })));
  const sig = await hmac(body);
  if (!sig) throw new Error('no_secret');
  return body + '.' + sig;
}

export async function readSession(value) {
  if (!value || typeof value !== 'string') return null;
  const [body, sig] = value.split('.');
  if (!body || !sig) return null;
  const want = await hmac(body);
  if (!want || !eq(want, sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export async function sessionFromRequest(req) {
  return readSession(req.cookies.get(COOKIE)?.value);
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_DAYS * 86400,
});

// A short fingerprint of what should end a session when it changes (password hash + role + disabled).
export async function passVersion(user) {
  const pw = user.env ? 'env:' + (process.env.ADMIN_PASSWORD || '') : user.pw || '';
  const d = await crypto.subtle.digest('SHA-256', enc.encode([pw, user.role, user.disabled ? 1 : 0].join('|')));
  return b64u(d).slice(0, 12);
}
