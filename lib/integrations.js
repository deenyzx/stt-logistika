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
  const addr = [s.address_1 || b.address_1, s.postcode || b.postcode, s.city || b.city].filter(Boolean).join(', ');
  const shipMethod = (o.shipping_lines || []).map((l) => l.method_title).filter(Boolean).join(', ');
  const currency = CUR[o.currency] || o.currency || '';
  const base = String(sourceUrl || '').replace(/\/+$/, '');
  const order = {
    id: o.id,
    number: String(o.number || o.id),
    status: o.status || '',
    total: money(o.total),
    currency,
    payment: o.payment_method_title || o.payment_method || '',
    shipping: [shipMethod, addr].filter(Boolean).join(' · '),
    customerNote: o.customer_note || '',
    items,
    url: base && o.id ? `${base}/wp-admin/post.php?post=${o.id}&action=edit` : '',
  };
  const title = items.length ? items.map((i) => `${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}`).join(', ') : 'Narudžba #' + order.number;
  const body = [
    `Narudžba #${order.number} (${order.status})`,
    ...items.map((i) => `• ${i.name}${i.code ? ' [' + i.code + ']' : ''} × ${i.qty}`),
    order.total != null ? `Ukupno: ${order.total} ${currency}` : '',
    order.payment ? `Plaćanje: ${order.payment}` : '',
    order.shipping ? `Dostava: ${order.shipping}` : '',
    b.company ? `Firma: ${b.company}` : '',
    order.customerNote ? `Napomena: ${order.customerNote}` : '',
  ].filter(Boolean).join('\n');
  return {
    source: 'web',
    extId: String(o.id),
    title: title.slice(0, 240),
    from: { name: name || b.company || '', email: b.email || '', phone: b.phone || s.phone || '' },
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
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Accepts Postmark, Mailgun, SendGrid, Cloudflare Email Workers or plain { from, subject, text } and returns an inbox item. */
export function emailToInbox(p) {
  const get = (...keys) => { for (const k of keys) if (p[k] != null && p[k] !== '') return p[k]; return ''; };
  const from = parseAddress(get('FromFull') || get('from', 'From', 'sender'));
  if (!from.name && p.FromName) from.name = String(p.FromName);
  const subject = String(get('subject', 'Subject') || '(bez naslova)');
  let text = String(get('text', 'TextBody', 'body-plain', 'stripped-text', 'plain') || '');
  if (!text) text = htmlToText(get('html', 'HtmlBody', 'body-html'));
  const messageId = String(get('messageId', 'MessageID', 'Message-Id', 'message-id', 'message_id') || '');
  const date = Date.parse(String(get('date', 'Date') || '')) || Date.now();
  return {
    source: 'email',
    extId: messageId || `${from.email}|${subject}|${date}`,
    title: subject.slice(0, 240),
    from: { ...from, phone: '' },
    body: text.slice(0, 20000),
    receivedAt: date,
  };
}
