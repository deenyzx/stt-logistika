'use client';
// The app shell: side navigation (desktop), app bar + bottom navigation (phone), hash routing, the notification bell.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useData, api } from '@/components/useData.js';
import { Icon, IconButton, Wordmark, Avatar, ToastProvider, useToast, Sheet, cx, useMedia } from '@/components/ui.jsx';
import { can, ROLES, isOpenTask } from '@/lib/constants.js';
import { fmtWhen, todayISO } from '@/lib/format.js';
import Overview from '@/components/Overview.jsx';
import Tasks from '@/components/Tasks.jsx';
import InboxPage from '@/components/InboxPage.jsx';
import Reservations from '@/components/Reservations.jsx';
import Stock from '@/components/Stock.jsx';
import SettingsPage from '@/components/SettingsPage.jsx';

export const NAV = [
  { key: 'pregled', label: 'Pregled', icon: 'home' },
  { key: 'zadaci', label: 'Narudžbe i zadaci', short: 'Zadaci', icon: 'tasks' },
  { key: 'prijem', label: 'Prijem', icon: 'inbox' },
  { key: 'rezervacije', label: 'Rezervacije', icon: 'laptop' },
  { key: 'zalihe', label: 'Zalihe', icon: 'package' },
  { key: 'postavke', label: 'Postavke', icon: 'settings' },
];

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

function parseHash() {
  const [view, ...rest] = decodeURIComponent(window.location.hash.slice(1)).split('/');
  return { view: view || 'pregled', arg: rest.join('/') || null };
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

function Shell() {
  const { data, online, reload, patch } = useData();
  const toast = useToast();
  const [route, setRoute] = useState({ view: 'pregled', arg: null });
  const [theme, setTheme] = useState('light');
  const [bell, setBell] = useState(false);
  const [more, setMore] = useState(false);
  const lastTop = useRef(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute('data-theme') || 'light');
    const on = () => setRoute(parseHash());
    on();
    window.addEventListener('hashchange', on);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'open' && e.data.url) { const u = new URL(e.data.url); window.location.hash = u.hash; }
      });
    }
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const me = data?.me;
  const go = useCallback((view, arg) => {
    const h = '#' + view + (arg ? '/' + arg : '');
    if (window.location.hash !== h) window.location.hash = h;
    else setRoute(parseHash());
    setBell(false);
    setMore(false);
  }, []);

  const setThemeAndSave = (t) => {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('stt_theme', t); } catch {}
  };

  // A new notification while the app is open: a short heads-up at the bottom.
  const notifs = data?.notifications;
  useEffect(() => {
    if (!notifs) return;
    const top = notifs.list[0];
    if (lastTop.current && top && top.id !== lastTop.current && top.at > notifs.lastRead) toast(top.title);
    lastTop.current = top?.id || 'none';
  }, [notifs, toast]);

  const allowed = useMemo(() => NAV.filter((n) => me && can(me.role, n.key)), [me]);
  const view = me && can(me.role, route.view) ? route.view : 'pregled';
  const today = todayISO();

  const counts = useMemo(() => {
    if (!data) return {};
    const latest = data.stock?.[0];
    return {
      zadaci: data.tasks.filter(isOpenTask).length,
      prijem: data.inbox.filter((x) => x.status === 'novo').length,
      rezervacije: data.reservations.filter((r) => r.status === 'aktivna').length,
      zalihe: latest && latest.changes ? latest.changes.filter((c) => !latest.done[c.key]).length : 0,
    };
  }, [data]);

  const openBell = async () => {
    const opening = !bell;
    setBell(opening);
    if (opening && data?.notifications.unread) {
      try { await api('POST', '/api/notifications', { read: true }); } catch {}
      setTimeout(reload, 400);
    }
  };

  const logout = async () => { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login'; };

  if (!data) {
    return (
      <div className="login" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Wordmark size="lg" />
        <p className="login-lead">{online ? 'Učitavam…' : 'Nema veze sa serverom. Pokušavam ponovo…'}</p>
      </div>
    );
  }

  const ctx = { data, me, go, reload, patch, toast, route: { view, arg: route.arg }, today, theme, setTheme: setThemeAndSave, logout, online, counts, openBell, unread: data.notifications.unread };
  const users = data.users;
  const phoneNav = allowed.filter((n) => n.key !== 'postavke');
  const bottom = phoneNav.length > 5 ? [...phoneNav.slice(0, 4), { key: '_more', label: 'Više', icon: 'more' }] : phoneNav;

  return (
    <Ctx.Provider value={ctx}>
      <div className="shell">
        <aside className="side" aria-label="Glavna navigacija">
          <div style={{ padding: '0 12px' }}><Wordmark /></div>
          <nav className="snav">
            {allowed.map((n) => (
              <button key={n.key} type="button" className={cx('snav-item', view === n.key && 'is-on')} aria-current={view === n.key ? 'page' : undefined} onClick={() => go(n.key)}>
                <Icon name={n.icon} size={22} />
                <span>{n.label}</span>
                {n.key === 'prijem' || n.key === 'zalihe' ? (counts[n.key] ? <span className="snav-badge">{counts[n.key]}</span> : null)
                  : counts[n.key] ? <span className="snav-count">{counts[n.key]}</span> : null}
              </button>
            ))}
          </nav>
          <div className="me-chip">
            <Avatar name={me.name} />
            <div className="stack grow">
              <span style={{ fontWeight: 600 }}>{me.name}</span>
              <span className="me-role">{ROLES[me.role]?.short}</span>
            </div>
            <button type="button" className="iconbtn iconbtn-band" aria-label="Odjava" title="Odjava" onClick={logout}><Icon name="logout" /></button>
          </div>
        </aside>

        <div className="main">
          <header className="appbar">
            <div className="grow"><Wordmark /></div>
            <span className={cx('sync', !online && 'is-off')} title={online ? 'Povezano' : 'Nema veze'}><span className="sync-dot" /></span>
            <IconButton icon="bell" label="Obavijesti" tone="band" badge={data.notifications.unread} onClick={openBell} />
            <IconButton icon="settings" label="Postavke" tone="band" onClick={() => go('postavke')} />
          </header>

          {data.store === 'memory' ? (
            <div style={{ padding: '12px 16px 0' }}>
              <div className="note note-danger"><Icon name="alert" /><div><strong>Baza nije povezana.</strong> Podaci se čuvaju samo privremeno na serveru i nisu zajednički. Poveži Upstash Redis u Vercelu (vidi README).</div></div>
            </div>
          ) : null}

          {view === 'pregled' ? <Overview /> : null}
          {view === 'zadaci' ? <Tasks /> : null}
          {view === 'prijem' ? <InboxPage /> : null}
          {view === 'rezervacije' ? <Reservations /> : null}
          {view === 'zalihe' ? <Stock /> : null}
          {view === 'postavke' ? <SettingsPage /> : null}

          <nav className="bnav" aria-label="Navigacija">
            {bottom.map((n) => {
              const on = n.key === '_more' ? !bottom.some((b) => b.key === view) && view !== 'postavke' : view === n.key;
              const badge = n.key === '_more' ? counts.zalihe : n.key === 'prijem' || n.key === 'zalihe' ? counts[n.key] : 0;
              return (
                <button key={n.key} type="button" className={cx('bnav-item', on && 'is-on')} aria-current={on ? 'page' : undefined} onClick={() => (n.key === '_more' ? setMore(true) : go(n.key))}>
                  <span className="bnav-ic"><Icon name={n.icon} size={22} />{badge ? <span className="badge">{badge}</span> : null}</span>
                  <span>{n.short || n.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {bell ? <NotificationsPopover onClose={() => setBell(false)} /> : null}
      {more ? (
        <Sheet title="Više" onClose={() => setMore(false)} flush>
          <div className="rows">
            {phoneNav.slice(4).concat(allowed.filter((n) => n.key === 'postavke')).map((n) => (
              <button key={n.key} type="button" className="rowlink" onClick={() => go(n.key)}>
                <Icon name={n.icon} />
                <span className="rowlink-main"><span className="rowlink-title">{n.label}</span></span>
                {counts[n.key] ? <span className="tag tag-accent">{counts[n.key]}</span> : null}
              </button>
            ))}
          </div>
        </Sheet>
      ) : null}
    </Ctx.Provider>
  );
}

function NotificationsPopover({ onClose }) {
  const { data, go } = useApp();
  const ref = useRef(null);
  const { list } = data.notifications;
  const [lastRead] = useState(data.notifications.lastRead); // as it was when opened, so new ones stay marked
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.('[aria-label^="Obavijesti"]')) onClose(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [onClose]);
  const open = (n) => {
    const [v, ...rest] = String(n.link || '').split('/');
    if (v) go(v, rest.join('/') || null);
    onClose();
  };
  return (
    <div className="npop" ref={ref} role="dialog" aria-label="Obavijesti">
      <div className="card-head"><h2 className="h-heading">Obavijesti</h2><button type="button" className="iconbtn iconbtn-bare" aria-label="Zatvori" onClick={onClose}><Icon name="close" /></button></div>
      {list.length === 0 ? <p className="muted" style={{ padding: 20 }}>Još nema obavijesti.</p> : null}
      {list.map((n) => (
        <button key={n.id} type="button" className={cx('nitem', n.at > lastRead && 'is-new')} onClick={() => open(n)}>
          <span className="ndot" />
          <span className="stack grow" style={{ gap: 2 }}>
            <span style={{ fontWeight: n.at > lastRead ? 600 : 400, fontSize: 15, lineHeight: '21px' }}>{n.title}</span>
            {n.body ? <span className="small muted">{n.body}</span> : null}
            <span className="small muted">{fmtWhen(n.at)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------- page header used by every screen (holds the bell on desktop) ---------- */
export function PageHead({ eyebrow, title, lead, children }) {
  const { openBell, unread } = useApp();
  const wide = useMedia('(min-width: 960px)');
  return (
    <header className="page-head">
      <div className="stack" style={{ gap: 6 }}>
        {eyebrow ? <span className="label muted">{eyebrow}</span> : null}
        <h1 className="h-display">{title}</h1>
        {lead ? <p className="muted">{lead}</p> : null}
      </div>
      <div className="page-tools">
        {children}
        {wide ? <IconButton icon="bell" label="Obavijesti" badge={unread} onClick={openBell} /> : null}
      </div>
    </header>
  );
}

export function userName(users, id) {
  return users.find((u) => u.id === id)?.name || '';
}
