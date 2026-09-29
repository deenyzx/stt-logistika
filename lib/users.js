// Accounts. The admin from env (ADMIN_USERNAME / ADMIN_PASSWORD) always exists; everyone else is stored in Redis
// and managed in Postavke → Korisnici.
import { all, one, insert, mutate, remove } from './store.js';
import { envAdmin, hashPassword, verifyPassword, passVersion, sessionFromRequest } from './auth.js';
import { ROLES } from './constants.js';
import { fold } from './format.js';
import { HttpError, str } from './errors.js';

export const publicUser = (u) => (u ? { id: u.id, username: u.username, name: u.name, role: u.role, disabled: !!u.disabled, env: !!u.env } : null);

export async function listUsers() {
  const users = await all('users');
  const admin = envAdmin();
  const list = admin ? [admin, ...users.filter((u) => u.username !== admin.username)] : users;
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'bs'));
}

export async function getUser(id) {
  if (id === 'admin') return envAdmin();
  return one('users', id);
}

export async function findByUsername(username) {
  const u = fold(username);
  const admin = envAdmin();
  if (admin && admin.username === u) return admin;
  return (await all('users')).find((x) => x.username === u) || null;
}

export async function login(username, password) {
  const user = await findByUsername(username);
  if (!user || user.disabled) return null;
  const ok = user.env ? password === process.env.ADMIN_PASSWORD : await verifyPassword(password, user.pw);
  return ok ? user : null;
}

/** The signed-in user, re-checked against the database (disabled accounts and changed passwords end the session). */
export async function currentUser(req) {
  const s = await sessionFromRequest(req);
  if (!s) return null;
  const u = await getUser(s.uid);
  if (!u || u.disabled) return null;
  if (s.pv !== (await passVersion(u))) return null;
  return u;
}

const cleanUsername = (v) => fold(v).replace(/[^a-z0-9._-]/g, '');
const checkRole = (r) => { if (!ROLES[r]) throw new HttpError(400, 'bad_role', 'Nepoznata uloga.'); return r; };
const checkPassword = (p) => { if (String(p || '').length < 6) throw new HttpError(400, 'weak_password', 'Lozinka mora imati bar 6 znakova.'); return String(p); };

export async function createUser({ username, name, role, password }) {
  const un = cleanUsername(username);
  if (!un || un.length < 2) throw new HttpError(400, 'bad_username', 'Korisničko ime: bar 2 slova ili broja, bez razmaka.');
  if (await findByUsername(un)) throw new HttpError(409, 'taken', 'To korisničko ime već postoji.');
  const u = {
    id: 'u_' + crypto.randomUUID().slice(0, 8),
    username: un,
    name: str(name, 60) || un,
    role: checkRole(role),
    pw: await hashPassword(checkPassword(password)),
    createdAt: Date.now(),
  };
  return insert('users', u);
}

export async function updateUser(id, patch, actor) {
  if (id === 'admin') throw new HttpError(400, 'env_admin', 'Glavni administrator se mijenja u postavkama Vercela (ADMIN_PASSWORD).');
  const pw = patch.password ? await hashPassword(checkPassword(patch.password)) : null;
  if (patch.role) checkRole(patch.role);
  if (id === actor.id && (patch.disabled || (patch.role && patch.role !== 'admin'))) throw new HttpError(400, 'self', 'Ne možeš sebi ukinuti administratorski pristup.');
  const u = await mutate('users', id, (u) => {
    if (patch.name !== undefined) u.name = str(patch.name, 60) || u.username;
    if (patch.role) u.role = patch.role;
    if (patch.disabled !== undefined) u.disabled = !!patch.disabled;
    if (pw) u.pw = pw;
    return u;
  });
  if (!u) throw new HttpError(404, 'not_found', 'Korisnik ne postoji.');
  return u;
}

export async function deleteUser(id, actor) {
  if (id === 'admin') throw new HttpError(400, 'env_admin', 'Glavni administrator se ne može obrisati.');
  if (id === actor.id) throw new HttpError(400, 'self', 'Ne možeš obrisati sebe.');
  await remove('users', id);
}

export async function changeOwnPassword(user, oldPw, newPw) {
  if (user.env) throw new HttpError(400, 'env_admin', 'Lozinka glavnog administratora je ADMIN_PASSWORD u postavkama Vercela.');
  if (!(await verifyPassword(oldPw, user.pw))) throw new HttpError(400, 'wrong_password', 'Trenutna lozinka nije tačna.');
  const pw = await hashPassword(checkPassword(newPw));
  return mutate('users', user.id, (u) => { u.pw = pw; return u; });
}
