// Errors with an HTTP status, and input cleaning. No framework imports, so the rules can be tested in plain Node.
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

// Trimmed string, capped, or '' for anything that isn't text.
export function str(v, max = 200) {
  if (v == null) return '';
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  return String(v).replace(/\u0000/g, '').trim().slice(0, max);
}

export function isoDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function num(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const oneOf = (v, obj, fallback) => (Object.prototype.hasOwnProperty.call(obj, v) ? v : fallback);
