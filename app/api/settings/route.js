// Admin settings: { stockMapping: { key, qty, name }, autoAcceptWeb, webDept }.
import { route, json, body } from '@/lib/http.js';
import { saveSettings } from '@/lib/domain.js';

export const PATCH = route('korisnici', async (req) => json({ settings: await saveSettings(await body(req)) }));
