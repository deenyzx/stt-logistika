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
  rezervacije: ['admin', 'veleprodaja', 'maloprodaja'],
  zalihe: ['admin', 'veleprodaja'],
  postavke: ['admin', 'veleprodaja', 'maloprodaja'],
  korisnici: ['admin'],
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

export const RES_STATUS = {
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
  upit: { label: 'Email kupca', plural: 'Emailovi kupaca', tone: 'info', icon: 'chat' },
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

// Notification categories people can turn on or off for themselves (Postavke → Obavijesti).
export const NOTIF_CATS = {
  web: { label: 'Web narudžbe (WordPress)', area: 'prijem' },
  email_order: { label: 'Narudžbe emailom', area: 'prijem' },
  email_msg: { label: 'Emailovi kupaca', area: 'prijem' },
  task_new: { label: 'Nove narudžbe i zadaci', area: 'zadaci' },
  task_update: { label: 'Promjene statusa, dodjele i dolazak robe', area: 'zadaci' },
  comment: { label: 'Komentari i spominjanja (@ime)' },
  res: { label: 'Rezervacije', area: 'rezervacije' },
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
  stock: 'stock',
  daily: 'daily',
};

// Comments can hang off any of these.
export const COMMENT_KINDS = ['task', 'reservation', 'inbox', 'stock'];

export const LIMITS = {
  title: 200,
  text: 4000,
  comment: 4000,
  items: 100,
  comments: 500,
};
