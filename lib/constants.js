// Everything the app names: roles, what each role may open, statuses, sources, payment types.
// Shared by the server and the browser, so no server-only imports here.

export const ROLES = {
  admin: { label: 'Administrator', short: 'Admin' },
  veleprodaja: { label: 'Veleprodaja', short: 'Veleprodaja' },
  maloprodaja: { label: 'Maloprodaja', short: 'Maloprodaja' },
};
export const ROLE_KEYS = Object.keys(ROLES);

// Which parts of the app each role can open. Change here to widen or narrow access.
export const ACCESS = {
  pregled: ['admin', 'veleprodaja', 'maloprodaja'],
  zadaci: ['admin', 'veleprodaja', 'maloprodaja'],
  prijem: ['admin', 'veleprodaja'],
  // Prijenosnice: goods moving between warehouses (VP skladište → maloprodaja and back).
  prijenosnice: ['admin', 'veleprodaja', 'maloprodaja'],
  // Upiti MP: maloprodaja asks veleprodaja about price, availability and delivery time.
  upiti: ['admin', 'veleprodaja', 'maloprodaja'],
  rezervacije: ['admin', 'veleprodaja', 'maloprodaja'],
  zalihe: ['admin', 'veleprodaja'],
  postavke: ['admin', 'veleprodaja', 'maloprodaja'],
  korisnici: ['admin'],
  // Reading and changing orders in the web shops (WooCommerce API).
  webshop: ['admin', 'veleprodaja'],
};
export const can = (role, area) => !!role && (ACCESS[area] || []).includes(role);

// Departments a task belongs to (who gets notified about it).
export const DEPTS = {
  veleprodaja: 'Veleprodaja',
  maloprodaja: 'Maloprodaja',
};

export const TASK_TYPES = {
  narudzba: { label: 'Narudžba', prefix: 'N' },
  zadatak: { label: 'Zadatak', prefix: 'Z' },
};

// The order of the steps in the status stepper. Not every task goes through every step.
export const TASK_STATUS = {
  nova: { label: 'Novo', icon: 'new', tone: 'info' },
  u_obradi: { label: 'U obradi', icon: 'clock', tone: 'band' },
  ceka_robu: { label: 'Čeka robu', icon: 'truck', tone: 'wait' },
  ceka_kalkulaciju: { label: 'Čeka ulaznu kalkulaciju', short: 'Čeka kalkulaciju', icon: 'calculator', tone: 'accent' },
  za_fakturu: { label: 'Za fakturisanje', icon: 'receipt', tone: 'band' },
  zavrseno: { label: 'Završeno', icon: 'check', tone: 'ok' },
  otkazano: { label: 'Otkazano', icon: 'ban', tone: 'danger' },
};
export const TASK_FLOW = ['nova', 'u_obradi', 'ceka_robu', 'ceka_kalkulaciju', 'za_fakturu', 'zavrseno'];
export const OPEN_STATUSES = ['nova', 'u_obradi', 'ceka_robu', 'ceka_kalkulaciju', 'za_fakturu'];
export const isOpenTask = (t) => OPEN_STATUSES.includes(t.status);

export const SOURCES = {
  email: { label: 'Email', icon: 'mail' },
  telefon: { label: 'Telefon', icon: 'phone' },
  viber: { label: 'Viber', icon: 'chat' },
  whatsapp: { label: 'WhatsApp', icon: 'chat' },
  web: { label: 'Web shop', icon: 'globe' },
  licno: { label: 'Lično', icon: 'user' },
  interno: { label: 'Interno', icon: 'building' },
  ostalo: { label: 'Ostalo', icon: 'more' },
};

// A reservation made by maloprodaja goes to veleprodaja first, which sets the item aside and confirms it.
export const RES_STATUS = {
  ceka_vp: { label: 'Čeka potvrdu VP', short: 'Čeka VP', icon: 'hourglass', tone: 'wait' },
  aktivna: { label: 'Aktivna', icon: 'clock', tone: 'accent' },
  preuzeto: { label: 'Preuzeto', icon: 'check', tone: 'ok' },
  otkazana: { label: 'Otkazana', icon: 'ban', tone: 'danger' },
};

export const RES_PURPOSE = {
  prodaja: 'Prodaja kupcu',
  veleprodaja: 'Veleprodaja',
  interno: 'Interno',
  izlog: 'Izlog / demo',
  servis: 'Zamjena za servis',
  ostalo: 'Ostalo',
};

export const PAYMENT = {
  gotovina: 'Gotovina',
  kartica: 'Kartica',
  virman: 'Virman',
  rate: 'Kredit / rate',
  pouzece: 'Pouzeće',
  bez: 'Bez plaćanja',
  nije_dogovoreno: 'Nije dogovoreno',
};

export const INBOX_STATUS = {
  novo: 'Novo',
  prihvaceno: 'Prihvaćeno',
  rijeseno: 'Riješeno',
  odbaceno: 'Odbačeno',
};

// What an email or web order in Prijem is. Web shop orders are always 'narudzba'; emails are sorted automatically
// and can be moved by hand.
export const INBOX_KIND = {
  narudzba: { label: 'Narudžba', plural: 'Narudžbe', tone: 'accent', icon: 'cart' },
  upit: { label: 'Upit kupca', plural: 'Upiti kupaca', tone: 'info', icon: 'chat' },
  ostalo: { label: 'Ostalo', plural: 'Ostalo', tone: 'plain', icon: 'mail' },
};

// How the order list can be sorted.
export const TASK_SORTS = {
  datum: 'Najnovije prvo',
  datum_asc: 'Najstarije prvo',
  dolazak: 'Po dolasku robe',
  rok: 'Po roku',
  status: 'Po statusu',
};

/* ---- Prijenosnice ---- */
// Warehouses goods move between. kind 'vp' is handled by the veleprodaja role, 'mp' by maloprodaja.
// The admin renames or adds them in Postavke → Skladišta.
export const WAREHOUSE_KIND = { vp: 'Veleprodaja', mp: 'Maloprodaja' };
export const DEFAULT_WAREHOUSES = [
  { id: 'vp', name: 'VP skladište', kind: 'vp' },
  { id: 'mp', name: 'Maloprodaja KupiLenovo', kind: 'mp' },
];
export const KIND_ROLE = { vp: 'veleprodaja', mp: 'maloprodaja' };

// Each line of a prijenosnica has its own status: the sending warehouse answers whether it has it and ships it,
// the receiving warehouse confirms it arrived.
export const LINE_STATUS = {
  novi: { label: 'Novi', icon: 'new', tone: 'info' },
  dostupno: { label: 'Dostupno', icon: 'ok', tone: 'ok' },
  parcijalno: { label: 'Parcijalno dostupan', short: 'Parcijalno', icon: 'hourglass', tone: 'wait' },
  nedostupno: { label: 'Nedostupno', icon: 'ban', tone: 'danger' },
  otpremljen: { label: 'Otpremljen', icon: 'truck', tone: 'accent' },
  primljen: { label: 'Primljen', icon: 'check', tone: 'ok' },
};
// The prijenosnica as a whole, worked out from its lines.
export const TRANSFER_STATUS = {
  nova: { label: 'Čeka odgovor', icon: 'hourglass', tone: 'wait' },
  za_otpremu: { label: 'Za otpremu', icon: 'package', tone: 'info' },
  na_putu: { label: 'Na putu', icon: 'truck', tone: 'accent' },
  primljena: { label: 'Primljena', icon: 'check', tone: 'ok' },
  nedostupna: { label: 'Nedostupno', icon: 'ban', tone: 'danger' },
  otkazana: { label: 'Otkazana', icon: 'ban', tone: 'plain' },
};
export const TRANSFER_DONE = ['primljena', 'nedostupna', 'otkazana'];

/* ---- Upiti MP ---- */
export const REQUEST_STATUS = {
  novi: { label: 'Čeka se odgovor', short: 'Čeka odgovor', icon: 'hourglass', tone: 'wait' },
  dostupno: { label: 'Dostupno', icon: 'ok', tone: 'ok' },
  nije_dostupno: { label: 'Nije dostupno', icon: 'ban', tone: 'danger' },
  zavrseno: { label: 'Završeno', icon: 'check', tone: 'info' },
};

// Notification categories people can turn on or off for themselves (Postavke → Obavijesti).
export const NOTIF_CATS = {
  web: { label: 'Web narudžbe (WordPress)', area: 'prijem' },
  email_order: { label: 'Narudžbe emailom', area: 'prijem' },
  email_msg: { label: 'Upiti kupaca (emailom)', area: 'prijem' },
  task_new: { label: 'Nove narudžbe i zadaci', area: 'zadaci' },
  task_update: { label: 'Promjene statusa, dodjele i dolazak robe', area: 'zadaci' },
  comment: { label: 'Komentari i spominjanja (@ime)' },
  res: { label: 'Rezervacije', area: 'rezervacije' },
  transfer: { label: 'Prijenosnice', area: 'prijenosnice' },
  request: { label: 'Upiti MP', area: 'upiti' },
  stock: { label: 'Zalihe (izvoz iz EKI EDI)', area: 'zalihe' },
  daily: { label: 'Jutarnji podsjetnik: roba koja stiže, rokovi, rezervacije' },
};
export const NOTIF_TYPE_CAT = {
  inbox_web: 'web',
  inbox_email_order: 'email_order',
  inbox_email_msg: 'email_msg',
  inbox_new: 'email_msg',
  task_new: 'task_new',
  task_status: 'task_update',
  task_assigned: 'task_update',
  task_arrival: 'task_update',
  comment: 'comment',
  res_new: 'res',
  res_status: 'res',
  tr_new: 'transfer',
  tr_update: 'transfer',
  rq_new: 'request',
  rq_update: 'request',
  stock: 'stock',
  daily: 'daily',
};

// Comments can hang off any of these.
export const COMMENT_KINDS = ['task', 'reservation', 'inbox', 'stock', 'transfer', 'request'];

export const LIMITS = {
  title: 200,
  text: 4000,
  comment: 4000,
  items: 100,
  comments: 500,
};

/* ---- worked out from the data, the same on the server and in the browser ---- */
/** The prijenosnica's overall status, from its lines. */
export function transferStatus(t) {
  if (t.cancelled) return 'otkazana';
  const ls = (t.items || []).map((i) => i.status);
  if (!ls.length || ls.includes('novi')) return 'nova';
  if (ls.includes('dostupno') || ls.includes('parcijalno')) return 'za_otpremu';
  if (ls.includes('otpremljen')) return 'na_putu';
  if (ls.includes('primljen')) return 'primljena';
  return 'nedostupna';
}

/** What each side still has to do: the sending warehouse answers and ships, the receiving one confirms arrival. */
export function transferTodo(t) {
  if (t.cancelled) return { from: null, to: null };
  const ls = (t.items || []).map((i) => i.status);
  return {
    from: ls.includes('novi') ? 'odgovori' : ls.includes('dostupno') || ls.includes('parcijalno') ? 'otpremi' : null,
    to: ls.includes('otpremljen') ? 'primi' : null,
  };
}

/** Which side(s) of a prijenosnica this person works on (admin: both). */
export function transferSides(t, user) {
  const r = user?.role;
  return {
    from: r === 'admin' || KIND_ROLE[t.from?.kind] === r,
    to: r === 'admin' || KIND_ROLE[t.to?.kind] === r,
  };
}

/** Free stock against the quantity wanted, like the sheet's "Na stanju / Djelimično / Nema na stanju". */
export function stockLabel(free, qty = 1) {
  if (free == null) return { label: 'Nepoznato', tone: 'plain' };
  if (free >= (Number(qty) || 1)) return { label: 'Na stanju', tone: 'ok' };
  if (free > 0) return { label: 'Djelimično', tone: 'wait' };
  return { label: 'Nema na stanju', tone: 'danger' };
}
