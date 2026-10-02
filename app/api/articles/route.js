// Article lookup from the latest EKI EDI export: ?code=1894 (exact), ?q=legion (search), ?all=1&q= (the Artikli list).
import { route, json } from '@/lib/http.js';
import { can } from '@/lib/constants.js';
import { findArticles, listArticles } from '@/lib/articles.js';

export const dynamic = 'force-dynamic';

export const GET = route(null, async (req, { user }) => {
  const q = req.nextUrl.searchParams;
  if (!['prijenosnice', 'upiti', 'rezervacije', 'zalihe'].some((a) => can(user.role, a))) return json({ items: [] }, 403);
  if (q.get('all')) return json(await listArticles({ q: q.get('q') || '' }));
  return json(await findArticles({ code: q.get('code') || '', q: q.get('q') || '' }));
});
