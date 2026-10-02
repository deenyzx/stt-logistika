'use client';
// Moje obaveze: everything waiting on this person from every part of the app in one list (prijenosnice to answer,
// ship or receive, upiti to answer or close, reservations to confirm, new web orders and emails, their tasks),
// today's numbers, goods arriving, search, and the latest notifications.
import { useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { Icon, Button, Tag, Empty, Sheet, cx } from '@/components/ui.jsx';
import { TaskForm, QuickOrderForm } from '@/components/Tasks.jsx';
import { ReservationForm } from '@/components/Reservations.jsx';
import { TransferForm, RouteStrip } from '@/components/Transfers.jsx';
import { RequestForm } from '@/components/Requests.jsx';
import { can, isOpenTask, TRANSFER_DONE } from '@/lib/constants.js';
import { obligationsFor, countByKind, OBLIGATION_KINDS } from '@/lib/obligations.js';
import { fmtDate, fmtWhen, daysFromToday, fold, dayLabel, addDaysISO, TZ } from '@/lib/format.js';

const DAYS = ['NEDJELJA', 'PONEDJELJAK', 'UTORAK', 'SRIJEDA', 'ČETVRTAK', 'PETAK', 'SUBOTA'];

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h < 11 ? 'Dobro jutro' : h < 18 ? 'Dobar dan' : 'Dobro veče';
}

function eyebrow() {
  const d = new Date();
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(d);
  const idx = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  return `${DAYS[idx]}, ${fmtDate(d.getTime())}`;
}

const NEW_OPTIONS = [
  { key: 'prijenosnica', area: 'prijenosnice', icon: 'truck', label: 'Prijenosnica', hint: 'Roba iz jednog skladišta u drugo' },
  { key: 'upit', area: 'upiti', icon: 'chat', label: 'Upit MP', hint: 'Pitaj veleprodaju za cijenu, dostupnost, rok' },
  { key: 'rezervacija', area: 'rezervacije', icon: 'laptop', label: 'Rezervacija', hint: 'Laptop ili druga roba za kupca' },
  { key: 'narudzba', area: 'zadaci', icon: 'cart', label: 'Narudžba ili zadatak', hint: 'Sa svim podacima: kupac, stavke, rokovi' },
  { key: 'brzi', area: 'zadaci', icon: 'quick', label: 'Brzi unos', hint: 'Telefonom ili lično, dopuniš kasnije' },
];

export default function Overview() {
  const { data, me, go, online, today } = useApp();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('sve');
  const [chooser, setChooser] = useState(false);
  const [form, setForm] = useState(null);

  const obligations = useMemo(() => obligationsFor(data, me), [data, me]);
  const byKind = countByKind(obligations);
  const shown = kind === 'sve' ? obligations : obligations.filter((o) => o.kind === kind);
  const groups = useMemo(() => {
    const out = [];
    const urgent = shown.filter((o) => o.urgent);
    if (urgent.length) out.push({ key: 'hitno', label: 'Kasni', items: urgent, tone: 'danger' });
    const m = new Map();
    for (const o of shown.filter((x) => !x.urgent)) { if (!m.has(o.date)) m.set(o.date, []); m.get(o.date).push(o); }
    for (const [date, items] of m) out.push({ key: date, label: dayLabel(date), items, tone: date === today ? 'today' : date === addDaysISO(today, -1) ? 'yesterday' : null });
    return out;
  }, [shown, today]);

  const openTasks = data.tasks.filter(isOpenTask);
  const trOpen = data.transfers.filter((t) => !TRANSFER_DONE.includes(t.status));
  const trOnWay = trOpen.filter((t) => t.status === 'na_putu').length;
  const rqWaiting = data.requests.filter((r) => r.status === 'novi').length;
  const resWaiting = data.reservations.filter((r) => r.status === 'ceka_vp').length;
  const resActive = data.reservations.filter((r) => r.status === 'aktivna').length;
  const arriving = openTasks.filter((t) => t.expectedAt && daysFromToday(t.expectedAt) <= 14 && daysFromToday(t.expectedAt) > 0).sort((a, b) => (a.expectedAt < b.expectedAt ? -1 : 1));

  const results = useMemo(() => {
    const f = fold(q);
    if (f.length < 2) return null;
    const hit = (...xs) => xs.some((x) => fold(x).includes(f));
    return [
      ...data.transfers.filter((t) => hit(t.number, t.from.name, t.to.name, t.note, ...t.items.flatMap((l) => [l.code, l.name]))).map((t) => ({ view: 'prijenosnice', id: t.id, num: t.number, title: t.items.map((l) => l.name || l.code).join(', '), meta: `${t.from.name} → ${t.to.name}` })),
      ...data.requests.filter((r) => hit(r.number, r.name, r.code, r.pn, r.customer, r.question, r.answer)).map((r) => ({ view: 'upiti', id: r.id, num: r.number, title: r.name || r.code || r.question, meta: r.customer })),
      ...data.tasks.filter((t) => hit(t.number, t.title, t.customer?.name, t.customer?.contact, t.note, ...(t.items || []).flatMap((i) => [i.code, i.name]))).map((t) => ({ view: 'zadaci', id: t.id, num: t.number, title: t.title, meta: t.customer?.name })),
      ...data.reservations.filter((r) => hit(r.number, r.model, r.code, r.customer?.name, r.customer?.phone, r.purpose)).map((r) => ({ view: 'rezervacije', id: r.id, num: r.number, title: r.model, meta: r.customer?.name })),
      ...data.inbox.filter((x) => hit(x.title, x.from?.name, x.from?.email, x.body)).map((x) => ({ view: 'prijem', id: x.id, num: x.source === 'web' ? 'WEB' : 'EMAIL', title: x.title, meta: x.from?.name || x.from?.email })),
    ].slice(0, 15);
  }, [q, data]);

  const options = NEW_OPTIONS.filter((o) => can(me.role, o.area));
  const chips = [{ value: 'sve', label: 'Sve', count: obligations.length }, ...Object.entries(OBLIGATION_KINDS).filter(([k]) => byKind[k]).map(([k, v]) => ({ value: k, label: v.plural, count: byKind[k] }))];

  return (
    <main className="page">
      <PageHead eyebrow={eyebrow()} title={`${greeting()}, ${me.name.split(' ')[0]}`}>
        <label className="search page-search">
          <Icon name="search" size={18} />
          <span className="sr">Pretraga</span>
          <input className="input" type="search" placeholder="Traži broj, šifru, kupca" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Button variant="primary" icon="plus" onClick={() => setChooser(true)}>Dodaj</Button>
      </PageHead>

      {results ? (
        <section className="card" aria-label="Rezultati pretrage">
          <div className="card-head"><h2 className="h-heading">Rezultati · {results.length}</h2><button type="button" className="btn btn-quiet btn-sm" onClick={() => setQ('')}>Očisti</button></div>
          {results.length === 0 ? <p className="muted" style={{ padding: 20 }}>Ništa nije pronađeno.</p> : (
            <div className="rows">
              {results.map((r) => (
                <button key={r.view + r.id} type="button" className="rowlink" onClick={() => go(r.view, r.id)}>
                  <span className="rowlink-main">
                    <span className="num-label">{r.num}</span>
                    <span className="rowlink-title">{r.title}</span>
                    {r.meta ? <span className="rowlink-meta">{r.meta}</span> : null}
                  </span>
                  <Icon name="next" />
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="hero" aria-label="Stanje danas">
        <div className="hero-head">
          <h2 className="h-heading">Stanje danas</h2>
          <span className={cx('sync', !online && 'is-off')}><span className="sync-dot" />{online ? `Osvježeno ${fmtWhen(data.loadedAt)}` : 'Nema veze, pokušavam ponovo'}</span>
        </div>
        <div className="stats">
          <button type="button" className={cx('stat', obligations.length && 'stat-accent')} onClick={() => setKind('sve')}>
            <span className="stat-label">Moje obaveze</span>
            <span className="stat-value">{obligations.length}</span>
            <span className="stat-hint">{obligations.filter((o) => o.urgent).length ? `${obligations.filter((o) => o.urgent).length} kasni` : obligations.length ? 'Ništa ne kasni' : 'Sve je urađeno'}</span>
          </button>
          {can(me.role, 'prijenosnice') ? (
            <button type="button" className="stat" onClick={() => go('prijenosnice')}>
              <span className="stat-label">Prijenosnice u toku</span>
              <span className="stat-value">{trOpen.length}</span>
              <span className="stat-hint">{trOnWay ? `${trOnWay} na putu` : 'Ništa nije na putu'}</span>
            </button>
          ) : null}
          {can(me.role, 'upiti') ? (
            <button type="button" className="stat" onClick={() => go('upiti')}>
              <span className="stat-label">Upiti bez odgovora</span>
              <span className="stat-value">{rqWaiting}</span>
              <span className="stat-hint">{data.requests.filter((r) => r.status === 'dostupno' || r.status === 'nije_dostupno').length} odgovoreno, nije zatvoreno</span>
            </button>
          ) : null}
          {can(me.role, 'zadaci') ? (
            <button type="button" className="stat" onClick={() => go('zadaci')}>
              <span className="stat-label">Otvorene narudžbe</span>
              <span className="stat-value">{openTasks.length}</span>
              <span className="stat-hint">{openTasks.filter((t) => t.status === 'ceka_robu').length} čeka robu · {openTasks.filter((t) => t.status === 'ceka_kalkulaciju').length} kalkulacija</span>
            </button>
          ) : null}
          {can(me.role, 'rezervacije') ? (
            <button type="button" className="stat" onClick={() => go('rezervacije')}>
              <span className="stat-label">Rezervacije</span>
              <span className="stat-value">{resActive}</span>
              <span className="stat-hint">{resWaiting ? `${resWaiting} čeka potvrdu VP` : 'Aktivne'}</span>
            </button>
          ) : null}
        </div>
      </section>

      <div className="cols">
        <section className="card" aria-label="Moje obaveze">
          <div className="card-head">
            <h2 className="h-heading">Moje obaveze</h2>
            <span className="small muted">Šta čeka tebe, iz svih dijelova</span>
          </div>
          {obligations.length ? (
            <div className="ob-chips" role="group" aria-label="Vrsta">
              {chips.map((c) => (
                <button key={c.value} type="button" className={cx('chip', kind === c.value && 'is-on')} aria-pressed={kind === c.value} onClick={() => setKind(c.value)}>
                  {c.label}<span className="seg-count">{c.count}</span>
                </button>
              ))}
            </div>
          ) : null}
          {shown.length === 0 ? <Empty>{obligations.length ? 'Ovdje nema ništa.' : 'Ništa ne čeka tebe. Kad stigne prijenosnica, upit, rezervacija ili narudžba, pojavi se ovdje.'}</Empty> : null}
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className={cx('ob-group label', g.tone && 'is-' + g.tone)}>{g.label} · {g.items.length}</h3>
              <div className="rows">
                {g.items.map((o) => <ObligationRow key={o.key} o={o} onOpen={() => go(o.view, o.id)} />)}
              </div>
            </div>
          ))}
        </section>

        <aside className="stack" style={{ gap: 16 }}>
          {can(me.role, 'zadaci') && arriving.length ? (
            <section className="card" aria-label="Roba stiže">
              <div className="card-head">
                <h2 className="h-heading">Roba stiže</h2>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => go('zadaci', '~stize')}>Sve<Icon name="arrow" size={16} /></button>
              </div>
              <div className="rows">
                {arriving.slice(0, 5).map((t) => (
                  <button key={t.id} type="button" className="rowlink" onClick={() => go('zadaci', t.id)}>
                    <span className="rowlink-main">
                      <span className="num-label">{t.number}</span>
                      <span className="rowlink-title">{t.title}</span>
                    </span>
                    <span className="rowlink-side"><strong>{daysFromToday(t.expectedAt) === 1 ? 'Sutra' : fmtDate(t.expectedAt)}</strong></span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card" aria-label="Obavijesti">
            <div className="card-head"><h2 className="h-heading">Obavijesti</h2></div>
            {data.notifications.list.length === 0 ? <p className="muted small" style={{ padding: '16px 20px' }}>Još nema obavijesti.</p> : (
              <div className="rows">
                {data.notifications.list.slice(0, 6).map((n) => (
                  <button key={n.id} type="button" className={cx('nitem', n.at > data.notifications.lastRead && 'is-new')} onClick={() => { const [v, ...r] = String(n.link).split('/'); if (v) go(v, r.join('/')); }}>
                    <span className="ndot" />
                    <span className="stack grow" style={{ gap: 2 }}>
                      <span className="small" style={{ fontWeight: 600 }}>{n.title}</span>
                      {n.body ? <span className="small muted nbody nbody-2">{n.body}</span> : null}
                      <span className="small muted">{fmtWhen(n.at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {chooser ? (
        <Sheet title="Dodaj" onClose={() => setChooser(false)} flush>
          <div className="rows">
            {options.map((o) => (
              <button key={o.key} type="button" className="rowlink" onClick={() => { setChooser(false); setForm(o.key); }}>
                <Icon name={o.icon} size={22} />
                <span className="rowlink-main">
                  <span className="rowlink-title">{o.label}</span>
                  <span className="rowlink-meta">{o.hint}</span>
                </span>
                <Icon name="next" />
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
      {form === 'prijenosnica' ? <TransferForm onClose={() => setForm(null)} /> : null}
      {form === 'upit' ? <RequestForm onClose={() => setForm(null)} /> : null}
      {form === 'rezervacija' ? <ReservationForm onClose={() => setForm(null)} /> : null}
      {form === 'narudzba' ? <TaskForm onClose={() => setForm(null)} /> : null}
      {form === 'brzi' ? <QuickOrderForm onClose={() => setForm(null)} /> : null}
    </main>
  );
}

function ObligationRow({ o, onOpen }) {
  const k = OBLIGATION_KINDS[o.kind];
  return (
    <button type="button" className={cx('rowlink ob-row', o.urgent && 'is-urgent')} onClick={onOpen}>
      <span className="ob-ic" aria-hidden="true"><Icon name={k.icon} size={20} /></span>
      <span className="rowlink-main">
        <span className="row" style={{ gap: 6 }}>
          <span className="label muted">{k.label}</span>
          <span className="num-label">{o.number}</span>
        </span>
        <span className="rowlink-title">{o.title}</span>
        {o.route ? <RouteStrip from={{ name: o.route.from }} to={{ name: o.route.to }} /> : null}
        {o.sub ? <span className="rowlink-meta nbody nbody-2">{o.sub}</span> : null}
        <span className="row" style={{ gap: 6 }}>
          {o.actions.map((a) => <Tag key={a.text} tone={a.tone}>{a.text}</Tag>)}
        </span>
      </span>
      <Icon name="next" />
    </button>
  );
}
