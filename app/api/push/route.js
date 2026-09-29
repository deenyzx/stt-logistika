// Push notifications on this device: POST { subscription } to turn on, POST { test: true } to try, DELETE { endpoint } to turn off.
import { route, json, body, HttpError } from '@/lib/http.js';
import { pushSubSave, pushSubDel } from '@/lib/store.js';
import { pushEnabled, sendTestPush } from '@/lib/notify.js';

async function subId(endpoint) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint)));
  return Buffer.from(d).toString('hex').slice(0, 24);
}

export const POST = route(null, async (req, { user }) => {
  if (!pushEnabled()) throw new HttpError(503, 'push_off', 'Push obavijesti nisu podešene na serveru (VAPID ključevi).');
  const b = await body(req);
  if (b.test) return json({ sent: await sendTestPush(user) });
  const sub = b.subscription;
  if (!sub || typeof sub.endpoint !== 'string' || !sub.keys?.p256dh || !sub.keys?.auth) throw new HttpError(400, 'bad_sub', 'Neispravna pretplata.');
  if (!/^https:\/\//.test(sub.endpoint)) throw new HttpError(400, 'bad_sub', 'Neispravna pretplata.');
  await pushSubSave(await subId(sub.endpoint), { userId: user.id, sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, at: Date.now(), ua: String(req.headers.get('user-agent') || '').slice(0, 160) });
  return json({ ok: true });
});

export const DELETE = route(null, async (req) => {
  const b = await body(req);
  if (b.endpoint) await pushSubDel(await subId(b.endpoint));
  return json({ ok: true });
});
