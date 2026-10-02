'use client';
// Postavke: your account, theme, push on this device; for the admin also users, web shops, email sorting rules,
// integrations, stock columns, export.
import { useEffect, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Input, Select, Sheet, Tag, Note, Avatar } from '@/components/ui.jsx';
import { ROLES, DEPTS, NOTIF_CATS, can } from '@/lib/constants.js';
import { RULE_FIELDS, RULE_ACTIONS } from '@/lib/emailRules.js';

function b64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function SettingsPage() {
  const { me, route } = useApp();
  useEffect(() => {
    if (route.arg) document.getElementById('sec-' + route.arg)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [route.arg]);
  return (
    <main className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Postavke" />
      <Account />
      <Push />
      <NotifPrefs />
      {me.role === 'admin' ? <><Users /><Shops /><EmailSorting /><Integrations /><StockSettings /><ExportData /></> : null}
    </main>
  );
}

function Section({ id, title, children }) {
  return (
    <section className="card set-sec" id={id ? 'sec-' + id : undefined} aria-label={title}>
      <h2 className="h-heading">{title}</h2>
      {children}
    </section>
  );
}

function Account() {
  const { me, theme, setTheme, logout, toast } = useApp();
  const [pw, setPw] = useState({ old: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const change = async (e) => {
    e.preventDefault();
    setErr(null);
    if (pw.next !== pw.again) { setErr('Nove lozinke se ne poklapaju.'); return; }
    setBusy(true);
    try { await api('PATCH', '/api/me', { oldPassword: pw.old, newPassword: pw.next }); toast('Lozinka je promijenjena'); setPw({ old: '', next: '', again: '' }); }
    catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <Section title="Moj nalog">
      <div className="row" style={{ gap: 12 }}>
        <Avatar name={me.name} me />
        <div className="stack grow"><strong>{me.name}</strong><span className="small muted">{me.username} · {ROLES[me.role]?.label}</span></div>
        <Button icon="logout" onClick={logout}>Odjavi se</Button>
      </div>
      <div className="field">
        <span className="field-label">Izgled</span>
        <Segmented label="Tema" value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Dan' }, { value: 'dark', label: 'Noć' }]} />
      </div>
      {me.env ? <Note icon="key">Ovo je glavni administratorski nalog iz postavki Vercela. Lozinka se mijenja tamo (ADMIN_PASSWORD).</Note> : (
        <form className="stack" style={{ gap: 12 }} onSubmit={change}>
          <span className="field-label">Promijeni lozinku</span>
          {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
          <div className="grid3">
            <Input label="Trenutna" type="password" value={pw.old} onChange={(v) => setPw({ ...pw, old: v })} autoComplete="current-password" />
            <Input label="Nova" type="password" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" />
            <Input label="Nova, ponovo" type="password" value={pw.again} onChange={(v) => setPw({ ...pw, again: v })} autoComplete="new-password" />
          </div>
          <div><Button type="submit" icon="key" busy={busy} disabled={!pw.old || !pw.next}>Promijeni lozinku</Button></div>
        </form>
      )}
    </Section>
  );
}

function Push() {
  const { data, toast } = useApp();
  const [state, setState] = useState('checking'); // checking | unsupported | ios | off | on | denied
  const [busy, setBusy] = useState(false);
  const serverOn = data.push.enabled;

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setState(ios && !standalone ? 'ios' : 'unsupported'); return; }
      if (Notification.permission === 'denied') { setState('denied'); return; }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); setBusy(false); return; }
      const reg = (await navigator.serviceWorker.getRegistration()) || (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(data.push.publicKey) });
      await api('POST', '/api/push', { subscription: sub.toJSON() });
      setState('on');
      toast('Obavijesti su uključene na ovom uređaju');
    } catch (e) { toast(e.message || 'Nije uspjelo.', { error: true }); }
    setBusy(false);
  };
  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await api('DELETE', '/api/push', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setState('off');
      toast('Obavijesti su isključene na ovom uređaju');
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const test = async () => {
    setBusy(true);
    try { const r = await api('POST', '/api/push', { test: true }); toast(r.sent ? 'Poslano. Trebalo bi stići za par sekundi.' : 'Nema uređaja za slanje.'); }
    catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };

  return (
    <Section id="obavijesti" title="Obavijesti na ovom uređaju">
      <p className="muted">Dobijaš obavijesti o novim rezervacijama, narudžbama koje su tebi ili tvom odjelu, promjenama statusa i komentarima gdje te neko spomene (@ime). U aplikaciji ih uvijek vidiš na zvonu.</p>
      {!serverOn ? <Note tone="accent" icon="belloff">Push obavijesti još nisu podešene na serveru (VAPID ključevi u Vercelu, vidi README). Do tada obavijesti stoje samo na zvonu u aplikaciji.</Note>
        : state === 'ios' ? <Note icon="phonebig">Na iPhoneu obavijesti rade kad je aplikacija dodana na početni ekran: u Safariju Dijeli → Dodaj na početni ekran, pa otvori aplikaciju odatle i vrati se ovdje.</Note>
          : state === 'unsupported' ? <Note icon="alert">Ovaj preglednik ne podržava push obavijesti.</Note>
            : state === 'denied' ? <Note tone="danger" icon="belloff">Obavijesti su blokirane u pregledniku. Dozvoli ih u postavkama stranice (ikona lokota pored adrese).</Note>
              : (
                <div className="row">
                  {state === 'on' ? <span className="status-ok"><Icon name="ok" size={18} />Uključeno</span> : <span className="status-off"><Icon name="belloff" size={18} />Isključeno</span>}
                  <span className="grow" />
                  {state === 'on' ? <><Button icon="send" busy={busy} onClick={test}>Pošalji probnu</Button><Button busy={busy} onClick={disable}>Isključi</Button></>
                    : <Button variant="primary" icon="bell" busy={busy} disabled={state === 'checking'} onClick={enable}>Uključi obavijesti</Button>}
                </div>
              )}
    </Section>
  );
}

function NotifPrefs() {
  const { data, me, reload, toast } = useApp();
  const [muted, setMuted] = useState(() => new Set(data.notifications.muted || []));
  const [busy, setBusy] = useState(false);
  const cats = Object.entries(NOTIF_CATS).filter(([, c]) => !c.area || can(me.role, c.area));
  const toggle = async (key, on) => {
    const next = new Set(muted);
    if (on) next.delete(key); else next.add(key);
    setMuted(next);
    setBusy(true);
    try { await api('PATCH', '/api/prefs', { muted: [...next] }); toast(on ? 'Uključeno: ' + NOTIF_CATS[key].label : 'Isključeno: ' + NOTIF_CATS[key].label); reload(); }
    catch (e) { toast(e.message, { error: true }); setMuted(muted); }
    setBusy(false);
  };
  return (
    <Section id="sta-primam" title="Šta želim dobijati">
      <p className="muted">Vrijedi za zvono u aplikaciji i za push obavijesti na svim tvojim uređajima. Web narudžbe dolaze s kupcem, telefonom, gradom, stavkama, iznosom, plaćanjem i dostavom; emailovi s pošiljaocem i početkom poruke.</p>
      <div className="stack">
        {cats.map(([key, c]) => (
          <label key={key} className="urow checkrow">
            <input type="checkbox" checked={!muted.has(key)} disabled={busy} onChange={(e) => toggle(key, e.target.checked)} />
            <span className="grow">{c.label}</span>
          </label>
        ))}
      </div>
    </Section>
  );
}

function Users() {
  const { me, toast, reload } = useApp();
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(null);
  const load = async () => { try { setUsers((await api('GET', '/api/users')).users); } catch (e) { toast(e.message, { error: true }); } };
  useEffect(() => { load(); }, []);
  const done = () => { setForm(null); load(); reload(); };
  return (
    <Section id="korisnici" title="Korisnici">
      <p className="muted">Svako ima svoj nalog. Uloga određuje šta vidi i koje obavijesti dobija: <strong>Veleprodaja</strong> vidi sve i prijem, <strong>Maloprodaja</strong> narudžbe i rezervacije, <strong>Administrator</strong> sve i ove postavke.</p>
      <div>
        {users === null ? <p className="muted">Učitavam…</p> : users.map((u) => (
          <div className="urow" key={u.id}>
            <Avatar name={u.name} me={u.id === me.id} />
            <div className="stack grow" style={{ minWidth: 160 }}>
              <strong>{u.name}{u.id === me.id ? ' (ti)' : ''}</strong>
              <span className="small muted">{u.username}{u.env ? ' · glavni nalog' : ''}</span>
            </div>
            <Tag tone={u.role === 'admin' ? 'band' : 'plain'}>{ROLES[u.role]?.label}</Tag>
            {u.disabled ? <Tag tone="danger" icon="ban">Isključen</Tag> : null}
            {!u.env ? <Button size="sm" icon="edit" onClick={() => setForm(u)}>Uredi</Button> : null}
          </div>
        ))}
      </div>
      <div><Button variant="primary" icon="plus" onClick={() => setForm('new')}>Dodaj korisnika</Button></div>
      {form ? <UserForm user={form === 'new' ? null : form} onClose={() => setForm(null)} onDone={done} /> : null}
    </Section>
  );
}

function UserForm({ user, onClose, onDone }) {
  const { me, toast } = useApp();
  const edit = !!user;
  const [f, setF] = useState({ username: user?.username || '', name: user?.name || '', role: user?.role || 'veleprodaja', password: '', disabled: !!user?.disabled });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (edit) {
        const patch = { name: f.name, role: f.role, disabled: f.disabled };
        if (f.password) patch.password = f.password;
        await api('PATCH', '/api/users/' + user.id, patch);
        toast('Sačuvano');
      } else {
        await api('POST', '/api/users', f);
        toast(`Nalog ${f.username} je napravljen. Pošalji kolegi korisničko ime i lozinku.`);
      }
      onDone();
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Obrisati nalog ${user.name}? Njegove narudžbe i komentari ostaju.`)) return;
    try { await api('DELETE', '/api/users/' + user.id); toast('Obrisano'); onDone(); } catch (e2) { setErr(e2.message); }
  };
  return (
    <Sheet title={edit ? 'Uredi: ' + user.name : 'Novi korisnik'} onClose={onClose}
      footer={<>
        {edit && user.id !== me.id ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon="check" busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Napravi nalog'}</Button>
      </>}>
      <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <div className="grid2">
          <Input label="Ime" value={f.name} onChange={(v) => set('name', v)} placeholder="Npr. Amra" autoFocus />
          <Input label="Korisničko ime" value={f.username} onChange={(v) => set('username', v)} disabled={edit} placeholder="npr. amra" autoCapitalize="none" autoComplete="off" hint={edit ? undefined : 'Mala slova, bez razmaka.'} />
        </div>
        <Select label="Uloga" value={f.role} onChange={(v) => set('role', v)} options={Object.entries(ROLES).map(([value, r]) => ({ value, label: r.label }))} />
        <Input label={edit ? 'Nova lozinka (ostavi prazno da ostane ista)' : 'Lozinka'} type="text" value={f.password} onChange={(v) => set('password', v)} autoComplete="off" hint="Bar 6 znakova. Kolega je može promijeniti u Postavkama." />
        {edit && user.id !== me.id ? (
          <label className="checkrow">
            <input type="checkbox" checked={f.disabled} onChange={(e) => set('disabled', e.target.checked)} />
            <span>Isključi nalog (ne može se prijaviti)</span>
          </label>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function Shops() {
  const { data, reload, toast } = useApp();
  const [form, setForm] = useState(null);
  const [testing, setTesting] = useState(null);
  const [result, setResult] = useState({});
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const test = async (shop, quiet) => {
    setTesting(shop.id);
    try {
      const r = await api('POST', '/api/shops/test', { id: shop.id });
      const text = `Veza radi. ${r.lastOrder ? 'Zadnja narudžba #' + r.lastOrder.number + '.' : 'Još nema narudžbi.'}`;
      setResult((x) => ({ ...x, [shop.id]: { ok: true, text } }));
      if (quiet) toast(shop.name + ': veza radi');
    } catch (e) {
      setResult((x) => ({ ...x, [shop.id]: { ok: false, text: e.message } }));
      if (quiet) toast(e.message, { error: true });
    }
    setTesting(null);
  };
  const done = (shop) => { setForm(null); reload(); if (shop?.api) test(shop, true); };

  return (
    <Section id="shopovi" title="Web shopovi">
      <p className="muted">Za svaki WooCommerce shop (KupiLenovo, KupiTelevizor…): <strong>API ključ</strong> da se u aplikaciji vidi status narudžbe i da se jednim klikom prebaci iz „Procesuiranje” u „Završeno” (ništa drugo aplikacija u shopu ne mijenja), i <strong>webhook</strong> da nova narudžba stigne odmah. Narudžbe stižu i preko emaila „Nova narudžba”, pa radi i dok webhook nije podešen.</p>
      {data.shops.length ? data.shops.map((sh) => (
        <div className="shop-row" key={sh.id}>
          <div className="row" style={{ gap: 10 }}>
            <Icon name="globe" size={20} />
            <div className="stack grow" style={{ minWidth: 160 }}>
              <strong>{sh.name}</strong>
              <span className="small muted">{sh.url || 'adresa nije upisana'}{sh.env ? ' · iz Vercela' : ''}</span>
            </div>
            {sh.api ? <Tag tone="ok" icon="key">API {sh.keyHint}</Tag> : <Tag tone="wait" icon="key">Bez API ključa</Tag>}
            {sh.api ? <Button size="sm" icon="plug" busy={testing === sh.id} onClick={() => test(sh)}>Provjeri vezu</Button> : null}
            {!sh.env ? <Button size="sm" icon="edit" onClick={() => setForm(sh)}>Uredi</Button> : null}
          </div>
          {result[sh.id] ? <Note tone={result[sh.id].ok ? 'ok' : 'danger'} icon={result[sh.id].ok ? 'ok' : 'alert'}>{result[sh.id].text}</Note> : null}
          <details className="more">
            <summary><Icon name="link" size={16} />Webhook za nove narudžbe</summary>
            <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
              <p className="small muted">U WordPressu ovog shopa: WooCommerce → Postavke → Napredno → Webhooks → Dodaj webhook. Status: Aktivan, Tema: „Narudžba kreirana”, API verzija: WP REST API v3. Adresa za isporuku:</p>
              <CopyRow value={origin + sh.webhookPath} />
              <p className="small muted">Tajna:</p>
              {sh.webhookSecret ? <CopyRow value={sh.webhookSecret} /> : <p className="small">WOO_WEBHOOK_SECRET iz Vercela</p>}
              <p className="small muted">Ako želiš da se ovdje vidi i kad neko promijeni status u shopu, dodaj još jedan isti webhook s temom „Narudžba ažurirana”.</p>
            </div>
          </details>
        </div>
      )) : <Note icon="globe">Još nema shopova. Dodaj KupiLenovo, KupiTelevizor i ostale.</Note>}
      <div><Button variant="primary" icon="plus" onClick={() => setForm('new')}>Dodaj shop</Button></div>
      <details className="more">
        <summary><Icon name="key" size={16} />Kako napraviti API ključ</summary>
        <ol className="small steps">
          <li>U WordPressu shopa: WooCommerce → Postavke → Napredno → REST API → Dodaj ključ.</li>
          <li>Opis: „STT Logistika”. Korisnik: administrator shopa. Dozvole: <strong>Čitanje/Pisanje</strong> (Read/Write).</li>
          <li>Generiši ključ i odmah kopiraj Consumer key (ck_…) i Consumer secret (cs_…): WooCommerce ih pokaže samo jednom.</li>
          <li>Ovdje: Dodaj shop (ili Uredi), zalijepi oba i sačuvaj. Aplikacija odmah provjeri vezu.</li>
        </ol>
        <p className="small muted">Pisanje treba samo za promjenu statusa u „Završeno”; aplikacija ne šalje napomene, emailove ni bilo šta drugo. Ključ daje pristup narudžbama, zato ga ne šalji emailom ni porukom. Čuva se samo na serveru i ne prikazuje se nikome u aplikaciji. Ako procuri, obriši ga u WooCommerce i napravi novi.</p>
        <Note tone="accent" icon="mail">WooCommerce sam šalje kupcu email „Narudžba završena” kad se status promijeni u Završeno, bez obzira ko ga mijenja. Ako to ne želiš: WooCommerce → Postavke → Emailovi → „Završena narudžba” → isključi.</Note>
      </details>
      {form ? <ShopForm shop={form === 'new' ? null : form} onClose={() => setForm(null)} onDone={done} /> : null}
    </Section>
  );
}

function ShopForm({ shop, onClose, onDone }) {
  const { toast } = useApp();
  const edit = !!shop;
  const [f, setF] = useState({ name: shop?.name || '', url: shop?.url || '', key: '', secret: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api('POST', '/api/shops', { ...f, id: shop?.id });
      toast(edit ? 'Sačuvano' : `${r.shop.name} je dodan`);
      onDone(r.shop);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Ukloniti ${shop.name} iz aplikacije? Narudžbe koje su već stigle ostaju. Webhook u WooCommerce onda obriši ili isključi.`)) return;
    try { await api('DELETE', '/api/shops', { id: shop.id }); toast('Uklonjeno'); onDone(null); } catch (e2) { setErr(e2.message); }
  };
  return (
    <Sheet title={edit ? 'Uredi: ' + shop.name : 'Novi web shop'} onClose={onClose}
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Ukloni</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon="check" busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Dodaj shop'}</Button>
      </>}>
      <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <div className="grid2">
          <Input label="Naziv" value={f.name} onChange={(v) => set('name', v)} placeholder="Npr. KupiLenovo" disabled={edit} autoFocus={!edit} hint={edit ? undefined : 'Kao u naslovu emaila: [KupiLenovo] Nova narudžba…'} />
          <Input label="Adresa shopa" value={f.url} onChange={(v) => set('url', v)} placeholder="https://kupilenovo.ba" inputMode="url" autoCapitalize="none" autoComplete="off" />
        </div>
        <Input label={edit && shop.api ? 'Consumer key (prazno = ostaje isti)' : 'Consumer key'} value={f.key} onChange={(v) => set('key', v.trim())} placeholder="ck_…" autoCapitalize="none" autoComplete="off" spellCheck={false} />
        <Input label={edit && shop.api ? 'Consumer secret (prazno = ostaje isti)' : 'Consumer secret'} type="password" value={f.secret} onChange={(v) => set('secret', v.trim())} placeholder="cs_…" autoComplete="new-password" spellCheck={false}
          hint="WooCommerce → Postavke → Napredno → REST API, dozvole Čitanje/Pisanje. Bez ključa narudžbe i dalje stižu, samo se status ne mijenja odavde." />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

const RULE_EXAMPLES = [
  { field: 'from', contains: 'noreply, newsletter, no-reply', action: 'ignore', why: 'automatske poruke i reklame' },
  { field: 'from', contains: '@stt.ba', action: 'ostalo', why: 'emailovi kolega; narudžbe iz shopova se svejedno prepoznaju' },
  { field: 'from', contains: '@dobavljac.ba', action: 'ostalo', why: 'dobavljač, ne tiče se prodaje' },
  { field: 'to', contains: 'veleprodaja@', action: 'upit', why: 'sve na adresu veleprodaje je kupac' },
  { field: 'subject', contains: 'ponud, upit, cijen', action: 'upit', why: 'upiti za ponudu' },
];

function EmailSorting() {
  const { data, reload, toast } = useApp();
  const s = data.settings;
  const [rules, setRules] = useState(() => s.emailRules || []);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dirty) setRules(s.emailRules || []); }, [s.emailRules, dirty]);

  const save = async (patch, msg) => {
    setBusy(true);
    try { await api('PATCH', '/api/settings', patch); toast(msg || 'Sačuvano'); if (patch.emailRules) setDirty(false); reload(); }
    catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const change = (i, k, v) => { setRules((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setDirty(true); };
  const add = (r = { field: 'from', contains: '', action: 'ignore' }) => { setRules((rs) => [...rs, { ...r, id: 'n' + Date.now().toString(36) }]); setDirty(true); };
  const del = (i) => { setRules((rs) => rs.filter((_, j) => j !== i)); setDirty(true); };
  const skipped = data.skipped?.length || 0;

  return (
    <Section id="email" title="Email: šta ulazi u prijem">
      <p className="muted">Svi emailovi stižu u Prijem, a ti biraš koje ćeš prihvatiti kao narudžbu ili zadatak. Aplikacija ih samo rasporedi po karticama:</p>
      <ol className="steps">
        <li><strong>Narudžbe iz shopova</strong> („Nova narudžba” od KupiLenovo, KupiTelevizor…) uđu kao web narudžba, s kupcem, stavkama, dostavom i plaćanjem.</li>
        <li><strong>Tvoja pravila</strong> ispod, ako ih napraviš. Prvo koje odgovara odlučuje.</li>
        <li>Ostalo po riječima u emailu: <strong>Narudžbe</strong> (naručujem, narudžba…), <strong>Upiti kupaca</strong> (ponuda, cijena, imate li…) i <strong>Ostalo</strong> (newsletteri, automatski i interni emailovi; za njih nema obavijesti).</li>
      </ol>
      <p className="muted">Kad neki email stavi pod pogrešnu karticu, premjesti ga u prijemu i označi „Zapamti za sve emailove od…”. Iz prijema možeš i „Nikad od ovog pošiljaoca”: takvi idu u Prijem → Preskočeno{skipped ? ' (sada ' + skipped + ')' : ''}, odakle se vraćaju jednim klikom.</p>
      <label className="checkrow">
        <input type="checkbox" checked={s.keepOther === false} disabled={busy} onChange={(e) => save({ keepOther: !e.target.checked }, e.target.checked ? 'Ostalo ide u Preskočeno' : 'Ostalo ide u prijem')} />
        <span>Ne stavljaj „Ostalo” u prijem (newsletteri, automatski i interni emailovi idu odmah u Preskočeno)</span>
      </label>

      <div className="stack" style={{ gap: 8 }}>
        <span className="field-label">Pravila</span>
        {rules.length ? rules.map((r, i) => (
          <div className="rule-row" key={r.id}>
            <select className="select" aria-label="Gdje" value={r.field} onChange={(e) => change(i, 'field', e.target.value)}>
              {Object.entries(RULE_FIELDS).map(([v, l]) => <option key={v} value={v}>{l} sadrži</option>)}
            </select>
            <input className="input" aria-label="Sadrži" value={r.contains} onChange={(e) => change(i, 'contains', e.target.value)} placeholder="npr. @firma.ba, ponud" maxLength={120} />
            <select className="select" aria-label="Onda" value={r.action} onChange={(e) => change(i, 'action', e.target.value)}>
              {Object.entries(RULE_ACTIONS).map(([v, l]) => <option key={v} value={v}>→ {l}</option>)}
            </select>
            <button type="button" className="iconbtn" aria-label="Obriši pravilo" onClick={() => del(i)}><Icon name="trash" size={18} /></button>
          </div>
        )) : <p className="small muted">Još nema pravila. Prijedlozi:</p>}
        {!rules.length ? (
          <div className="stack" style={{ gap: 6 }}>
            {RULE_EXAMPLES.map((x) => (
              <button type="button" key={x.contains} className="rule-example" onClick={() => add(x)}>
                <Icon name="plus" size={16} />
                <span><strong>{RULE_FIELDS[x.field]}</strong> sadrži „{x.contains}” → <strong>{RULE_ACTIONS[x.action]}</strong> <span className="muted">({x.why})</span></span>
              </button>
            ))}
          </div>
        ) : null}
        <p className="small muted">Piši korijen riječi (ponud, narudžb, cijen) da pogodi sve padeže. Više riječi odvoji zarezom. Velika i mala slova i kvačice nisu bitni. Emailovi shopova se uvijek prepoznaju, pa ih pravilo „Ignoriši” ne može izgubiti.</p>
        <div className="row">
          <Button icon="plus" onClick={() => add()}>Dodaj pravilo</Button>
          {dirty ? <Button variant="primary" icon="save" busy={busy} onClick={() => save({ emailRules: rules.filter((r) => r.contains.trim()) }, 'Pravila sačuvana')}>Sačuvaj pravila</Button> : null}
          {dirty ? <Button variant="quiet" onClick={() => { setDirty(false); setRules(s.emailRules || []); }}>Poništi</Button> : null}
        </div>
      </div>
    </Section>
  );
}

function CopyRow({ value }) {
  const { toast } = useApp();
  return (
    <div className="code-box">
      <code>{value}</code>
      <button type="button" className="iconbtn iconbtn-bare" aria-label="Kopiraj" onClick={() => { navigator.clipboard?.writeText(value).then(() => toast('Kopirano'), () => {}); }}><Icon name="copy" size={18} /></button>
    </div>
  );
}

function Status({ on, children }) {
  return on ? <span className="status-ok"><Icon name="ok" size={18} />{children || 'Povezano'}</span> : <span className="status-off"><Icon name="plug" size={18} />Nije podešeno</span>;
}

function Integrations() {
  const { data } = useApp();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const i = data.integrations;
  return (
    <Section id="integracije" title="Integracije">
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">Web shopovi (WooCommerce)</strong><Status on={i.woo}>{data.shops.length === 1 ? '1 shop' : data.shops.length + ' shopa'}</Status></div>
        <p className="small muted">Ključevi i webhookovi za svaki shop su gore, u dijelu Web shopovi.</p>
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">Email (narudžbe i emailovi kupaca)</strong><Status on={i.email} /></div>
        <p className="small muted">Agent iz ureda čita poštu (IMAP) ili je prosljeđuje servis za dolaznu poštu (npr. Postmark). Šta od toga uđe u prijem određuje dio „Email: šta ulazi u prijem” gore. Adresa na koju šalju{i.emailPath ? '' : ' (pojavi se kad se postavi EMAIL_INBOUND_SECRET)'}:</p>
        {i.emailPath ? <CopyRow value={origin + i.emailPath} /> : null}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">EKI EDI agent (zalihe)</strong><Status on={i.agent}>Token postavljen</Status></div>
        <p className="small muted">Program agent/eki_sync.py na računaru u uredu šalje svaki novi CSV. U njegovu konfiguraciju upiši adresu ispod i STOCK_AGENT_TOKEN iz Vercela.</p>
        <CopyRow value={origin} />
        {data.stockLatest ? <p className="small muted">Zadnji izvoz: {data.stockLatest.filename}, {new Date(data.stockLatest.at).toLocaleString('bs-BA')}</p> : null}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">Jutarnji podsjetnik</strong><Status on={i.cron}>Podešen</Status></div>
        <p className="small muted">Svako jutro oko 7 sati: roba koja stiže tog dana ili kasni, rokovi, narudžbe koje treba dopuniti i rezervacije koje ističu. Treba CRON_SECRET u Vercelu (vidi README).</p>
      </div>
    </Section>
  );
}

function StockSettings() {
  const { data, reload, toast } = useApp();
  const s = data.settings;
  const [m, setM] = useState(s.stockMapping);
  const [busy, setBusy] = useState(false);
  const cols = data.stockLatest?.columns || [];
  const save = async (patch, msg) => {
    setBusy(true);
    try { await api('PATCH', '/api/settings', patch); toast(msg || 'Sačuvano'); reload(); } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const colField = (k, label) => cols.length
    ? <Select label={label} value={m[k]} onChange={(v) => setM({ ...m, [k]: v })} options={[{ value: '', label: 'Automatski' }, ...cols.filter(Boolean).map((c) => ({ value: c, label: c }))]} />
    : <Input label={label} value={m[k]} onChange={(v) => setM({ ...m, [k]: v })} placeholder="Automatski" />;
  return (
    <Section id="zalihe" title="Zalihe i web shop">
      <p className="muted">Kolone iz CSV-a prepoznajem sam (Šifra, Naziv, Količina…). Ako skripta koristi druga imena, izaberi ih ovdje. Vrijedi od sljedećeg izvoza.</p>
      <div className="grid3">{colField('key', 'Šifra artikla')}{colField('qty', 'Količina')}{colField('name', 'Naziv')}</div>
      <div><Button icon="save" busy={busy} onClick={() => save({ stockMapping: m }, 'Kolone sačuvane')}>Sačuvaj kolone</Button></div>
      <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%', margin: '4px 0' }} />
      <label className="checkrow">
        <input type="checkbox" checked={!!s.autoAcceptWeb} onChange={(e) => save({ autoAcceptWeb: e.target.checked })} />
        <span>Web narudžbe odmah pretvori u narudžbu (bez prijema)</span>
      </label>
      {s.autoAcceptWeb ? <Select label="Odjel za web narudžbe" value={s.webDept} onChange={(v) => save({ webDept: v })} options={Object.entries(DEPTS).map(([value, label]) => ({ value, label }))} /> : null}
    </Section>
  );
}

function ExportData() {
  return (
    <Section id="izvoz" title="Izvoz podataka">
      <p className="muted">Sve narudžbe, rezervacije, prijem i zalihe u jednoj JSON datoteci. Korisno kao rezerva i za prelazak na novi ERP.</p>
      <div><a className="btn" href="/api/export" download><Icon name="download" />Preuzmi sve podatke</a></div>
    </Section>
  );
}
