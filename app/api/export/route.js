// Admin: download everything as one JSON file (a backup, and something to hand over when the new ERP arrives).
import { NextResponse } from 'next/server';
import { route } from '@/lib/http.js';
import { all, kvGet } from '@/lib/store.js';
import { todayISO } from '@/lib/format.js';

export const GET = route('korisnici', async () => {
  const [tasks, reservations, inbox, stockdiffs, users, settings] = await Promise.all([
    all('tasks'), all('reservations'), all('inbox'), all('stockdiffs'), all('users'), kvGet('settings'),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    tasks,
    reservations,
    inbox,
    stockdiffs,
    users: users.map(({ pw, ...u }) => u), // never the password hashes
    settings,
  };
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="stt-logistika-${todayISO()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
});
