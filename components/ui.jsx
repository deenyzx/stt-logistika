'use client';
// Shared UI pieces in the Bosning Plan style: buttons, fields, tags, the sheet, comments, toasts.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import {
  House, ListChecks, Inbox, Laptop, Package, Settings, Bell, Plus, Search, MessageCircle, Mail, Phone, Globe, User, Users,
  Clock, Check, Truck, Calculator, Wallet, Upload, ArrowUp, ArrowDown, ArrowRight, ChevronLeft, ChevronRight, X, Trash2,
  LogOut, Sun, Moon, Store, Hourglass, CircleCheck, CircleAlert, Info, Send, FileText, Pencil, Ellipsis, Lock, KeyRound,
  RefreshCw, CloudOff, CirclePlus, Ban, Undo2, Link as LinkIcon, Copy, ExternalLink, Calendar, Minus, Download, Receipt,
  Building2, History, Save, CheckCheck, Archive, BellOff, Smartphone, Plug,
} from 'lucide-react';
import { initials, fmtWhen } from '@/lib/format.js';
import { TASK_STATUS, RES_STATUS, SOURCES } from '@/lib/constants.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

const ICONS = {
  home: House, tasks: ListChecks, inbox: Inbox, laptop: Laptop, package: Package, settings: Settings, bell: Bell, plus: Plus,
  search: Search, chat: MessageCircle, mail: Mail, phone: Phone, globe: Globe, user: User, users: Users, clock: Clock,
  check: Check, truck: Truck, calculator: Calculator, wallet: Wallet, upload: Upload, up: ArrowUp, down: ArrowDown,
  arrow: ArrowRight, back: ChevronLeft, next: ChevronRight, close: X, trash: Trash2, logout: LogOut, sun: Sun, moon: Moon,
  store: Store, hourglass: Hourglass, ok: CircleCheck, alert: CircleAlert, info: Info, send: Send, file: FileText,
  edit: Pencil, more: Ellipsis, lock: Lock, key: KeyRound, sync: RefreshCw, offline: CloudOff, new: CirclePlus, ban: Ban,
  undo: Undo2, link: LinkIcon, copy: Copy, external: ExternalLink, calendar: Calendar, minus: Minus, download: Download,
  receipt: Receipt, building: Building2, history: History, save: Save, checkall: CheckCheck, archive: Archive,
  belloff: BellOff, phonebig: Smartphone, plug: Plug,
};

export function Icon({ name, size = 20, className, label, strokeWidth = 2 }) {
  const C = ICONS[name] || Info;
  return <C size={size} strokeWidth={strokeWidth} className={cx('ic', className)} aria-hidden={label ? undefined : true} aria-label={label} role={label ? 'img' : undefined} />;
}

export function Wordmark({ size }) {
  return (
    <span className={cx('wordmark', size === 'lg' && 'wordmark-lg')}>
      <span className="wordmark-name">STT</span>
      <span className="wordmark-sub">LOGISTIKA</span>
    </span>
  );
}

export function Button({ variant, size, icon, iconAfter, block, className, children, type = 'button', busy, ...rest }) {
  return (
    <button type={type} {...rest} disabled={rest.disabled || busy}
      className={cx('btn', variant && 'btn-' + variant, size && 'btn-' + size, block && 'btn-block', className)}>
      {busy ? <Icon name="sync" size={18} className="spin" /> : icon ? <Icon name={icon} size={size === 'sm' ? 16 : 20} /> : null}
      {children != null ? <span>{children}</span> : null}
      {iconAfter ? <Icon name={iconAfter} size={18} /> : null}
    </button>
  );
}

export function IconButton({ icon, label, onClick, className, badge, tone, ...rest }) {
  return (
    <button type="button" className={cx('iconbtn', tone && 'iconbtn-' + tone, className)} aria-label={label + (badge ? `, ${badge} novih` : '')} title={label} onClick={onClick} {...rest}>
      <Icon name={icon} size={20} />
      {badge ? <span className="badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx('seg-opt', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count != null ? <span className="seg-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Chips({ options, value, onChange, grid, label }) {
  return (
    <div className={grid ? 'chips-grid' : 'chips'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} className={cx('chip', o.value === value && 'is-on')} onClick={() => onChange(o.value)}>
          {o.value === value && grid ? <Icon name="check" size={18} strokeWidth={3} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tag({ tone = 'plain', icon, children }) {
  return (
    <span className={cx('tag', 'tag-' + tone)}>
      {icon ? <Icon name={icon} size={14} strokeWidth={icon === 'check' ? 3 : 2} /> : null}
      {children}
    </span>
  );
}

export function StatusTag({ status, short }) {
  const s = TASK_STATUS[status];
  if (!s) return null;
  return <Tag tone={s.tone} icon={s.icon}>{short && s.short ? s.short : s.label}</Tag>;
}

export function ResTag({ r, today }) {
  if (r.status === 'aktivna' && r.until && today) {
    if (r.until < today) return <Tag tone="danger" icon="alert">Istekla</Tag>;
    const d = Math.round((Date.parse(r.until) - Date.parse(today)) / 86400000);
    if (d === 0) return <Tag tone="wait" icon="hourglass">Ističe danas</Tag>;
    if (d === 1) return <Tag tone="wait" icon="hourglass">Ističe sutra</Tag>;
  }
  const s = RES_STATUS[r.status];
  return s ? <Tag tone={s.tone} icon={s.icon}>{s.label}</Tag> : null;
}

export function SourceChip({ source }) {
  const s = SOURCES[source];
  if (!s) return null;
  return <span className="src"><Icon name={s.icon} size={14} />{s.label}</span>;
}

export function Avatar({ name, me, small }) {
  return <span className={cx('ava', small && 'ava-sm', me && 'is-me')} aria-hidden="true">{initials(name)}</span>;
}

export function Note({ tone, icon = 'info', children }) {
  return <div className={cx('note', tone && 'note-' + tone)}><Icon name={icon} size={20} /><div>{children}</div></div>;
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

/* ---------- fields ---------- */
export function Field({ label, hint, error, children, id }) {
  return (
    <div className="field">
      {label ? <label className="field-label" htmlFor={id}>{label}</label> : null}
      {children}
      {error ? <p className="field-error"><Icon name="alert" size={16} />{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function Input({ label, hint, error, value, onChange, className, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <input id={id} className={cx('input', className)} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Textarea({ label, hint, value, onChange, rows = 3, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <textarea id={id} className="textarea" rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </Field>
  );
}

export function Select({ label, hint, value, onChange, options, ...rest }) {
  const id = useId();
  return (
    <Field label={label} hint={hint} id={id}>
      <select id={id} className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function CheckBox({ checked, onChange, label }) {
  return (
    <button type="button" role="checkbox" aria-checked={!!checked} aria-label={label} className="check" onClick={() => onChange(!checked)}>
      <span className="check-box">{checked ? <Icon name="check" size={18} strokeWidth={3} /> : null}</span>
    </button>
  );
}

/* ---------- sheet: a dialog that slides up on phones and sits centred on desktop ---------- */
export function Sheet({ title, onClose, children, footer, wide, flush }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    const first = ref.current?.querySelector('input, textarea, select, button:not(.sheet-x)');
    (first || ref.current)?.focus?.();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cx('sheet', wide && 'sheet-wide')} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet-head">
          <h2 className="h-heading grow">{title}</h2>
          <button type="button" className="iconbtn iconbtn-band sheet-x" aria-label="Zatvori" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className={cx('sheet-body', flush && 'is-flush')}>{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const show = useCallback((text, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setList((l) => [...l.slice(-2), { id, text, error: opts.error }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), opts.error ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={cx('toast', t.error && 'toast-error')}>
            <Icon name={t.error ? 'alert' : 'ok'} size={18} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- comments ---------- */
function withMentions(text, names) {
  if (!names.length || !text.includes('@')) return text;
  const re = new RegExp('(@(?:' + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + '))(?![\\p{L}\\d])', 'giu');
  return text.split(re).map((part, i) => (i % 2 === 1 ? <span key={i} className="mention">{part}</span> : part));
}

export function Comments({ comments = [], me, users = [], onAdd, onDelete, placeholder = 'Napiši komentar. @ime obavještava kolegu.' }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const id = useId();
  const names = users.flatMap((u) => [u.name, String(u.name || '').split(/\s+/)[0]]).filter((n) => n && n.length > 1);
  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const ok = await onAdd(text.trim());
    setBusy(false);
    if (ok !== false) setText('');
  };
  return (
    <section className="comments" aria-label="Komentari">
      <h3 className="h-heading">Komentari{comments.length ? ' · ' + comments.length : ''}</h3>
      {comments.length === 0 ? <p className="muted small">Još nema komentara.</p> : null}
      {comments.map((c) => (
        <div className="comment" key={c.id}>
          <Avatar name={c.by?.name} me={c.by?.id === me?.id} />
          <div className="comment-body">
            <div className="comment-meta">
              <strong>{c.by?.name}</strong>
              {c.by?.role ? <span>· {c.by.role === 'admin' ? 'Admin' : c.by.role === 'veleprodaja' ? 'Veleprodaja' : 'Maloprodaja'}</span> : null}
              <span>· {fmtWhen(c.at)}</span>
              {onDelete && (c.by?.id === me?.id || me?.role === 'admin') ? (
                <button type="button" className="comment-del" onClick={() => { if (confirm('Obrisati komentar?')) onDelete(c.id); }}>Obriši</button>
              ) : null}
            </div>
            <p className="comment-text">{withMentions(c.text, names)}</p>
          </div>
        </div>
      ))}
      <form className="composer" onSubmit={submit}>
        <div className="grow">
          <label htmlFor={id} className="sr">Novi komentar</label>
          <textarea id={id} className="textarea" rows={2} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e); }} />
        </div>
        <Button type="submit" variant="primary" icon="send" busy={busy} disabled={!text.trim()}>Pošalji</Button>
      </form>
    </section>
  );
}

export function useMedia(query) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
