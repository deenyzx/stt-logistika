// Downloads.
//   /api/export?what=prijenosnice|upiti|rezervacije|zadaci|prijem|artikli → that list as CSV (for Excel), for anyone
//     who can open that part of the app. Everything in the database, finished items included.
//   /api/export → admin only: everything as one JSON file (a backup, and something to hand over to the new ERP).
import { NextResponse } from 'next/server';
import { route, json } from '@/lib/http.js';
import { all, kvGet } from '@/lib/store.js';
import { can } from '@/lib/constants.js';
import { todayISO } from '@/lib/format.js';
import { EXPORTS } from '@/lib/exportCsv.js';
import { listArticles } from '@/lib/articles.js';

export const dynamic = 'force-dynamic';

const download = (body, type, name) => new NextResponse(body, {
  headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
});

export const GET = route(null, async (req, { user }) => {
  const what = req.nextUrl.searchParams.get('what');
  if (what) {
    const ex = EXPORTS[what];
    if (!ex) return json({ error: 'unknown', message: 'Nepoznat izvoz.' }, 404);
    if (!can(user.role, ex.area)) return json({ error: 'forbidden', message: 'Nemaš pristup ovom dijelu.' }, 403);
    const [transfers, requests, reservations, tasks, inbox, users, articles] = await Promise.all([
      what === 'prijenosnice' ? all('transfers') : [],
      what === 'upiti' ? all('requests') : [],
      what === 'rezervacije' ? all('reservations') : [],
      what === 'zadaci' ? all('tasks') : [],
      what === 'prijem' ? all('inbox') : [],
      all('users'),
      what === 'artikli' ? listArticles({ limit: Infinity }).then((r) => r.items) : [],
    ]);
    const csv = ex.build({ transfers, requests, reservations, tasks, inbox, users, articles });
    return download(csv, 'text/csv; charset=utf-8', `stt-${ex.file}-${todayISO()}.csv`);
  }

  if (!can(user.role, 'korisnici')) return json({ error: 'forbidden', message: 'Cijelu bazu preuzima administrator.' }, 403);
  const [tasks, reservations, inbox, stockdiffs, users, settings, transfers, requests] = await Promise.all([
    all('tasks'), all('reservations'), all('inbox'), all('stockdiffs'), all('users'), kvGet('settings'), all('transfers'), all('requests'),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    tasks,
    transfers,
    requests,
    reservations,
    inbox,
    stockdiffs,
    users: users.map(({ pw, ...u }) => u), // never the password hashes
    settings,
  };
  return download(JSON.stringify(data, null, 2), 'application/json; charset=utf-8', `stt-logistika-${todayISO()}.json`);
});
