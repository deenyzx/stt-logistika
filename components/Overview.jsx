'use client';
// Pregled: today's numbers on the black band, what needs attention, the inbox and the latest notifications.
import { useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { Icon, Button, StatusTag, SourceChip, ResTag, Empty, cx } from '@/components/ui.jsx';
import { TaskForm } from '@/components/Tasks.jsx';
import { ReservationForm } from '@/components/Reservations.jsx';
import { InboxActions } from '@/components/InboxPage.jsx';
import { can, isOpenTask, SOURCES, PAYMENT } from '@/lib/constants.js';
import { fmtDue, fmtDate, fmtWhen, daysFromToday, fold, todayISO, TZ } from '@/lib/format.js';

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

// Most urgent first: late, due today/tomorrow, blocked on the invoice, new.
function urgency(t) {
  const d = t.due ? daysFromToday(t.due) : 99;
  let s = 0;
  if (d < 0) s += 100;
  else if (d <= 1) s += 60;
  else if (d <= 3) s += 30;
  if (t.status === 'ceka_kalkulaciju' || t.status === 'za_fakturu') s += 40;
  if (t.status === 'nova') s += 35;
  if (t.status === 'ceka_robu') s += 10;
  return s;
}

export default function Overview() {
  const { data, me, go, online, today } = useApp();
  const [q, setQ] = useState('');
  const [newTask, setNewTask] = useState(false);
  const [newRes, setNewRes] = useState(false);
  const canTasks = can(me.role, 'zadaci');
  const canInbox = can(me.role, 'prijem');
  const canRes = can(me.role, 'rezervacije');

  const open = data.tasks.filter(isOpenTask);
  const byStatus = (s) => open.filter((t) => t.status === s);
  const waiting = byStatus('ceka_robu');
  const oldestWait = waiting.length ? Math.max(...waiting.map((t) => Math.floor((Date.now() - (t.statusAt || t.createdAt)) / 86400000))) : 0;
  const calc = byStatus('ceka_kalkulaciju');
  const activeRes = data.reservations.filter((r) => r.status === 'aktivna');
  const expiring = activeRes.filter((r) => r.until && daysFromToday(r.until) <= 1).sort((a, b) => (a.until < b.until ? -1 : 1));
  const newToday = open.filter((t) => todayISO(t.createdAt) === today).length;
  const attention = [...open].sort((a, b) => urgency(b) - urgency(a) || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
  const inbox = data.inbox.filter((x) => x.status === 'novo');

  const results = useMemo(() => {
    const f = fold(q);
    if (f.length < 2) return null;
    const hit = (...xs) => xs.some((x) => fold(x).includes(f));
    return [
      ...data.tasks.filter((t) => hit(t.number, t.title, t.customer?.name, t.customer?.contact, t.note, ...(t.items || []).flatMap((i) => [i.code, i.name]))).map((t) => ({ kind: 'zadaci', id: t.id, num: t.number, title: t.title, meta: t.customer?.name })),
      ...data.reservations.filter((r) => hit(r.number, r.model, r.code, r.customer?.name, r.customer?.phone, r.purpose)).map((r) => ({ kind: 'rezervacije', id: r.id, num: r.number, title: r.model, meta: r.customer?.name })),
      ...data.inbox.filter((x) => hit(x.title, x.from?.name, x.from?.email, x.body)).map((x) => ({ kind: 'prijem', id: x.id, num: x.source === 'web' ? 'WEB' : 'EMAIL', title: x.title, meta: x.from?.name || x.from?.email })),
    ].slice(0, 12);
  }, [q, data]);

  return (
    <main className="page">
      <PageHead eyebrow={eyebrow()} title={`${greeting()}, ${me.name.split(' ')[0]}`}>
        <label className="search page-search">
          <Icon name="search" size={18} />
          <span className="sr">Pretraga</span>
          <input className="input" type="search" placeholder="Traži kupca, broj, šifru" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {me.role === 'maloprodaja' && canRes ? <Button variant="primary" icon="plus" onClick={() => setNewRes(true)}>Nova rezervacija</Button>
          : canTasks ? <Button variant="primary" icon="plus" onClick={() => setNewTask(true)}>Nova narudžba</Button> : null}
      </PageHead>

      {results ? (
        <section className="card" aria-label="Rezultati pretrage">
          <div className="card-head"><h2 className="h-heading">Rezultati · {results.length}</h2><button type="button" className="btn btn-quiet btn-sm" onClick={() => setQ('')}>Očisti</button></div>
          {results.length === 0 ? <p className="muted" style={{ padding: 20 }}>Ništa nije pronađeno.</p> : (
            <div className="rows">
              {results.map((r) => (
                <button key={r.kind + r.id} type="button" className="rowlink" onClick={() => go(r.kind, r.id)}>
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
          {canTasks ? (
            <>
              <button type="button" className="stat" onClick={() => go('zadaci')}>
                <span className="stat-label">Otvorene narudžbe</span>
                <span className="stat-value">{open.length}</span>
                <span className="stat-hint">{newToday ? `${newToday} ${newToday === 1 ? 'nova' : 'novih'} danas` : 'Nema novih danas'}</span>
              </button>
              <button type="button" className="stat" onClick={() => go('zadaci', '~ceka_robu')}>
                <span className="stat-label">Čeka robu</span>
                <span className="stat-value">{waiting.length}</span>
                <span className="stat-hint">{!waiting.length ? 'Ništa ne čeka' : oldestWait === 0 ? 'Sve od danas' : `Najstarija čeka ${oldestWait} ${oldestWait === 1 ? 'dan' : 'dana'}`}</span>
              </button>
              <button type="button" className={cx('stat', calc.length && 'stat-accent')} onClick={() => go('zadaci', '~ceka_kalkulaciju')}>
                <span className="stat-label">Čeka ulaznu kalkulaciju</span>
                <span className="stat-value">{calc.length}</span>
                <span className="stat-hint">{calc.length ? 'Roba stigla, faktura čeka' : 'Ništa ne čeka'}</span>
              </button>
            </>
          ) : null}
          {canRes ? (
            <button type="button" className="stat" onClick={() => go('rezervacije')}>
              <span className="stat-label">Aktivne rezervacije</span>
              <span className="stat-value">{activeRes.length}</span>
              <span className="stat-hint">{expiring.length ? `${expiring.length} ističe danas ili sutra` : 'Nijedna ne ističe uskoro'}</span>
            </button>
          ) : null}
        </div>
      </section>

      <div className="cols">
        <div className="stack" style={{ gap: 24 }}>
          {canTasks ? (
            <section className="card" aria-label="Traži pažnju">
              <div className="card-head">
                <h2 className="h-heading">Traži pažnju</h2>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => go('zadaci')}>Sve narudžbe<Icon name="arrow" size={16} /></button>
              </div>
              {attention.length === 0 ? <Empty>Nema otvorenih narudžbi ni zadataka.</Empty> : (
                <div className="rows">
                  {attention.map((t) => {
                    const late = t.due && daysFromToday(t.due) < 0;
                    return (
                      <button key={t.id} type="button" className="rowlink" onClick={() => go('zadaci', t.id)}>
                        <span className="rowlink-main">
                          <span className="row"><span className="num-label">{t.number}</span><StatusTag status={t.status} short /></span>
                          <span className="rowlink-title">{t.title}</span>
                          <span className="rowlink-meta">{[t.customer?.name, SOURCES[t.source]?.label, t.assignee ? 'Dodijeljeno: ' + (data.users.find((u) => u.id === t.assignee)?.name || '?') : 'Nije dodijeljeno'].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="rowlink-side">
                          {t.due ? <span className={late ? 'is-late' : undefined}>{late ? 'Kasni · ' : 'Rok '}{fmtDue(t.due)}</span> : null}
                          <span className="cc"><Icon name="chat" size={16} />{t.comments?.length || 0}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          ) : null}

          {canRes && (me.role === 'maloprodaja' || expiring.length) ? (
            <section className="card" aria-label="Rezervacije">
              <div className="card-head">
                <h2 className="h-heading">{expiring.length ? 'Rezervacije koje ističu' : 'Rezervacije'}</h2>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => go('rezervacije')}>Sve rezervacije<Icon name="arrow" size={16} /></button>
              </div>
              {(expiring.length ? expiring : activeRes.slice(0, 5)).length === 0 ? <Empty>Nema aktivnih rezervacija.</Empty> : (
                <div className="rows">
                  {(expiring.length ? expiring : activeRes.slice(0, 5)).map((r) => (
                    <button key={r.id} type="button" className="rowlink" onClick={() => go('rezervacije', r.id)}>
                      <span className="rowlink-main">
                        <span className="row"><span className="num-label">{r.number}</span><ResTag r={r} today={today} /></span>
                        <span className="rowlink-title">{r.model}{r.qty > 1 ? ' ×' + r.qty : ''}</span>
                        <span className="rowlink-meta">{[r.customer?.name, PAYMENT[r.payment], r.createdBy?.name].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="rowlink-side">{r.until ? 'do ' + fmtDue(r.until) : null}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>

        <aside className="stack" style={{ gap: 16 }}>
          {canInbox ? (
            <section className="card" aria-label="Prijem">
              <div className="card-head"><h2 className="h-heading">Prijem</h2><span className="small muted">Web shop i email</span></div>
              {inbox.length === 0 ? <p className="muted small" style={{ padding: '16px 20px' }}>Ništa ne čeka. Nove web narudžbe i emailovi stižu ovdje.</p> : (
                <div className="rows">
                  {inbox.slice(0, 3).map((x) => (
                    <div key={x.id} className="stack" style={{ gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
                      <div className="row small muted"><Icon name={x.source === 'web' ? 'globe' : 'mail'} size={16} /><span className="grow">{x.source === 'web' ? 'Web shop' + (x.order?.number ? ' #' + x.order.number : '') : x.from?.email || x.from?.name}</span><span>{fmtWhen(x.receivedAt)}</span></div>
                      <button type="button" className="rowlink-title" style={{ all: 'unset', cursor: 'pointer', fontWeight: 600 }} onClick={() => go('prijem', x.id)}>{x.title}</button>
                      <InboxActions item={x} compact />
                    </div>
                  ))}
                  {inbox.length > 3 ? <div className="card-foot"><button type="button" className="btn btn-quiet" onClick={() => go('prijem')}>Još {inbox.length - 3} u prijemu</button></div> : null}
                </div>
              )}
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
                      <span className="small muted">{fmtWhen(n.at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>

      {newTask ? <TaskForm onClose={() => setNewTask(false)} /> : null}
      {newRes ? <ReservationForm onClose={() => setNewRes(false)} /> : null}
    </main>
  );
}
