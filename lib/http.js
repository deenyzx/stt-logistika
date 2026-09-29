// Helpers for the API routes: JSON responses, the signed-in-user wrapper, errors as JSON.
import { NextResponse } from 'next/server';
import { HttpError } from './errors.js';
import { currentUser } from './users.js';
import { can } from './constants.js';

export { HttpError, str, isoDate, num, oneOf } from './errors.js';

export const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function body(req) {
  try { return await req.json(); } catch { throw new HttpError(400, 'bad_json', 'Neispravan zahtjev.'); }
}

/** Wraps a route handler: signs in the user (401 if not), checks the area (403), turns HttpErrors into JSON. */
export function route(area, handler) {
  return async (req, ctx) => {
    const user = await currentUser(req);
    if (!user) return json({ error: 'unauthorized', message: 'Prijavi se ponovo.' }, 401);
    if (area && !can(user.role, area)) return json({ error: 'forbidden', message: 'Nemaš pristup ovom dijelu.' }, 403);
    try {
      const params = ctx && ctx.params ? await ctx.params : {};
      return await handler(req, { user, params });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e) {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
  console.error(e);
  return json({ error: 'server', message: 'Greška na serveru. Pokušaj ponovo.' }, 500);
}
