// Bosnian formats: dates "29. 9. 2026.", money "1.149,00 KM", times in Sarajevo time.
export const TZ = 'Europe/Sarajevo';

const parts = (d) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, hh: o.hour, mm: o.minute };
};

// "2026-10-02" (a plain date, no time zone) or a timestamp → "2. 10. 2026."
export function fmtDate(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return `${d}. ${m}. ${y}.`;
  }
  const p = parts(new Date(v));
  return `${p.d}. ${p.m}. ${p.y}.`;
}

export function fmtTime(v) {
  const p = parts(new Date(v));
  return `${+p.hh}:${p.mm}`;
}

// Today's date in Sarajevo as "YYYY-MM-DD".
export function todayISO(now = Date.now()) {
  const p = parts(new Date(now));
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

// Whole days from today to a "YYYY-MM-DD" date (negative = in the past).
export function daysFromToday(iso, now = Date.now()) {
  if (!iso) return null;
  const a = Date.parse(todayISO(now) + 'T00:00:00Z');
  const b = Date.parse(iso + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// "prije 5 min", "danas 9:12", "juče 14:20", "26. 9. 2026."
export function fmtWhen(ts, now = Date.now()) {
  if (!ts) return '';
  const diff = now - ts;
  if (diff < 60000) return 'upravo';
  if (diff < 3600000) return `prije ${Math.floor(diff / 60000)} min`;
  const day = daysFromToday(todayISO(ts), now);
  if (day === 0) return `danas ${fmtTime(ts)}`;
  if (day === -1) return `juče ${fmtTime(ts)}`;
  return fmtDate(ts);
}

export function fmtDue(iso, now = Date.now()) {
  if (!iso) return '';
  const n = daysFromToday(iso, now);
  if (n === 0) return 'danas';
  if (n === 1) return 'sutra';
  if (n === -1) return 'juče';
  return fmtDate(iso);
}

// 1149 → "1.149,00 KM"
export function fmtMoney(v, cur = 'KM') {
  if (v === '' || v == null || Number.isNaN(Number(v))) return '';
  const n = Number(v);
  const s = n.toFixed(2);
  const [i, dec] = s.split('.');
  const neg = i.startsWith('-');
  const digits = neg ? i.slice(1) : i;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}${grouped},${dec} ${cur}`.trim();
}

// "1.149,50" / "1149.5" / "1 149,50 KM" → 1149.5
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  if (!s) return null;
  let t = String(s).replace(/[^\d,.-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function fmtQty(n) {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
}

export function fmtDelta(n) {
  const v = Number(n) || 0;
  const s = fmtQty(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : '0';
}

// "Din Hodžić" → "DH", "Amra" → "A"
export function initials(name) {
  const w = String(name || '?').trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return '?';
  if (w.length === 1) return w[0].charAt(0).toUpperCase();
  return (w[0].charAt(0) + w[w.length - 1].charAt(0)).toUpperCase();
}

// Lower case without diacritics, for search and matching column names.
export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/đ/g, 'dj')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// The day an order was placed: set by hand, taken from the web shop/email, or the day it was entered.
export const taskDate = (t) => t.orderedAt || todayISO(t.createdAt);

const WEEKDAYS = ['nedjelja', 'ponedjeljak', 'utorak', 'srijeda', 'četvrtak', 'petak', 'subota'];
// "Danas", "Juče", "Sutra", "Ponedjeljak, 28. 9. 2026."
export function dayLabel(iso, now = Date.now()) {
  if (!iso) return 'Bez datuma';
  const n = daysFromToday(iso, now);
  if (n === 0) return 'Danas';
  if (n === -1) return 'Juče';
  if (n === 1) return 'Sutra';
  const wd = WEEKDAYS[new Date(iso + 'T12:00:00Z').getUTCDay()];
  return wd.charAt(0).toUpperCase() + wd.slice(1) + ', ' + fmtDate(iso);
}

// The part of an email worth reading: without quoted replies and signatures' long tails, whitespace squeezed.
export function snippet(text, max = 300) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const l of lines) {
    if (/^\s*>/.test(l) || /^(On .+ wrote:|Dana .+ napisa|-{2,}\s*Original|From:\s|Od:\s.+@|Sent from my)/i.test(l.trim())) break;
    out.push(l.trim());
  }
  const t = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

// A short preview of a message for notifications and lists: no "Poštovani," / "Pozdrav Din," line, no blank lines.
const GREETING = /^(po[sš]tovan|pozdrav|zdravo|dobar dan|dobro jutro|dobro ve[cč]e|hej|hello|hi\b|dear|[cć]ao|drag[ai])/i;
export function preview(text, max = 300) {
  const lines = snippet(text, 5000).split('\n').map((l) => l.trim()).filter(Boolean);
  while (lines.length > 1 && lines[0].length <= 40 && GREETING.test(lines[0])) lines.shift();
  const t = lines.join('\n');
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}
