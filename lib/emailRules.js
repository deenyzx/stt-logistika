// The admin's own rules for incoming email, checked before anything else:
//   "sender contains @dobavljac.ba → ignore", "to contains prodaja@ → customer's email", …
// Pure functions, tested in tests/email-sorting.test.mjs.
import { str, oneOf } from './errors.js';

export const RULE_FIELDS = { from: 'Pošiljalac', to: 'Primalac', subject: 'Naslov', text: 'Tekst', any: 'Bilo gdje' };
export const RULE_ACTIONS = { narudzba: 'Narudžba', upit: 'Upit kupca', ostalo: 'Ostalo', ignore: 'Ignoriši' };

const fold = (s) => String(s || '').toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function cleanRules(rules) {
  return (Array.isArray(rules) ? rules : []).slice(0, 100).map((r, i) => ({
    id: str(r?.id, 40) || 'r' + Date.now().toString(36) + i,
    field: oneOf(r?.field, RULE_FIELDS, 'from'),
    contains: str(r?.contains, 120),
    action: oneOf(r?.action, RULE_ACTIONS, 'ignore'),
  })).filter((r) => r.contains);
}

/** The first rule that matches the email, or null. "contains" may list alternatives separated by commas. */
export function matchRule(rules, email) {
  const fields = {
    from: `${email.from?.name || ''} <${email.from?.email || ''}>`,
    to: email.to || '',
    subject: email.title || email.subject || '',
    text: email.body || email.text || '',
  };
  fields.any = Object.values(fields).join('\n');
  for (const r of rules || []) {
    const hay = fold(fields[r.field] ?? '');
    const needles = String(r.contains).split(',').map((x) => fold(x).trim()).filter(Boolean);
    if (needles.some((n) => hay.includes(n))) return r;
  }
  return null;
}
