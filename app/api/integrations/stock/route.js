// The office agent (agent/eki_sync.py) posts the newest EKI EDI CSV here:
//   Authorization: Bearer <STOCK_AGENT_TOKEN>, X-Filename: fakture_2026-09-29.csv, body = the CSV (UTF-8).
// The same file twice is ignored, so the agent can check every minute at no cost.
import { json, errorResponse } from '@/lib/http.js';
import { safeEqual } from '@/lib/integrations.js';
import { ingestStock } from '@/lib/domain.js';

export async function POST(req) {
  const token = process.env.STOCK_AGENT_TOKEN || '';
  if (token.length < 16 || !safeEqual(req.headers.get('authorization') || '', 'Bearer ' + token)) return json({ error: 'unauthorized' }, 401);
  try {
    const filename = decodeURIComponent(req.headers.get('x-filename') || 'izvoz.csv');
    const r = await ingestStock(await req.text(), { filename, source: 'agent', user: { id: 'agent', name: 'Agent (EKI EDI)', role: null } });
    return json({ ok: true, unchanged: !!r.unchanged, baseline: !!r.diff?.baseline, changes: r.diff?.changes?.length ?? 0 });
  } catch (e) {
    return errorResponse(e);
  }
}
