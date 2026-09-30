// Everything the signed-in person sees. The browser polls with ?ver=N; while nothing changed this costs one Redis read.
import { json } from '@/lib/http.js';
import { sessionFromRequest } from '@/lib/auth.js';
import { getVer, storeKind } from '@/lib/store.js';
import { currentUser, publicUser } from '@/lib/users.js';
import { dataFor } from '@/lib/domain.js';
import { notificationsFor, pushEnabled, pushPublicKey } from '@/lib/notify.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!(await sessionFromRequest(req))) return json({ error: 'unauthorized' }, 401);
  const since = req.nextUrl.searchParams.get('ver');
  const ver = await getVer();
  if (since !== null && Number(since) === ver) return json({ ver, same: true });
  const user = await currentUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const [data, notifications] = await Promise.all([dataFor(user), notificationsFor(user)]);
  const admin = user.role === 'admin';
  return json({
    ver,
    store: storeKind,
    me: publicUser(user),
    ...data,
    notifications,
    push: { enabled: pushEnabled(), publicKey: pushPublicKey() },
    integrations: {
      woo: !!process.env.WOO_WEBHOOK_SECRET,
      email: !!process.env.EMAIL_INBOUND_SECRET,
      agent: !!process.env.STOCK_AGENT_TOKEN,
      cron: (process.env.CRON_SECRET || '').length >= 16,
      // Only the admin sees the secret part of the email address.
      emailPath: admin && process.env.EMAIL_INBOUND_SECRET ? '/api/integrations/email/' + process.env.EMAIL_INBOUND_SECRET : null,
    },
  });
}
