// Where everything lives. Upstash Redis when its env vars are set (Vercel → Storage → Upstash for Redis),
// otherwise an in-memory copy that is NOT shared between devices or deploys (fine for local development only).
//
// Layout (prefix "stt", change with STORE_PREFIX):
//   stt:tasks, stt:reservations, stt:inbox, stt:stockdiffs, stt:users   hashes: id → JSON
//   stt:kv:<name>        JSON blobs (settings, the latest stock snapshot)
//   stt:seq:<N|Z|R>      counters for human numbers (N-0142)
//   stt:notifs           newest-first list of notifications (capped)
//   stt:notifread        hash: user id → time they last opened notifications
//   stt:push             hash: subscription id → { userId, sub }
//   stt:prefs            hash: user id → { muted: [notification categories] }
//   stt:ver              bumped on every write; the browser polls it to know when to reload
import { Redis } from '@upstash/redis';

// Vercel may add a custom prefix when connecting the store (e.g. STT_KV_REST_API_URL), so accept any prefix.
const env = (name) => process.env[name] || Object.entries(process.env).find(([k, v]) => k.endsWith('_' + name) && v)?.[1];
const url = process.env.UPSTASH_REDIS_REST_URL || env('KV_REST_API_URL');
const token = process.env.UPSTASH_REDIS_REST_TOKEN || env('KV_REST_API_TOKEN');
const redis = url && token ? new Redis({ url, token }) : null;
const P = process.env.STORE_PREFIX || 'stt';
const K = (...a) => [P, ...a].join(':');

export const storeKind = redis ? 'redis' : 'memory';

const mem = globalThis.__sttMem || (globalThis.__sttMem = { h: new Map(), s: new Map(), l: new Map() });
const memHash = (k) => { if (!mem.h.has(k)) mem.h.set(k, new Map()); return mem.h.get(k); };
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
// rev goes first so the save script can read it without a JSON library.
const dump = (obj) => { const { rev, ...rest } = obj; return JSON.stringify({ rev: rev || 0, ...rest }); };

const COLLS = ['tasks', 'reservations', 'inbox', 'stockdiffs', 'users', 'skipped'];
const assertColl = (c) => { if (!COLLS.includes(c)) throw new Error('unknown collection ' + c); };

/* ---------- version (cheap polling) ---------- */
export async function getVer() {
  if (!redis) return mem.s.get(K('ver')) || 0;
  return Number((await redis.get(K('ver'))) || 0);
}
async function bumpVer() {
  if (!redis) { mem.s.set(K('ver'), (mem.s.get(K('ver')) || 0) + 1); return; }
  await redis.incr(K('ver'));
}

/* ---------- collections ---------- */
export async function all(coll) {
  assertColl(coll);
  if (!redis) return [...memHash(K(coll)).values()].map((v) => JSON.parse(v));
  const h = await redis.hgetall(K(coll));
  return h ? Object.values(h).map(parse) : [];
}

export async function one(coll, id) {
  assertColl(coll);
  if (!id) return null;
  if (!redis) { const v = memHash(K(coll)).get(id); return v ? JSON.parse(v) : null; }
  const v = await redis.hget(K(coll), id);
  return v ? parse(v) : null;
}

export async function insert(coll, obj) {
  assertColl(coll);
  const o = { ...obj, rev: 1 };
  if (!redis) { memHash(K(coll)).set(o.id, dump(o)); await bumpVer(); return o; }
  await redis.hset(K(coll), { [o.id]: dump(o) });
  await bumpVer();
  return o;
}

export async function remove(coll, id) {
  assertColl(coll);
  if (!redis) { memHash(K(coll)).delete(id); await bumpVer(); return; }
  await redis.hdel(K(coll), id);
  await bumpVer();
}

// Save only if nobody saved this entity in between. 1 = saved, 0 = someone else saved first, -1 = gone.
const CAS = `local cur = redis.call('HGET', KEYS[1], ARGV[1])
if not cur then return -1 end
local rev = string.match(cur, '^{"rev":(%d+)') or '0'
if rev ~= ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('INCR', KEYS[2])
return 1`;

async function cas(coll, id, expectedRev, next) {
  if (!redis) {
    const h = memHash(K(coll));
    const cur = h.get(id);
    if (!cur) return -1;
    if ((JSON.parse(cur).rev || 0) !== expectedRev) return 0;
    h.set(id, dump(next));
    await bumpVer();
    return 1;
  }
  return Number(await redis.eval(CAS, [K(coll), K('ver')], [id, String(expectedRev), dump(next)]));
}

/** Read → change → save, retrying if a colleague saved the same thing at the same moment.
 *  fn gets a copy and returns the new object, or null/undefined to leave it as it is. */
export async function mutate(coll, id, fn) {
  assertColl(coll);
  for (let i = 0; i < 8; i += 1) {
    const cur = await one(coll, id);
    if (!cur) return null;
    const next = fn(structuredClone(cur));
    if (!next) return cur;
    next.rev = (cur.rev || 0) + 1;
    next.updatedAt = Date.now();
    const r = await cas(coll, id, cur.rev || 0, next);
    if (r === 1) return next;
    if (r === -1) return null;
    await new Promise((res) => setTimeout(res, 40 + Math.random() * 120));
  }
  throw new Error('Nije sačuvano: previše izmjena u isto vrijeme. Pokušaj ponovo.');
}

/* ---------- counters and blobs ---------- */
export async function nextSeq(name) {
  if (!redis) { const k = K('seq', name); const n = (mem.s.get(k) || 0) + 1; mem.s.set(k, n); return n; }
  return Number(await redis.incr(K('seq', name)));
}

export async function kvGet(name) {
  if (!redis) { const v = mem.s.get(K('kv', name)); return v ? JSON.parse(v) : null; }
  const v = await redis.get(K('kv', name));
  return v ? parse(v) : null;
}

export async function kvSet(name, obj, { silent = false } = {}) {
  if (!redis) mem.s.set(K('kv', name), JSON.stringify(obj));
  else await redis.set(K('kv', name), JSON.stringify(obj));
  if (!silent) await bumpVer();
}

/* ---------- notifications ---------- */
const NOTIF_MAX = 400;
export async function notifAdd(n) {
  if (!redis) {
    const l = mem.l.get(K('notifs')) || [];
    l.unshift(JSON.stringify(n));
    mem.l.set(K('notifs'), l.slice(0, NOTIF_MAX));
    await bumpVer();
    return;
  }
  await redis.lpush(K('notifs'), JSON.stringify(n));
  await redis.ltrim(K('notifs'), 0, NOTIF_MAX - 1);
  await bumpVer();
}

export async function notifList(limit = NOTIF_MAX) {
  if (!redis) return (mem.l.get(K('notifs')) || []).slice(0, limit).map((v) => JSON.parse(v));
  const rows = await redis.lrange(K('notifs'), 0, limit - 1);
  return rows.map(parse);
}

export async function readMarkGet(userId) {
  if (!redis) return Number(memHash(K('notifread')).get(userId) || 0);
  return Number((await redis.hget(K('notifread'), userId)) || 0);
}

export async function readMarkSet(userId, ts) {
  if (!redis) { memHash(K('notifread')).set(userId, String(ts)); await bumpVer(); return; }
  await redis.hset(K('notifread'), { [userId]: String(ts) });
  await bumpVer();
}

/* ---------- personal notification settings: user id → { muted: ['stock', …] } ---------- */
export async function prefsAll() {
  if (!redis) return Object.fromEntries([...memHash(K('prefs')).entries()].map(([id, v]) => [id, JSON.parse(v)]));
  const h = await redis.hgetall(K('prefs'));
  return h ? Object.fromEntries(Object.entries(h).map(([id, v]) => [id, parse(v)])) : {};
}

export async function prefsGet(userId) {
  if (!redis) { const v = memHash(K('prefs')).get(userId); return v ? JSON.parse(v) : {}; }
  const v = await redis.hget(K('prefs'), userId);
  return v ? parse(v) : {};
}

export async function prefsSet(userId, obj) {
  if (!redis) { memHash(K('prefs')).set(userId, JSON.stringify(obj)); await bumpVer(); return; }
  await redis.hset(K('prefs'), { [userId]: JSON.stringify(obj) });
  await bumpVer();
}

/* ---------- web push subscriptions ---------- */
export async function pushSubs() {
  if (!redis) return [...memHash(K('push')).entries()].map(([id, v]) => ({ id, ...JSON.parse(v) }));
  const h = await redis.hgetall(K('push'));
  return h ? Object.entries(h).map(([id, v]) => ({ id, ...parse(v) })) : [];
}

export async function pushSubSave(id, obj) {
  if (!redis) { memHash(K('push')).set(id, JSON.stringify(obj)); return; }
  await redis.hset(K('push'), { [id]: JSON.stringify(obj) });
}

export async function pushSubDel(id) {
  if (!redis) { memHash(K('push')).delete(id); return; }
  await redis.hdel(K('push'), id);
}
