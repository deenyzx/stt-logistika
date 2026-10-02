// CSV export of every list, for Excel and for the move to the new ERP. Semicolons, decimal commas, UTF-8 with a BOM:
// what Excel with Bosnian/Croatian regional settings opens correctly with a double click. Pure functions.
import {
  LINE_STATUS, TRANSFER_STATUS, REQUEST_STATUS, RES_STATUS, RES_PURPOSE, PAYMENT, TASK_STATUS, TASK_TYPES, SOURCES, DEPTS,
  INBOX_KIND, INBOX_STATUS, transferStatus,
} from './constants.js';
import { todayISO, preview } from './format.js';

const cell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(header, rows) {
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n') + '\r\n';
}

const day = (ts) => (ts ? todayISO(ts) : '');
const dayTime = (ts) => (ts ? new Date(ts).toLocaleString('bs-BA', { timeZone: 'Europe/Sarajevo' }) : '');
const comments = (o) => (o.comments || []).map((c) => `${c.by?.name || ''}: ${c.text}`).join(' | ');
const userName = (users, id) => users.find((u) => u.id === id)?.name || '';

export const EXPORTS = {
  prijenosnice: {
    area: 'prijenosnice',
    file: 'prijenosnice',
    build: ({ transfers }) => toCsv(
      ['Broj', 'Datum', 'Polazno skladište', 'Dolazno skladište', 'Status prijenosnice', 'Šifra', 'Naziv artikla', 'Količina', 'Poslano kom', 'Nabavna cijena', 'Prodajna cijena', 'Total', 'Status artikla', 'Otpremljeno', 'Primljeno dana', 'Napomena artikla', 'Napomena', 'Napravio/la', 'Napravljeno', 'Komentari'],
      [...transfers].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt).flatMap((t) => t.items.map((l) => [
        t.number, t.date, t.from?.name, t.to?.name, TRANSFER_STATUS[transferStatus(t)]?.label, l.code, l.name, l.qty, l.sentQty, l.buy, l.sell,
        l.sell != null && l.qty != null ? Math.round(l.sell * l.qty * 100) / 100 : null, LINE_STATUS[l.status]?.label, day(l.shippedAt), l.receivedOn,
        l.note, t.note, t.createdBy?.name, dayTime(t.createdAt), comments(t),
      ])),
    ),
  },
  upiti: {
    area: 'upiti',
    file: 'upiti-mp',
    build: ({ requests }) => toCsv(
      ['Broj', 'Datum', 'P/N', 'Kataloški broj', 'Naziv artikla', 'Količina', 'Detalji o kupcu', 'Pitanje / zahtjev', 'Odgovor (cijena, vrijeme, detalji)', 'Status', 'Datum odgovora', 'Odgovorio/la', 'Postavio/la', 'Komentari'],
      [...requests].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt).map((r) => [
        r.number, r.date, r.pn, r.code, r.name, r.qty, r.customer, r.question, r.answer, REQUEST_STATUS[r.status]?.label, day(r.answeredAt), r.answeredBy?.name,
        r.createdBy?.name, comments(r),
      ]),
    ),
  },
  rezervacije: {
    area: 'rezervacije',
    file: 'rezervacije',
    build: ({ reservations }) => toCsv(
      ['Broj', 'Napravljeno', 'Artikal', 'Šifra / S/N', 'Količina', 'Cijena', 'Za koga', 'Telefon', 'Svrha', 'Opis svrhe', 'Plaćanje', 'Avans', 'Rezervisano do', 'Status', 'Potvrdio/la (VP)', 'Napravio/la', 'Komentari'],
      [...reservations].sort((a, b) => a.createdAt - b.createdAt).map((r) => [
        r.number, dayTime(r.createdAt), r.model, r.code, r.qty, r.price, r.customer?.name, r.customer?.phone, RES_PURPOSE[r.purposeType], r.purpose, PAYMENT[r.payment],
        r.deposit, r.until, RES_STATUS[r.status]?.label, r.confirmedBy?.name, r.createdBy?.name, comments(r),
      ]),
    ),
  },
  zadaci: {
    area: 'zadaci',
    file: 'narudzbe-i-zadaci',
    build: ({ tasks, users }) => toCsv(
      ['Broj', 'Vrsta', 'Datum narudžbe', 'Naslov', 'Kupac', 'Kontakt osoba', 'Telefon', 'Email', 'Adresa', 'Izvor', 'Odjel', 'Status', 'Dodijeljeno', 'Rok', 'Roba stiže', 'Dobavljač', 'Stavke', 'Ukupno', 'Plaćanje', 'Dostava', 'Napomena', 'Dopuniti', 'Napravio/la', 'Napravljeno', 'Komentari'],
      [...tasks].sort((a, b) => a.createdAt - b.createdAt).map((t) => [
        t.number, TASK_TYPES[t.type]?.label, t.orderedAt, t.title, t.customer?.name, t.customer?.contact, t.customer?.phone, t.customer?.email, t.customer?.address,
        SOURCES[t.source]?.label, DEPTS[t.dept], TASK_STATUS[t.status]?.label, userName(users, t.assignee), t.due, t.expectedAt, t.supplier,
        (t.items || []).map((i) => [i.qty != null ? i.qty + '×' : '', i.name, i.code ? `(${i.code})` : ''].filter(Boolean).join(' ')).join(' | '),
        t.total, t.payment, t.delivery, t.note, t.needsInfo ? 'da' : '', t.createdBy?.name, dayTime(t.createdAt), comments(t),
      ]),
    ),
  },
  prijem: {
    area: 'prijem',
    file: 'prijem',
    build: ({ inbox }) => toCsv(
      ['Primljeno', 'Izvor', 'Vrsta', 'Shop', 'Broj narudžbe', 'Naslov', 'Od', 'Email', 'Telefon', 'Status', 'Iznos', 'Plaćanje', 'Tekst'],
      [...inbox].sort((a, b) => a.receivedAt - b.receivedAt).map((x) => [
        dayTime(x.receivedAt), x.source === 'web' ? 'Web shop' : 'Email', INBOX_KIND[x.kind]?.label, x.shopName, x.order?.number, x.title, x.from?.name, x.from?.email,
        x.from?.phone, INBOX_STATUS[x.status], x.order?.total, x.order?.payment, preview(x.body, 1000),
      ]),
    ),
  },
  artikli: {
    area: 'zalihe',
    file: 'artikli-stanje',
    build: ({ articles }) => toCsv(
      ['Šifra', 'Naziv artikla', 'Stanje VP', 'Rezervisano', 'Slobodno', 'Nabavna cijena', 'Prodajna cijena'],
      articles.map((a) => [a.code, a.name, a.qty, a.reserved, a.free, a.buy, a.sell]),
    ),
  },
};
