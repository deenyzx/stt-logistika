// Pull the last few days of orders from every shop with API keys (new ones into Prijem, statuses refreshed).
import { route, json } from '@/lib/http.js';
import { syncShops } from '@/lib/domain.js';

export const POST = route('webshop', async () => json({ result: await syncShops({ days: 3 }) }));
