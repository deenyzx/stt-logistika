// Turning what outside systems send into inbox items: WooCommerce webhooks and forwarded emails.
// Pure where possible (tested in tests/integrations.test.mjs).

const enc = new TextEncoder();

function eq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i += 1) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function safeEqual(a, b) { return eq(String(a ?? ''), String(b ?? '')); }

/* ---------- WooCommerce ---------- */
// WooCommerce signs each webhook: base64(HMAC-SHA256(raw body, the webhook's secret)) in X-WC-Webhook-Signature.
export async function wooSignature(raw, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(raw))).toString('base64');
}

export async function verifyWoo(raw, signature, secret) {
  if (!secret || !signature) return false;
  return eq(await wooSignature(raw, secret), signature);
}

const CUR = { BAM: 'KM', EUR: '€' };
const money = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

// WooCommerce order statuses in Bosnian.
export const WOO_STATUS = {
  pending: 'čeka uplatu',
  processing: 'u obradi',
  'on-hold': 'na čekanju',
  completed: 'završena',
  cancelled: 'otkazana',
  refunded: 'refundirana',
  failed: 'neuspjela',
  'checkout-draft': 'nedovršena',
};

export function wooOrderToInbox(o, sourceUrl = '') {
  const b = o.billing || {};
  const s = o.shipping || {};
  const name = [b.first_name, b.last_name].filter(Boolean).join(' ') || [s.first_name, s.last_name].filter(Boolean).join(' ');
  const items = (o.line_items || []).map((i) => ({
    code: String(i.sku || ''),
    name: String(i.name || ''),
    qty: Number(i.quantity) || 1,
    price: money(i.price ?? (Number(i.total) / (Number(i.quantity) || 1))),
  }));
  const ship = s.address_1 ? s : b; // shipping address if given, else billing
  const city = ship.city || b.city || '';
  const address = [ship.address_1, ship.address_2, [ship.postcode, ship.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const shipMethod = (o.shipping_lines || []).map((l) => l.method_title).filter(Boolean).join(', ');
  const currency = CUR[o.currency] || o.currency || '';
  const base = String(sourceUrl || '').replace(/\/+$/, '');
  const order = {
    id: o.id,
    number: String(o.number || o.id),
    status: o.status || '',
    statusLabel: WOO_STATUS[o.status] || o.status || '',
    total: money(o.total),
    shippingTotal: money(o.shipping_total),
    currency,
    payment: o.payment_method_title || o.payment_method || '',
    shippingMethod: shipMethod,
    shipping: [shipMethod, address].filter(Boolean).join(' · '),
    address,
    city,
    company: b.company || s.company || '',
    customerNote: o.customer_note || '',
    items,
    url: base && o.id ? `${base}/wp-admin/post.php?post=${o.id}&action=edit` : '',
  };
  const title = items.length ? items.map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ') : 'Narudžba #' + order.number;
  const body = [
    `Narudžba #${order.number} (${order.statusLabel})`,
    ...items.map((i) => `• ${i.name}${i.code ? ' [' + i.code + ']' : ''} × ${i.qty}`),
    order.total != null ? `Ukupno: ${order.total} ${currency}` : '',
    order.payment ? `Plaćanje: ${order.payment}` : '',
    order.shipping ? `Dostava: ${order.shipping}` : '',
    order.company ? `Firma: ${order.company}` : '',
    order.customerNote ? `Napomena: ${order.customerNote}` : '',
  ].filter(Boolean).join('\n');
  return {
    source: 'web',
    kind: 'narudzba',
    extId: String(o.id),
    title: title.slice(0, 240),
    from: { name: name || order.company || '', email: b.email || '', phone: b.phone || s.phone || '', address },
    body,
    order,
    receivedAt: Date.parse(o.date_created_gmt ? o.date_created_gmt + 'Z' : o.date_created || '') || Date.now(),
  };
}

/* ---------- email ---------- */
// "Amra Hodžić <amra@firma.ba>" → { name, email }
export function parseAddress(v) {
  if (!v) return { name: '', email: '' };
  if (typeof v === 'object') return { name: String(v.Name || v.name || ''), email: String(v.Email || v.email || v.address || '') };
  const s = String(v).trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  return { name: '', email: s };
}

export function htmlToText(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t') // table cells (the shop's order table) stay on one line, tab-separated
    .replace(/<\/(p|div|tr|li|h\d|table|address)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&scaron;/g, 'š')
    .replace(/&Scaron;/g, 'Š')
    .replace(/&times;/g, '×')
    .replace(/&#8212;|&mdash;/g, '—')
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8220;|&#8221;|&#8222;/g, '"')
    .replace(/&#8217;|&rsquo;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const foldText = (s) => String(s || '').toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Words that make an email an order: naručujem, narudžba, porudžbina, order, predračun…
const ORDER_RE = /(narudzb|porudzb|narucuj|narucil|narucio|naruciti|narucit|\border\b|\bnaruci\b|predracun|profaktur)/;
const ROBOT_RE = /(no-?reply|do-?not-?reply|newsletter|mailer-daemon|postmaster|notifications?@|marketing@|promo|bounce)/;

// Bosnian phone numbers: +387 61 234 567, 061/234-567, 033 123 456 …
const PHONE_RE = /(?:\+|00)387[\s/.-]?\(?0?\)?\d{2}[\s/.-]?\d{3}[\s/.-]?\d{3,4}|\b0\d{2}[\s/.-]?\d{3}[\s/.-]?\d{3,4}\b/;
export function findPhone(text) {
  const m = String(text || '').match(PHONE_RE);
  return m ? m[0].trim() : '';
}

// "[Shop] Nova narudžba (#2294)" → "2294"
export function orderRef(subject) {
  const s = String(subject || '');
  const m = s.match(/#\s?(\d{2,8})\b/) || foldText(s).match(/(?:narudzb\w*|porudzb\w*|order)\s*(?:br\.?|broj|no\.?|nr\.?)?\s*(\d{3,8})\b/);
  return m ? m[1] : '';
}

/**
 * Sorts an email: 'narudzba' (an order: a customer ordering, or the shop's own new-order email),
 * 'upit' (a person writing to us: questions, quote requests, follow-ups), 'ostalo' (newsletters, robots).
 */
export function classifyEmail({ subject = '', text = '', fromEmail = '', bulk = false }) {
  const subj = foldText(subject).trim();
  const start = foldText(String(text).slice(0, 1500));
  const reply = /^(re|odg|odgovor|aw|sv)\s*:/.test(subj); // a customer writing back about something
  const robot = ROBOT_RE.test(foldText(fromEmail)) || bulk;
  if (ORDER_RE.test(subj) && !reply) return 'narudzba'; // includes the shop's own "Nova narudžba #2294" emails
  if (robot) return 'ostalo';
  if (ORDER_RE.test(start) && !reply) return 'narudzba';
  return 'upit';
}

function headerList(p) {
  if (Array.isArray(p.Headers)) return p.Headers.map((h) => [String(h.Name || '').toLowerCase(), String(h.Value || '')]); // Postmark
  if (typeof p['message-headers'] === 'string') { try { return JSON.parse(p['message-headers']).map(([k, v]) => [String(k).toLowerCase(), String(v)]); } catch { return []; } } // Mailgun
  if (typeof p.headers === 'string') return p.headers.split(/\r?\n/).map((l) => { const i = l.indexOf(':'); return [l.slice(0, i).toLowerCase().trim(), l.slice(i + 1).trim()]; }); // SendGrid
  if (p.headers && typeof p.headers === 'object') return Object.entries(p.headers).map(([k, v]) => [k.toLowerCase(), String(v)]);
  return [];
}

/** Accepts Postmark, Mailgun, SendGrid, Cloudflare Email Workers, the office agent or plain { from, subject, text }. */
export function emailToInbox(p) {
  const get = (...keys) => { for (const k of keys) if (p[k] != null && p[k] !== '') return p[k]; return ''; };
  const from = parseAddress(get('FromFull') || get('from', 'From', 'sender'));
  if (!from.name && p.FromName) from.name = String(p.FromName);
  const subject = String(get('subject', 'Subject') || '(bez naslova)');
  const html = get('html', 'HtmlBody', 'body-html');
  let text = String(get('text', 'TextBody', 'body-plain', 'stripped-text', 'plain') || '');
  if (!text) text = htmlToText(html);
  const toRaw = Array.isArray(p.ToFull) ? p.ToFull.map((x) => x.Email || x.email).join(', ') : get('to', 'To', 'recipient', 'OriginalRecipient');
  const messageId = String(get('messageId', 'MessageID', 'Message-Id', 'message-id', 'message_id') || '');
  const date = Date.parse(String(get('date', 'Date') || '')) || Date.now();
  const headers = headerList(p);
  const bulk = !!p.bulk || headers.some(([k, v]) => k === 'list-unsubscribe' || (k === 'precedence' && /bulk|list|junk/i.test(v)) || (k === 'auto-submitted' && !/^no$/i.test(v)));
  return {
    source: 'email',
    kind: classifyEmail({ subject, text, fromEmail: from.email, bulk }),
    orderRef: orderRef(subject),
    extId: messageId || `${from.email}|${subject}|${date}`,
    title: subject.slice(0, 240),
    from: { ...from, phone: findPhone(text) },
    to: String(toRaw || '').slice(0, 300),
    body: text.slice(0, 20000),
    // The HTML turned into text, kept only while the email is being read (shop order emails parse best from it).
    htmlText: html ? htmlToText(html).slice(0, 40000) : '',
    receivedAt: date,
  };
}
