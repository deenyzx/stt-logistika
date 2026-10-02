# STT Logistika

Temporary internal tool for wholesale (veleprodaja) and retail (maloprodaja), for the 2–3 months until the new ERP is rolled out. It replaces the shared *STT_KupiLenovo_MP_VP* spreadsheet (and the Viber messages before it): prijenosnice, upiti MP and reservations live here now, next to the web shop orders, emails and everyone's own tasks, and everything waiting on a person is in one list. It is built the same way as bosning-admin (Next.js on Vercel, Upstash Redis for storage) and uses the Bosning Plan design system: cream and black bands, one orange accent, Archivo type, Day and Night themes. The whole interface is in Bosnian.

What it does:

- **Moje obaveze (my responsibilities), the home screen:** one list of everything waiting on the person who is logged in, from every part of the app: prijenosnice to answer, ship or receive, upiti to answer or close, reservations to confirm or that are running out, new web shop orders and customers' emails, and their own orders and tasks. Late items are on top, the rest by day (today marked green and yesterday yellow, like the sheet). Chips filter by kind; the counts at the top replace the sheet's DASHBOARD.
- **Prijenosnice (transfers between warehouses):** replaces the PRIJENOSNICE sheet. Each prijenosnica shows where the goods go **from** (*polazno skladište*) and **to** (*dolazno skladište*), in a black-and-orange strip that cannot be misread. It has one or more lines; type the **šifra** and the name, purchase and sale price and the free VP stock fill in by themselves from the latest stock export (what the sheet's VLOOKUPs into ARTIKLI and STANJE did), and the total is worked out. Each line has its own status, as in the sheet: *Novi → Dostupno / Parcijalno dostupan / Nedostupno → Otpremljen → Primljen* (with the day it arrived, which replaces "Primljena dana"), plus a note per line.
  - The **sending** warehouse answers availability and ships (*Otpremi dostupno*); the **receiving** warehouse confirms arrival (*Potvrdi prijem*). Which role works which side comes from the warehouse: a VP warehouse is handled by Veleprodaja, an MP warehouse by Maloprodaja, so a return from MP to VP swaps the sides by itself. Each step notifies the other side.
  - Warehouses are set by the admin in **Postavke → Skladišta** (start: *VP skladište* and *Maloprodaja KupiLenovo*); add more stores there.
- **Upiti MP (retail asks wholesale):** replaces the UPITI MP sheet: date, P/N, kataloški broj, article, quantity, customer details, the question. Veleprodaja writes the answer (price, time, details) and presses *Dostupno* or *Nije dostupno*; **the answer's date and author are recorded by themselves**. Whoever asked is notified, tells the customer and presses *Završeno*. From an answered upit, *Napravi prijenosnicu* or *Rezerviši* starts one already filled in.
- **Narudžbe i zadaci (orders and tasks):** every order that comes in by email, phone, Viber, WhatsApp, the web shop or in person becomes a task. It has a customer (name, contact person, phone, email, delivery address), items, payment, delivery, total, an order date, an arrival date for the goods, a due date, an assignee and a department. Status steps are *Novo → U obradi → Čeka robu → Čeka ulaznu kalkulaciju → Za fakturisanje → Završeno*. This covers the "shipment is on its way from the distributor, the invoice waits for the ulazna kalkulacija" case: set the order to *Čeka robu* with the date the goods arrive, and when they come press **Roba stigla**.
  - **Sorted by date:** the list is sorted by order date, newest first, with a heading per day (Danas, Juče, Ponedjeljak 28. 9. …). It can also be sorted by oldest first, by arrival of goods, by due date or by status.
  - **Brzi unos (quick entry):** for orders taken by phone or in person. Type what was ordered, who, and the phone number. The order is marked **Dopuniti** until you fill in the rest and press *Sve je upisano*.
  - **Roba stiže (arrival date):** for goods you're waiting on. Orders with an arrival date show on Moje obaveze (on the day, or late) and under *Roba stiže*, and the morning reminder lists what arrives that day or is late.
  - **Prati (watch):** follow any order to be notified about its status, arrival date and comments, even if it isn't yours.
- **Prijem (inbox):** orders from the web shops (KupiLenovo, KupiTelevizor, …) and the company's emails arrive here by themselves. Nothing turns into a task on its own: **you choose** which ones to take. They are grouped into three tabs:
  - **Narudžbe (orders):** web shop orders and emails that are orders. **Prihvati kao narudžbu** makes an order with everything filled in: customer, phone, email, address, items, payment, delivery, total, and the day it was ordered. An order that came by email is marked *Dopuniti*, because the details are in the text.
  - **Upiti kupaca (customers' emails):** questions, quote requests, "when does my order arrive". **Napravi zadatak** makes a task "Odgovoriti: …". **Dodaj u narudžbu** puts the email on the order it is about (orders from the same sender are suggested first). **Riješeno** marks it done.
  - **Ostalo (other):** newsletters, automatic and internal mail. No notification, but still there: **Napravi zadatak** works on any email.
  
  The tab is picked by simple keywords and can be changed per email ("remember for all emails from this sender" makes it permanent). When the shop also sends its own "Nova narudžba #…" email, it is matched to the web order and not shown twice. See *Which emails reach Prijem* below.
- **Web shop orders, live:** an order from a shop shows its current status in that shop. With the shop's API key, an order in *Procesuiranje* gets one button, **Završeno u shopu**, which sets it to *Završeno* without opening WordPress. This is on the order in Prijem and on the task made from it. It is the only thing the app ever changes in a shop (see *What leaves the app* below).
- **Rezervacije (laptops and anything else):** each reservation records who made it (name and department), what (a šifra fills in the name and price and shows the free stock), who it is for, the purpose, the payment type (cash, card, bank transfer, credit/instalments, cash on delivery…), the deposit, a "reserved until" date, and comments. A reservation made by Maloprodaja is **forwarded to Veleprodaja** (*Čeka potvrdu VP*); Veleprodaja sets the item aside and presses *Potvrdi i odvoji* (or *Odbij*), and the person who asked is notified. Veleprodaja's own reservations are active straight away, unless they tick *Proslijedi veleprodaji*. Open reservations are taken off the free stock.
- **Zalihe (stock):** upload the CSV your PDF scraper produces from the EKI EDI invoices, or let the office agent upload it. The app compares it with the previous export and lists what changed: quantity changes, new articles, and articles that disappeared. Tick each row once the web shop is updated. The **Artikli i stanje** tab lists the latest export with VP stock, reserved, free, and the purchase and sale price (if the CSV has those columns: *Nabavna cijena*, *Prodajna cijena*, *MPC*, *Cijena*…; otherwise pick them in Postavke). This is the lookup the prijenosnice, upiti and reservations use.
- **Database and CSV export:** everything is stored in the database (Upstash Redis), finished items included. Every list downloads as **CSV for Excel** (the *CSV* button on each page, or Postavke → Izvoz): prijenosnice (one row per line), upiti MP, rezervacije, narudžbe i zadaci, prijem, artikli i stanje. Semicolons, decimal commas and UTF-8 with a BOM, so Excel with Bosnian settings opens it with a double click. The admin can also download the whole database as one JSON file. Lists in the app show open items and anything finished in the last 60 days; older ones stay in the database and the CSV.
- **Comments everywhere:** on prijenosnice, upiti, orders, reservations, inbox items and stock exports. Writing `@Ime` notifies that colleague.
- **Logins with roles and notifications:** each person has their own account (Administrator, Veleprodaja, Maloprodaja). Notifications show on the bell in the app, and as phone or desktop push notifications once push is turned on for that device.
  - A web shop order's notification carries all its details: order number and total in the title, then the customer, city and phone, the items, the payment and delivery, and the customer's note.
  - An email's notification carries the sender, their phone number if it appears in the email, and the start of the message.
  - In **Postavke → Šta želim dobijati** each person turns categories on or off for themselves.
- **Search** on Moje obaveze covers prijenosnice, upiti, orders, reservations and Prijem: numbers, šifre, articles, customers.
- **Morning reminder:** besides arrivals, due dates and expiring reservations, it lists the prijenosnice, upiti and reservations waiting on each person.

## Integrations: what is possible and what is built

### Web shops (WooCommerce) → built. One entry per shop.

Each shop (KupiLenovo, KupiTelevizor, …) is added by the admin in **Postavke → Web shopovi**: its name (as in the email subject, `[KupiTelevizor] Nova narudžba …`), its address, and a REST API key. Orders reach the app in up to three ways, and all three land on the same item (matched by shop and order number):

1. **The shop's "Nova narudžba" email**, through the email connection below. Works with no setup in WordPress. The app reads the whole email: customer, phone, email, address, items with codes, prices, delivery, total, VAT, payment and the note.
2. **A webhook** (instant): in the shop's WordPress, WooCommerce → Postavke → Napredno → Webhooks → *Dodaj webhook*. Status *Aktivan*, topic **Narudžba kreirana** (Order created), API version WP REST API v3, and the delivery URL and secret shown for that shop in Postavke → Web shopovi. A second webhook with the topic **Narudžba ažurirana** (Order updated) keeps the status up to date.
3. **The REST API**, to read an order's status and to set *Procesuiranje → Završeno*: WooCommerce → Postavke → Napredno → REST API → *Dodaj ključ*, permissions **Čitanje/Pisanje** (Read/Write; writing is needed only for that one status change). Copy the Consumer key (`ck_…`) and Consumer secret (`cs_…`) straight away (WooCommerce shows them once) and paste them into the shop in Postavke. *Provjeri vezu* tests the key by reading the newest order. With the key, the morning job also reads the last three days of orders in case a webhook or email was missed, and **Prijem → Provjeri shopove** does it on demand.

The key is stored only on the server and never sent to the browser. The status change is logged on the order and the task here, with the colleague's name. The app adds no notes in the shop (WooCommerce records the status change in its own order history, as it always does). Only Administrator and Veleprodaja can do it (`ACCESS.webshop` in `lib/constants.js`).

#### What leaves the app

- **To the shops:** only reads (orders, for status and the safety-net sync), plus one kind of write: `PUT /wp-json/wc/v3/orders/<id>` with the body `{"status":"completed"}`, and only after reading the order and finding it in *Procesuiranje* (`processing`). `wc()` in `lib/shops.js` refuses every other write (other statuses, notes, customer notes, deletes) before it is sent, and a test checks this.
- **To customers:** nothing. The app sends no emails at all and has no way to.
- **Watch out:** WooCommerce itself emails the customer "your order is complete" whenever an order becomes *Završeno*, no matter who changes it. If you don't want that, turn it off in each shop: WooCommerce → Postavke → Emailovi → *Završena narudžba* (Completed order) → untick *Omogući*.
- **To the team:** in-app notifications, and push notifications to the devices each person turned on (through the browser's push service).

The app checks WooCommerce's signature on every webhook call, so nobody else can post fake orders. In Postavke → Zalihe i web shop you can make web orders skip Prijem and become orders straight away. A single shop can still be set up the old way with env variables (`WOO_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`, `WOO_WEBHOOK_SECRET`, `WOO_SHOP_NAME`, webhook URL without `?shop=`).

### Company email → built (the receiving side). You choose how mail gets to it.

The app has an address that accepts emails and puts them in Prijem, where you choose which ones become orders or tasks. There are two ways to feed it, depending on where the company mailbox is hosted:

- **A. The office agent reads the mailbox over IMAP (recommended if the mail is on cPanel/hosting mail).** Put the IMAP details in the agent's `config.ini`. By default it reads `INBOX`, and `folders` takes several folders separated by commas. It checks every minute and sends new emails over, skipping only senders listed in `ignore_from` (and newsletters, if you set `skip_bulk = yes`). No outside service and no cost, but the office PC has to be on.
  - Gmail/Google Workspace: IMAP works with an *app password* (requires 2-step verification).
  - Microsoft 365/Outlook.com: Microsoft switched off password login for IMAP, so this route does not work there. Use B.
- **B. Forward to an inbound-email service.** Set up a forwarding rule for order emails to an inbound address at Postmark, Mailgun or SendGrid (all offer a small free tier), or use a Make/Zapier "new email → webhook" scenario. Point it at `https://<your-domain>/api/integrations/email/<EMAIL_INBOUND_SECRET>`. The endpoint understands Postmark, Mailgun and SendGrid payloads, as well as plain JSON `{ from, subject, text }`.

Set `EMAIL_INBOUND_SECRET` to a long random string first. The admin sees the full address in Postavke → Integracije.

#### Which emails reach Prijem

Everything that arrives goes into Prijem, and you decide. To keep it tidy:

1. **Feed it only the mail that matters.** Best done at the mailbox: point the agent at the addresses or folders that customers and the shops write to (`folders = INBOX, Narudzbe`), or forward only those to option B. A mailbox rule like "from `@kupilenovo.ba`/`@kupitelevizor.ba` or to `prodaja@` → folder *Narudzbe*" works in every mail program.
2. **Shop order emails** are always recognised and become full web orders, whatever the rules say.
3. **Your rules** in Postavke → Email: *sender / recipient / subject / text contains …* → Narudžba, Upit kupca, Ostalo or Ignoriši. Write word stems (`ponud`, `narudžb`, `cijen`) to catch every case ending; separate alternatives with commas; case and diacritics don't matter. The first matching rule wins.
4. **From Prijem:** move an email to another tab and tick *Zapamti za sve emailove od …*, or press *Nikad od ovog pošiljaoca*. Both create a rule.
5. **Ignored mail** waits in Prijem → *Preskočeno* (the last 200), where it can be brought back with one click. Postavke → Email can also send all of *Ostalo* there instead of Prijem.

No email is read by any outside service or AI.

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
   | `WOO_*` | Optional. Shops are added in Postavke → Web shopovi; these are only for setting up one shop through Vercel instead. |
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
| Administrator | Everything, plus users, warehouses, integrations, settings, the full database export | Everything the departments hear |
| Veleprodaja | Moje obaveze, prijenosnice, upiti MP, orders and tasks, Prijem, reservations, stock | New prijenosnice from a VP warehouse, new upiti MP, reservations to confirm, new wholesale orders, Prijem (web orders, email orders, customers' emails), new stock exports |
| Maloprodaja | Moje obaveze, prijenosnice, upiti MP, orders and tasks, reservations | Availability, shipping and arrival of their prijenosnice, answers to their upiti, confirmed reservations, new retail orders |

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
| `lib/shops.js` | The web shops and the WooCommerce REST API: read orders, and the one allowed write (Procesuiranje → Završeno). |
| `lib/wooEmail.js` | Reads a shop's "Nova narudžba" email (plain text or HTML) into a full order. |
| `lib/emailRules.js` | The admin's email rules. |
| `lib/store.js` | Redis storage. Each save checks the item's revision, so two people saving the same order at once never overwrite each other. `stt:ver` is bumped on every write so the browser's poll is one read. |
| `lib/auth.js`, `lib/users.js` | PBKDF2 password hashes, signed session cookie, accounts. Changing a password or role ends that person's old sessions. |
| `lib/notify.js` | Saved notifications (the bell) and Web Push to subscribed devices. |
| `proxy.js` | Login gate for every page and API route except the login page and the integration endpoints (which check their own secrets). |
| `components/` | The screens: `Overview`, `Tasks`, `InboxPage`, `Reservations`, `Stock`, `SettingsPage`; shared pieces in `ui.jsx`. |
| `agent/` | The office PC agent (`eki_sync.py`), its sample config, and the Windows launcher. |
| `lib/transfers.js`, `lib/requests.js` | Prijenosnice (lines, sides, statuses, notifications) and upiti MP. |
| `lib/articles.js` | Article lookup by šifra from the latest stock export, minus open reservations. |
| `lib/obligations.js` | *Moje obaveze*: what is waiting on each person, from every part of the app. |
| `lib/exportCsv.js`, `app/api/export` | CSV export of every list (Excel-friendly), and the admin's full JSON download. |

Data is stored under the key prefix `stt:` (change with `STORE_PREFIX`). To wipe everything, delete the `stt:*` keys in the Upstash console.
