# STT Logistika

Temporary internal tool for wholesale (veleprodaja) and retail (maloprodaja), for the 2–3 months until the new ERP is rolled out. It is built the same way as bosning-admin (Next.js on Vercel, Upstash Redis for storage) and uses the Bosning Plan design system: cream and black bands, one orange accent, Archivo type, Day and Night themes. The whole interface is in Bosnian.

What it does:

- **Narudžbe i zadaci (orders and tasks):** every order that comes in by email, phone, Viber, WhatsApp, the web shop or in person becomes a task. It has a customer (name, contact person, phone, email, delivery address), items, payment, delivery, total, an order date, an arrival date for the goods, a due date, an assignee and a department. Status steps are *Novo → U obradi → Čeka robu → Čeka ulaznu kalkulaciju → Za fakturisanje → Završeno*. This covers the "shipment is on its way from the distributor, the invoice waits for the ulazna kalkulacija" case: set the order to *Čeka robu* with the date the goods arrive, and when they come press **Roba stigla**.
  - **Sorted by date:** the list is sorted by order date, newest first, with a heading per day (Danas, Juče, Ponedjeljak 28. 9. …). It can also be sorted by oldest first, by arrival of goods, by due date or by status.
  - **Brzi unos (quick entry):** for orders taken by phone or in person. Type what was ordered, who, and the phone number. The order is marked **Dopuniti** until you fill in the rest and press *Sve je upisano*.
  - **Roba stiže (arrival date):** for goods you're waiting on. Orders with an arrival date show on Pregled under *Roba stiže*, and the morning reminder lists what arrives that day or is late.
  - **Prati (watch):** follow any order to be notified about its status, arrival date and comments, even if it isn't yours.
- **Prijem (inbox):** WordPress/WooCommerce orders and emails arrive here by themselves, sorted into three kinds:
  - **Narudžbe (orders):** web shop orders and emails that are orders. **Prihvati kao narudžbu** makes an order with everything filled in: customer, phone, email, address, items, payment, delivery, total, and the day it was ordered. An order that came by email is marked *Dopuniti*, because the details are in the text.
  - **Emailovi kupaca (customers' emails):** questions, quote requests, "when does my order arrive". **Napravi zadatak** makes a task "Odgovoriti: …". **Dodaj u narudžbu** puts the email on the order it is about (orders from the same sender are suggested first). **Riješeno** marks it done.
  - **Ostalo (other):** anything automatic. No notification.
  
  Sorting is automatic and can be changed per email. When WooCommerce also sends its own "Nova narudžba #…" email, it is matched to the web order and not shown twice.
- **Rezervacije (laptop reservations):** each reservation records who made it (name and department), who it is for, the purpose, the payment type (cash, card, bank transfer, credit/instalments, cash on delivery…), the deposit, a "reserved until" date, and comments. Every new reservation notifies both departments.
- **Zalihe (stock):** upload the CSV your PDF scraper produces from the EKI EDI invoices, or let the office agent upload it. The app compares it with the previous export and lists what changed: quantity changes, new articles, and articles that disappeared. Tick each row once the web shop is updated.
- **Comments everywhere:** on orders, reservations, inbox items and stock exports. Writing `@Ime` notifies that colleague.
- **Logins with roles and notifications:** each person has their own account (Administrator, Veleprodaja, Maloprodaja). Notifications show on the bell in the app, and as phone or desktop push notifications once push is turned on for that device.
  - A web shop order's notification carries all its details: order number and total in the title, then the customer, city and phone, the items, the payment and delivery, and the customer's note.
  - An email's notification carries the sender, their phone number if it appears in the email, and the start of the message.
  - In **Postavke → Šta želim dobijati** each person turns categories on or off for themselves.
- **Pregled (overview):** today's numbers, what needs attention (late, due soon, waiting on a kalkulacija), the inbox, and the latest notifications. Search covers customers, order numbers and article codes.

## Integrations: what is possible and what is built

### WooCommerce orders → built

WooCommerce can call the app the moment an order is placed. This is a *webhook*: real-time and free.

1. In Vercel, set `WOO_WEBHOOK_SECRET` to a long random string.
2. In WordPress, go to WooCommerce → Postavke/Settings → Napredno/Advanced → Webhooks → *Add webhook*:
   - Status: Active
   - Topic: **Order created**
   - Delivery URL: `https://<your-domain>/api/integrations/woocommerce`
   - Secret: the same `WOO_WEBHOOK_SECRET`
   - API version: WP REST API v3
3. Optionally add a second webhook with the topic **Order updated** (same URL and secret). It refreshes the status of orders that are already in Prijem and never creates new items.

The app checks WooCommerce's signature on every call, so nobody else can post fake orders. In Postavke → Zalihe i web shop you can make web orders skip Prijem and become orders straight away.

*Possible next step (not built):* after you tick the stock changes, the app could also write the new quantities to WooCommerce through its REST API, matching products by SKU. That needs a WooCommerce API key with write access to the live shop, so I left it out. Say the word if you want it.

### Company email → built (the receiving side). You choose how mail gets to it.

The app has an address that accepts emails and puts them in Prijem. There they are sorted into orders, customers' emails and other mail, and you turn them into orders or tasks. There are two ways to feed it, depending on where the company mailbox is hosted:

- **A. The office agent reads the mailbox over IMAP (recommended if the mail is on cPanel/hosting mail).** Put the IMAP details in the agent's `config.ini`. By default it reads `INBOX`, and `folders` takes several folders separated by commas. It checks every minute and sends new emails over. It skips newsletters, mailing lists and automatic replies, plus any senders listed in `ignore_from`. No outside service and no cost, but the office PC has to be on.
  - Gmail/Google Workspace: IMAP works with an *app password* (requires 2-step verification).
  - Microsoft 365/Outlook.com: Microsoft switched off password login for IMAP, so this route does not work there. Use B.
- **B. Forward to an inbound-email service.** Set up a forwarding rule for order emails to an inbound address at Postmark, Mailgun or SendGrid (all offer a small free tier), or use a Make/Zapier "new email → webhook" scenario. Point it at `https://<your-domain>/api/integrations/email/<EMAIL_INBOUND_SECRET>`. The endpoint understands Postmark, Mailgun and SendGrid payloads, as well as plain JSON `{ from, subject, text }`.

Set `EMAIL_INBOUND_SECRET` to a long random string first. The admin sees the full address in Postavke → Integracije.

### EKI EDI invoices → built as an office agent. Worth asking the vendor about more.

e-line EKI EDI is a local desktop program, so a website on Vercel cannot reach into it. The bridge is `agent/eki_sync.py`, a small Python script (no extra packages) that runs on the office PC:

1. *(optional)* It runs **your existing PDF → CSV script** on every new invoice PDF in a folder.
2. It takes the newest CSV in the export folder and uploads it only if it changed.
3. *(optional)* It reads order emails over IMAP, as described above.

**Checking every minute costs nothing.** The check happens on the PC. An upload happens only when a new file appears, and the server ignores a file it has already seen. So the per-minute interval you asked about is fine.

What still takes a hand is exporting the invoice PDFs from EKI. Two questions for e-line or whoever maintains EKI would remove that step:

1. **Can EKI export invoices directly as CSV, Excel or XML, ideally on a schedule?** Many older ERPs have an "Izvoz" function. With one, the PDF scraping step disappears, and the agent just watches that export folder.
2. **Which database does EKI use** (MS SQL Server, Firebird, Access/DBF…)? **Can we get a read-only login?** Then the agent could read new invoices straight from the database every minute, with no manual work at all. That is a small change to the agent once we know the database type.

How the comparison works: rows are matched on the article code, and rows with the same code are added up, so an export with several invoices is fine. The app recognises Bosnian column names (Šifra, Naziv, Količina…) on its own. If your script uses other names, the admin picks the columns in Postavke → Zalihe i web shop. Files in Windows-1250 (old Windows programs) are read correctly as well as UTF-8.

## Set up on Vercel

1. Import this repo in Vercel (framework: Next.js, defaults are fine).
2. **Storage:** Project → Storage → Marketplace → *Upstash for Redis* → create and connect. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
3. **Environment variables** (Project → Settings → Environment Variables). Generate secrets with `openssl rand -hex 24`.

   | Variable | What it is |
   | --- | --- |
   | `ADMIN_USERNAME` | The main admin login (default `admin`). |
   | `ADMIN_PASSWORD` | Its password. This account always works and cannot be locked out. |
   | `ADMIN_NAME` | Name shown for the admin, e.g. `Din`. |
   | `SESSION_SECRET` | Long random string; signs the login cookie. Changing it logs everyone out. |
   | `WOO_WEBHOOK_SECRET` | Same secret as in the WooCommerce webhook. |
   | `EMAIL_INBOUND_SECRET` | Secret part of the email address (at least 16 characters). |
   | `STOCK_AGENT_TOKEN` | Token the office agent sends (at least 16 characters). |
   | `CRON_SECRET` | Long random string. Turns on the morning reminder: Vercel calls `/api/cron/daily` once a day (set in `vercel.json`, about 7:00 in Sarajevo) and sends this secret. |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | For push notifications. Generate the pair with `npx web-push generate-vapid-keys`; the subject is `mailto:you@company.ba`. |

4. Redeploy. Log in as the admin, then add colleagues in **Postavke → Korisnici** (name, username, role, starting password). Each colleague can change their password in Postavke.
5. Each person turns on notifications on their own device in **Postavke → Obavijesti na ovom uređaju**. On iPhone, first add the site to the home screen (Safari → Share → Add to Home Screen) and open it from there; iOS only allows web push for home-screen apps.

## The office agent (EKI EDI and optional IMAP)

On the office PC (Windows):

1. Install Python 3 from python.org (tick "Add python.exe to PATH").
2. Copy the `agent` folder to e.g. `C:\stt-agent`.
3. Copy `config.example.ini` to `config.ini` and fill it in: the app URL, `STOCK_AGENT_TOKEN`, the export folder, and optionally the scraper command and IMAP details.
4. Test with `python eki_sync.py --once`. It logs to the console and to `eki_sync.log`.
5. To start it automatically, press Win+R, type `shell:startup`, and put a shortcut to `pokreni_agenta.bat` there. It runs without a window whenever someone is logged in to that PC.

## Roles

| Role | Sees | Is notified about |
| --- | --- | --- |
| Administrator | Everything, plus users, integrations, settings, data export | Everything the departments hear |
| Veleprodaja | Orders and tasks, Prijem, reservations, stock | New wholesale orders, Prijem (web orders, email orders, customers' emails), new stock exports, all reservations |
| Maloprodaja | Orders and tasks, reservations | New retail orders, all reservations |

On top of that, everyone is notified about orders assigned to them, status changes, arrival dates and comments on things they created, are assigned to, watch (*Prati*) or commented on, and every `@mention`. The morning reminder goes to each person with their own list. Everyone can switch categories off for themselves in Postavke. To change who sees what, edit `ACCESS` in `lib/constants.js`.

## Costs

- **Vercel:** the free Hobby plan is meant for non-commercial use. For company use, Vercel expects the Pro plan (about $20 per month per team member). For 2–3 months, decide which one you are comfortable with.
- **Upstash Redis:** the free plan includes about 500,000 commands per month (check the current pricing). The app asks "did anything change?" every 20 seconds, only while a tab is open and visible, and that check costs 1 command. About 10 people working 8 hours a day stays within the free plan. Beyond that, pay-as-you-go is cents per 100,000 commands.
- **Push notifications and the agent:** free.

## Develop locally

```bash
npm install
cp .env.example .env.local   # set ADMIN_PASSWORD; Redis vars optional
npm run dev                  # http://localhost:3000
npm test                     # CSV comparison, integrations, and the rules end to end (in-memory store)
```

Without Redis variables the app keeps data in memory (lost on restart, not shared between devices) and shows a warning banner.

## How it's built

| Path | What |
| --- | --- |
| `lib/constants.js` | Roles, who sees what (`ACCESS`), statuses, sources, payment types, reservation purposes. |
| `lib/domain.js` | The rules: orders, reservations, comments, Prijem, stock imports, and who gets which notification. |
| `lib/csv.js` | Reads the scraper's CSV (delimiter, header and column detection) and compares two exports. |
| `lib/integrations.js` | WooCommerce signature check and order mapping; email payloads from Postmark/Mailgun/SendGrid/JSON. |
| `lib/store.js` | Redis storage. Each save checks the item's revision, so two people saving the same order at once never overwrite each other. `stt:ver` is bumped on every write so the browser's poll is one read. |
| `lib/auth.js`, `lib/users.js` | PBKDF2 password hashes, signed session cookie, accounts. Changing a password or role ends that person's old sessions. |
| `lib/notify.js` | Saved notifications (the bell) and Web Push to subscribed devices. |
| `proxy.js` | Login gate for every page and API route except the login page and the integration endpoints (which check their own secrets). |
| `components/` | The screens: `Overview`, `Tasks`, `InboxPage`, `Reservations`, `Stock`, `SettingsPage`; shared pieces in `ui.jsx`. |
| `agent/` | The office PC agent (`eki_sync.py`), its sample config, and the Windows launcher. |
| `app/api/export` | Admin download of all data as JSON: a backup, and a hand-over file for the new ERP. |

Data is stored under the key prefix `stt:` (change with `STORE_PREFIX`). To wipe everything, delete the `stt:*` keys in the Upstash console.
