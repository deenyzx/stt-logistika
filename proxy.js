import { NextResponse } from 'next/server';
import { sessionFromRequest } from './lib/auth.js';

// Everything needs a signed-in session, except the login page, the service worker/manifest and the integrations
// (WooCommerce, email, the office agent) and the daily cron, which check their own secrets.
const OPEN = new Set(['/login', '/api/login', '/api/logout', '/sw.js', '/manifest.webmanifest']);

export async function proxy(req) {
  const { pathname } = req.nextUrl;
  if (OPEN.has(pathname) || pathname.startsWith('/api/integrations/') || pathname.startsWith('/api/cron/')) return NextResponse.next();
  if (await sessionFromRequest(req)) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|fonts/|icons/|favicon.ico|icon.svg|robots.txt).*)'],
};
