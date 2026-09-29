'use client';
// Postavke: your account, theme, push on this device; for the admin also users, integrations, stock columns, export.
import { useEffect, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Input, Select, Sheet, Tag, Note, Avatar } from '@/components/ui.jsx';
import { ROLES, DEPTS } from '@/lib/constants.js';

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
      {me.role === 'admin' ? <><Users /><Integrations /><StockSettings /><ExportData /></> : null}
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
          <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={f.disabled} onChange={(e) => set('disabled', e.target.checked)} style={{ width: 22, height: 22 }} />
            Isključi nalog (ne može se prijaviti)
          </label>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
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
        <div className="row"><strong className="grow">WooCommerce (web shop)</strong><Status on={i.woo} /></div>
        <p className="small muted">U WordPressu: WooCommerce → Postavke → Napredno → Webhooks → Dodaj webhook. Tema „Narudžba kreirana”, verzija API v3, tajna = WOO_WEBHOOK_SECRET iz Vercela, adresa:</p>
        <CopyRow value={origin + '/api/integrations/woocommerce'} />
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">Email narudžbe</strong><Status on={i.email} /></div>
        <p className="small muted">Emailovi se prosljeđuju servisu za dolaznu poštu (npr. Postmark) ili ih šalje agent iz ureda (IMAP). Adresa na koju šalju{i.emailPath ? '' : ' (pojavi se kad se postavi EMAIL_INBOUND_SECRET)'}:</p>
        {i.emailPath ? <CopyRow value={origin + i.emailPath} /> : null}
      </div>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row"><strong className="grow">EKI EDI agent (zalihe)</strong><Status on={i.agent}>Token postavljen</Status></div>
        <p className="small muted">Program agent/eki_sync.py na računaru u uredu šalje svaki novi CSV. U njegovu konfiguraciju upiši adresu ispod i STOCK_AGENT_TOKEN iz Vercela.</p>
        <CopyRow value={origin} />
        {data.stockLatest ? <p className="small muted">Zadnji izvoz: {data.stockLatest.filename}, {new Date(data.stockLatest.at).toLocaleString('bs-BA')}</p> : null}
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
      <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={!!s.autoAcceptWeb} onChange={(e) => save({ autoAcceptWeb: e.target.checked })} style={{ width: 22, height: 22 }} />
        <span className="grow">Web narudžbe odmah pretvori u zadatak (bez prijema)</span>
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
