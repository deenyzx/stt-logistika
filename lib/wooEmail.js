// Reads the "Nova narudžba" email that a WooCommerce shop (KupiTelevizor, KupiLenovo, …) sends to the company
// mailbox and turns it into a full order: items with codes, totals, payment, delivery, both addresses, phone, email
// and any note. Works on the plain text of the email, or on its HTML turned into text (cells separated by tabs).
// Pure functions, tested in tests/shop-email.test.mjs.

const fold = (s) => String(s || '').toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /^(?:\+|00)?[\d\s/().-]{6,}$/;
const MONEY_RE = /(-?\d[\d.,]*)\s*(KM|BAM|€|EUR|RSD|HRK)\b/i;

// "1.262 KM" → 1262, "186,86 KM" → 186.86, "1,262.50" → 1262.5
export function parseAmount(s) {
  const m = String(s || '').match(/-?\d[\d.,]*/);
  if (!m) return null;
  let t = m[0];
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const lastMoney = (line) => {
  const all = [...String(line).matchAll(new RegExp(MONEY_RE.source, 'gi'))];
  return all.length ? { amount: parseAmount(all[all.length - 1][1]), currency: all[all.length - 1][2].toUpperCase() } : null;
};

const isHeader = (l, words) => words.some((w) => fold(l).replace(/:$/, '').trim() === w);
const BILLING = ['adresa za naplatu', 'billing address', 'adresa za racun'];
const SHIPPING = ['adresa za dostavu', 'shipping address', 'adresa dostave'];
const FOOTER = /(process your orders|get the app|preuzmite aplikaciju|powered by|congratulations on the sale|cestitamo na prodaji)/i;
const isFooter = (l) => FOOTER.test(fold(l)) || (String(l).split(' · ').length >= 3);

/** Is this the shop's new-order email? Returns the order number, or null. */
export function wooOrderNumber(subject, text) {
  const t = String(text || '');
  const m = t.match(/(?:narud[zž]ba|porud[zž]bina|order)\s*(?:br\.?\s*)?#\s?(\d{2,9})/i) || String(subject || '').match(/#\s?(\d{2,9})/);
  if (!m) return null;
  const f = fold(t);
  const looksLikeOrder = ['sazetak narudzbe', 'order summary', 'adresa za naplatu', 'billing address', 'nacin placanja', 'payment method', 'medjuzbir', 'subtotal']
    .filter((w) => f.includes(w)).length >= 2;
  return looksLikeOrder ? m[1] : null;
}

function addressBlock(lines, start) {
  const out = [];
  for (let i = start; i < lines.length && out.length < 9; i += 1) {
    const l = lines[i].trim();
    if (!l) { if (out.length >= 2) break; continue; }
    if (isHeader(l, BILLING) || isHeader(l, SHIPPING) || isFooter(l)) break;
    out.push(l);
  }
  const email = out.find((l) => EMAIL_RE.test(l))?.match(EMAIL_RE)[0] || '';
  const phone = out.find((l) => !EMAIL_RE.test(l) && PHONE_RE.test(l) && l.replace(/\D/g, '').length >= 6 && !/^\d{5}$/.test(l)) || '';
  const rest = out.filter((l) => l !== phone && !EMAIL_RE.test(l));
  const name = rest[0] || '';
  const body = rest.slice(1);
  const pcIdx = body.findIndex((l) => /^\d{5}$/.test(l));
  let city = '';
  let postcode = '';
  if (pcIdx >= 0) {
    postcode = body[pcIdx];
    city = body[pcIdx - 1] && pcIdx - 1 >= 1 ? body[pcIdx - 1] : body[pcIdx + 1] || '';
  } else {
    const m = body.map((l) => l.match(/^(\d{5})\s+(.+)$/)).find(Boolean);
    if (m) { postcode = m[1]; city = m[2]; }
  }
  const street = body.filter((l) => l !== postcode && l !== city && !/^\d{5}\s+/.test(l));
  const address = [...street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { name, address, city, postcode, phone: phone.trim(), email, lines: out.length, end: start + out.length };
}

/** Parses the new-order email. Returns null if it isn't one. */
export function parseWooEmail({ subject = '', text = '', fromName = '' } = {}) {
  const number = wooOrderNumber(subject, text);
  if (!number) return null;
  const lines = String(text).replace(/\r/g, '').split('\n').map((l) => l.replace(/ /g, ' ').replace(/[ ]+$/g, ''));
  const trimmed = lines.map((l) => l.trim());

  // Shop name: "[KupiTelevizor] Nova narudžba (#5202)", or the first line of the email, or the sender's name.
  const firstLine = trimmed.find((l) => l) || '';
  const shopName = (String(subject).match(/^\s*\[([^\]]{2,60})\]/) || [])[1]
    || (firstLine.length <= 40 && !/narud|order|#/i.test(firstLine) ? firstLine : '')
    || fromName || '';

  const dateM = String(text).match(/#\s?\d{2,9}\s*\(\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*\)/);
  const date = dateM ? `${dateM[3]}-${dateM[2].padStart(2, '0')}-${dateM[1].padStart(2, '0')}` : null;
  const customerM = String(text).match(/(?:new order from|narud[zž]bu od|narud[zž]ba od|porud[zž]binu od)\s+([^:\n]{2,80}?)\s*:?\s*$/im);

  // Items: between the "Proizvod / Količina / Cijena" header and "Međuzbir" / "Subtotal".
  const head = trimmed.findIndex((l) => /(proizvod|product)/i.test(l) && /(koli[cč]ina|quantity)/i.test(l));
  const subIdx = trimmed.findIndex((l, i) => i > head && /^(me[dđ]uzbir|subtotal|ukupno|total)\s*:/i.test(l));
  const items = [];
  if (head >= 0) {
    const end = subIdx > head ? subIdx : trimmed.length;
    let block = [];
    for (let i = head + 1; i < end; i += 1) {
      const raw = lines[i];
      const l = trimmed[i];
      if (!l) continue;
      // Everything on one row: "Name (#SKU)\t1\t1.262 KM"
      const row = raw.split('\t').map((c) => c.trim()).filter(Boolean);
      if (row.length >= 3 && /^[×x]?\s*\d+$/.test(row[row.length - 2]) && MONEY_RE.test(row[row.length - 1])) {
        const nameCell = row.slice(0, row.length - 2).join(' ');
        const sku = (nameCell.match(/\(#([^)]+)\)/) || [])[1] || '';
        items.push({ code: sku, name: nameCell.replace(/\s*\(#[^)]+\)\s*/, '').trim(), qty: Number(row[row.length - 2].replace(/\D/g, '')) || 1, price: lastMoney(row[row.length - 1])?.amount ?? null });
        block = [];
        continue;
      }
      const qtyM = l.match(/^[×x]\s*(\d+)\b/) || l.match(/\s[×x]\s*(\d+)\b/);
      if (qtyM) {
        const skuLine = [...block].reverse().find((b) => /^\(#[^)]+\)$/.test(b));
        const sku = skuLine ? skuLine.slice(2, -1) : (block.join(' ').match(/\(#([^)]+)\)/) || [])[1] || '';
        const names = block.filter((b) => !/^\(#[^)]+\)$/.test(b));
        // The name right above the "(#SKU)" line; the line before it is often the picture's caption.
        let name = skuLine ? names[names.length - 1] : names[names.length - 1] || names[0] || '';
        name = String(name || '').replace(/\s*[—-]\s*slika\s*\d+\s*$/i, '').replace(/\s*\(#[^)]+\)\s*/, '').trim();
        const qtyPrice = lastMoney(l);
        items.push({ code: sku, name, qty: Number(qtyM[1]) || 1, price: qtyPrice ? qtyPrice.amount / (Number(qtyM[1]) || 1) : null, lineTotal: qtyPrice?.amount ?? null });
        block = [];
        continue;
      }
      block.push(l);
    }
  }

  // Totals and payment.
  let subtotal = null; let total = null; let tax = null; let shippingTotal = null; let shippingMethod = ''; let payment = ''; let customerNote = ''; let currency = 'KM';
  for (const l of trimmed) {
    let m;
    if ((m = l.match(/^(me[dđ]uzbir|subtotal)\s*:\s*(.*)$/i))) subtotal = lastMoney(m[2])?.amount ?? subtotal;
    else if ((m = l.match(/^(ukupno|total)\s*:\s*(.*)$/i))) { const mm = lastMoney(m[2]); if (mm) { total = mm.amount; currency = mm.currency === 'BAM' ? 'KM' : mm.currency; } }
    else if ((m = l.match(/^(dostava|shipping|isporuka)\s*:\s*(.*)$/i))) {
      const mm = lastMoney(m[2]);
      shippingTotal = mm ? mm.amount : /besplatn|free/i.test(m[2]) ? 0 : shippingTotal;
      shippingMethod = m[2].replace(new RegExp(MONEY_RE.source, 'gi'), '').replace(/\b(via|putem)\b/i, '').replace(/\s{2,}/g, ' ').trim();
    } else if ((m = l.match(/^(na[cč]in pla[cć]anja|payment method|pla[cć]anje)\s*:\s*(.*)$/i))) payment = m[2].trim();
    else if ((m = l.match(/^(napomena|note|napomena kupca|customer note)\s*:\s*(.*)$/i))) customerNote = m[2].trim();
    if ((m = l.match(/\((?:uklju[cč]uje|includes)\s+([\d.,]+)\s*(?:KM|BAM|€|EUR)?\s*(?:PDV|VAT|tax|porez)/i))) tax = parseAmount(m[1]);
  }

  // Addresses.
  const bIdx = trimmed.findIndex((l) => isHeader(l, BILLING));
  const sIdx = trimmed.findIndex((l) => isHeader(l, SHIPPING));
  const billing = bIdx >= 0 ? addressBlock(trimmed, bIdx + 1) : null;
  const shipping = sIdx >= 0 ? addressBlock(trimmed, sIdx + 1) : null;

  // Anything written after the addresses and before the footer: a note from the shop or a plugin
  // ("Narudžba je pouzećem — nazvati kupca radi potvrde…").
  const after = Math.max(billing?.end ?? -1, shipping?.end ?? -1);
  const extra = [];
  if (after > 0) {
    for (let i = after; i < trimmed.length; i += 1) {
      const l = trimmed[i];
      if (!l) continue;
      if (isFooter(l)) break;
      if (isHeader(l, BILLING) || isHeader(l, SHIPPING)) continue;
      extra.push(l);
      if (extra.length >= 4) break;
    }
  }

  const who = billing || shipping || { name: '', address: '', city: '', phone: '', email: '' };
  const ship = shipping && shipping.address ? shipping : who;
  return {
    shopName: shopName.trim(),
    number,
    date,
    customer: {
      name: (customerM ? customerM[1].trim() : '') || who.name,
      phone: who.phone || shipping?.phone || '',
      email: who.email || shipping?.email || '',
      address: ship.address,
      city: ship.city,
    },
    billingAddress: billing?.address || '',
    items,
    subtotal,
    shippingMethod,
    shippingTotal,
    total,
    tax,
    currency,
    payment,
    customerNote,
    note: extra.join(' '),
  };
}
