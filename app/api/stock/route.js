// A CSV uploaded by hand in Zalihe: { filename, text }.
import { route, json, body } from '@/lib/http.js';
import { ingestStock } from '@/lib/domain.js';

export const POST = route('zalihe', async (req, { user }) => {
  const b = await body(req);
  return json(await ingestStock(b.text, { filename: b.filename, source: 'rucno', user }));
});
