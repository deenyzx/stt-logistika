'use client';
// Prijenosnice: goods moving between warehouses. Every prijenosnica shows where it goes FROM (polazno skladište) and
// TO (dolazno skladište). The sending side answers each line (Dostupno / Parcijalno dostupan / Nedostupno) and ships
// it; the receiving side confirms it arrived. Replaces the PRIJENOSNICE sheet.
import { useEffect, useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Sheet, Tag, Note, Comments, Empty, Avatar, cx, useMedia } from '@/components/ui.jsx';
import { useArticle, StockPill, ArticleNameInput, lookupCode } from '@/components/Article.jsx';
import {
  LINE_STATUS, TRANSFER_STATUS, TRANSFER_DONE, WAREHOUSE_KIND, transferStatus, transferTodo, transferSides,
} from '@/lib/constants.js';
import { fmtDate, fmtWhen, fmtMoney, fmtQty, fold, dayLabel, todayISO, addDaysISO, parseMoney } from '@/lib/format.js';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const dayClass = (iso, today) => (iso === today ? 'is-today' : iso === addDaysISO(today, -1) ? 'is-yesterday' : null);
const lineTotal = (l) => (l.sell != null && l.qty != null ? l.sell * l.qty : null);
const sum = (ls) => { const v = ls.map(lineTotal).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };

export function TransferTag({ t }) {
  const s = TRANSFER_STATUS[t.status || transferStatus(t)];
  return <Tag tone={s.tone} icon={s.icon}>{s.label}</Tag>;
}
export function LineTag({ l }) {
  const s = LINE_STATUS[l.status];
  return <Tag tone={s.tone} icon={s.icon}>{s.short || s.label}</Tag>;
}

/** "IZ VP skladište → U Maloprodaja KupiLenovo" */
export function RouteStrip({ from, to, big }) {
  return (
    <span className={cx('route', big && 'route-big')}>
      <span className="route-end">
        <span className="route-label">{big ? 'Polazno skladište' : 'Iz'}</span>
        <span className="route-name">{from?.name}</span>
        {big ? <span className="route-kind">{WAREHOUSE_KIND[from?.kind]}</span> : null}
      </span>
      <span className="route-arrow" aria-label="ide u"><Icon name="arrow" size={big ? 28 : 18} /></span>
      <span className="route-end">
        <span className="route-label">{big ? 'Dolazno skladište' : 'U'}</span>
        <span className="route-name">{to?.name}</span>
        {big ? <span className="route-kind">{WAREHOUSE_KIND[to?.kind]}</span> : null}
      </span>
    </span>
  );
}

function whoseTurn(t) {
  const todo = transferTodo(t);
  if (todo.from === 'odgovori') return `${t.from.name} javlja dostupnost`;
  if (todo.from === 'otpremi' && todo.to === 'primi') return `${t.from.name} otprema ostatak, ${t.to.name} potvrđuje prijem`;
  if (todo.from === 'otpremi') return `${t.from.name} otprema robu`;
  if (todo.to === 'primi') return `${t.to.name} potvrđuje prijem`;
  return null;
}

export default function Transfers() {
  const { data, me, route, go, today } = useApp();
  const wide = useMedia('(min-width: 1100px)');
  const [show, setShow] = useState(() => read('stt_tr_show') || 'mene');
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const warehouses = data.settings.warehouses || [];

  const needsMe = (t) => { const todo = transferTodo(t); const s = transferSides(t, me); return (s.from && !!todo.from) || (s.to && !!todo.to); };
  const list = useMemo(() => {
    const f = fold(q);
    return data.transfers
      .filter((t) => (show === 'mene' ? needsMe(t) : show === 'toku' ? !TRANSFER_DONE.includes(t.status) : show === 'zavrsene' ? TRANSFER_DONE.includes(t.status) : true))
      .filter((t) => !wh || t.from.id === wh || t.to.id === wh)
      .filter((t) => !f || [t.number, t.from.name, t.to.name, t.note, t.createdBy?.name, ...t.items.flatMap((l) => [l.code, l.name, l.note])].some((x) => fold(x).includes(f)));
  }, [data.transfers, show, wh, q, me]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map();
    for (const t of list) { if (!m.has(t.date)) m.set(t.date, []); m.get(t.date).push(t); }
    return [...m.entries()].map(([date, items]) => ({ date, items }));
  }, [list]);
  const count = (fn) => data.transfers.filter(fn).length;
  const changeShow = (v) => { setShow(v); write('stt_tr_show', v); };

  const selected = route.arg ? data.transfers.find((t) => t.id === route.arg) : null;
  const detail = selected ? <TransferDetail t={selected} onEdit={() => setForm(selected)} /> : null;

  return (
    <main className="page">
      <PageHead title="Prijenosnice" lead="Roba između skladišta: odakle ide i gdje stiže. Polazno skladište javlja dostupnost i otprema, dolazno potvrđuje prijem.">
        <a className="btn" href="/api/export?what=prijenosnice" download><Icon name="download" />CSV</a>
        <Button variant="primary" icon="plus" onClick={() => setForm('new')}>Nova prijenosnica</Button>
      </PageHead>

      <div className="split">
        <section className="stack" style={{ gap: 12 }} aria-label="Lista">
          <Segmented label="Prikaži" value={show} onChange={changeShow} options={[
            { value: 'mene', label: 'Čeka mene', count: count(needsMe) || undefined },
            { value: 'toku', label: 'U toku', count: count((t) => !TRANSFER_DONE.includes(t.status)) || undefined },
            { value: 'zavrsene', label: 'Završene' },
            { value: 'sve', label: 'Sve' },
          ]} />
          <div className="grid2">
            <label className="search">
              <Icon name="search" size={18} />
              <span className="sr">Traži</span>
              <input className="input" type="search" placeholder="Traži šifru, artikal" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="field">
              <label className="sr" htmlFor="tr-wh">Skladište</label>
              <select id="tr-wh" className="select" style={{ minHeight: 44 }} value={wh} onChange={(e) => setWh(e.target.value)}>
                <option value="">Sva skladišta</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          {list.length === 0 ? <Empty>{q || wh ? 'Ništa ne odgovara.' : show === 'mene' ? 'Nijedna prijenosnica ne čeka tebe.' : 'Ovdje nema prijenosnica.'}</Empty> : null}
          {groups.map((g) => (
            <div key={g.date} className="stack" style={{ gap: 10 }}>
              <h2 className={cx('group-h label muted', dayClass(g.date, today))}>{dayLabel(g.date)} · {g.items.length}</h2>
              <div className="tlist">
                {g.items.map((t) => <TransferCard key={t.id} t={t} on={t.id === route.arg} today={today} onClick={() => go('prijenosnice', t.id)} />)}
              </div>
            </div>
          ))}
        </section>

        {wide ? (
          <section className="card split-detail" aria-label="Detalji">
            {detail || (
              <div className="split-detail-empty stack" style={{ padding: 40, alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <Icon name="truck" size={32} className="muted" />
                <p className="muted">Izaberi prijenosnicu s liste.</p>
              </div>
            )}
          </section>
        ) : null}
      </div>

      {!wide && selected ? <Sheet title={selected.number} onClose={() => go('prijenosnice')} flush>{detail}</Sheet> : null}
      {route.arg && !selected ? <Sheet title="Ne postoji" onClose={() => go('prijenosnice')}><p>Ova prijenosnica je obrisana ili je starija od 60 dana (ostaje u CSV izvozu).</p></Sheet> : null}
      {form ? <TransferForm t={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </main>
  );
}

function TransferCard({ t, on, onClick, today }) {
  const shown = t.items.slice(0, 3);
  return (
    <button type="button" className={cx('tcard', on && 'is-on', dayClass(t.date, today), t.cancelled && 'is-closed')} onClick={onClick}>
      <span className="tcard-top">
        <span className="num-label">{t.number}</span>
        <TransferTag t={t} />
        <span className="grow" />
        <span>{t.items.length} {t.items.length === 1 ? 'artikal' : 'artikla'}</span>
      </span>
      <RouteStrip from={t.from} to={t.to} />
      <span className="stack" style={{ gap: 4 }}>
        {shown.map((l) => (
          <span key={l.id} className="tline-mini">
            <span className="grow">{fmtQty(l.qty)}× {l.name || l.code}{l.code && l.name ? <span className="muted"> · {l.code}</span> : null}</span>
            <LineTag l={l} />
          </span>
        ))}
        {t.items.length > 3 ? <span className="small muted">i još {t.items.length - 3}</span> : null}
      </span>
      <span className="small muted row" style={{ gap: 6 }}>
        <span className="grow">{t.createdBy?.name} · {fmtWhen(t.createdAt)}</span>
        <span className="cc"><Icon name="chat" size={16} />{t.comments?.length || 0}</span>
      </span>
    </button>
  );
}

function TransferDetail({ t, onEdit }) {
  const { data, me, reload, toast, today } = useApp();
  const side = transferSides(t, me);
  const owner = me.role === 'admin' || t.createdBy?.id === me.id;
  const moved = t.items.some((l) => l.status === 'otpremljen' || l.status === 'primljen');
  const [edits, setEdits] = useState({});
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(null);
  useEffect(() => { setEdits({}); }, [t.id, t.updatedAt]);

  const lineOptions = (l) => {
    if (side.from && ['novi', 'dostupno', 'parcijalno', 'nedostupno'].includes(l.status)) return ['novi', 'dostupno', 'parcijalno', 'nedostupno', 'otpremljen'];
    if (side.to && (l.status === 'otpremljen' || l.status === 'primljen')) return ['otpremljen', 'primljen'];
    return null;
  };
  const edit = (id, k, v) => setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));
  const val = (l, k) => (edits[l.id]?.[k] !== undefined ? edits[l.id][k] : l[k]);
  const dirty = Object.keys(edits).length > 0;

  const send = async (payload, msg, key) => {
    setBusy(key);
    try { await api('PATCH', '/api/transfers/' + t.id, payload); toast(msg); setEdits({}); reload(); }
    catch (e) { toast(e.message, { error: true }); }
    setBusy(null);
  };
  const saveLines = () => send({
    receivedOn: day,
    lines: Object.entries(edits).map(([id, e]) => ({ id, ...e, ...(e.sentQty !== undefined ? { sentQty: e.sentQty === '' ? null : parseMoney(e.sentQty) } : {}) })),
  }, 'Sačuvano', 'lines');

  const canShip = side.from && t.items.some((l) => l.status === 'dostupno' || l.status === 'parcijalno');
  const canReceive = side.to && t.items.some((l) => l.status === 'otpremljen');
  const turn = !t.cancelled ? whoseTurn(t) : null;
  const total = sum(t.items.filter((l) => l.status !== 'nedostupno'));

  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'transfer', id: t.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'transfer', id: t.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };

  return (
    <div className="detail">
      <div className="detail-top">
        <span className="num-label">{t.number}</span>
        <TransferTag t={t} />
        <span className="small muted">{dayLabel(t.date)}</span>
        <span className="grow" />
        {owner && !moved && !t.cancelled ? <Button size="sm" icon="edit" onClick={onEdit}>Uredi</Button> : null}
      </div>

      <RouteStrip from={t.from} to={t.to} big />
      {turn ? <Note tone="accent" icon="hourglass"><strong>Na potezu:</strong> {turn}{(side.from && transferTodo(t).from) || (side.to && transferTodo(t).to) ? ' (to si ti)' : ''}.</Note> : null}

      <div className="tlines">
        {t.items.map((l) => {
          const opts = lineOptions(l);
          const st = val(l, 'status');
          return (
            <div key={l.id} className={cx('tline', l.status === 'nedostupno' && 'is-off')}>
              <div className="tline-head">
                <span className="grow">
                  <strong>{l.name || l.code}</strong>
                  {l.code ? <span className="small muted"> · šifra {l.code}</span> : null}
                </span>
                <span className="tline-qty">{fmtQty(l.qty)} kom</span>
              </div>
              <div className="tline-facts small">
                {l.buy != null ? <span>Nabavna {fmtMoney(l.buy)}</span> : null}
                {l.sell != null ? <span>Prodajna {fmtMoney(l.sell)}</span> : null}
                {lineTotal(l) != null ? <span><strong>Total {fmtMoney(lineTotal(l))}</strong></span> : null}
                {l.code && ['novi', 'dostupno', 'parcijalno'].includes(l.status) ? <LiveStock code={l.code} qty={l.qty} /> : null}
              </div>
              <div className="tline-status">
                {opts ? (
                  <select className="select select-sm" aria-label={'Status: ' + (l.name || l.code)} value={st} onChange={(e) => edit(l.id, 'status', e.target.value)}>
                    {opts.map((s) => <option key={s} value={s}>{LINE_STATUS[s].label}</option>)}
                  </select>
                ) : <LineTag l={l} />}
                {(st === 'parcijalno' || l.sentQty != null) && side.from ? (
                  <label className="row small" style={{ gap: 6 }}>Ide kom
                    <input className="input input-sm num" style={{ width: 72 }} inputMode="decimal" value={val(l, 'sentQty') ?? ''} onChange={(e) => edit(l.id, 'sentQty', e.target.value)} />
                  </label>
                ) : l.sentQty != null ? <span className="small">Ide {fmtQty(l.sentQty)} kom</span> : null}
                {l.receivedOn ? <span className="small">Primljeno {fmtDate(l.receivedOn)}</span> : l.shippedAt ? <span className="small muted">Otpremljeno {fmtWhen(l.shippedAt)}</span> : null}
                {l.statusBy && !opts ? <span className="small muted">{l.statusBy}</span> : null}
              </div>
              <input className="input input-sm" aria-label="Napomena" placeholder="Napomena (npr. naručeno, stiže sutra)" value={val(l, 'note') || ''} onChange={(e) => edit(l.id, 'note', e.target.value)} />
            </div>
          );
        })}
        {total != null ? <div className="tline-sum"><span className="grow">Ukupno (prodajna)</span><strong>{fmtMoney(total)}</strong></div> : null}
      </div>

      {dirty ? (
        <div className="row">
          <Button variant="primary" icon="save" busy={busy === 'lines'} onClick={saveLines}>Sačuvaj promjene</Button>
          <Button variant="quiet" onClick={() => setEdits({})}>Poništi</Button>
        </div>
      ) : null}

      {!t.cancelled && !dirty && (canShip || canReceive) ? (
        <div className="row">
          {canShip ? <Button variant="primary" icon="truck" busy={busy === 'ship'} onClick={() => send({ action: 'ship' }, 'Otpremljeno. ' + t.to.name + ' je obaviješten.', 'ship')}>Otpremi dostupno</Button> : null}
          {canReceive ? (
            <>
              <Button variant="primary" icon="arrived" busy={busy === 'receive'} onClick={() => send({ action: 'receive', receivedOn: day }, 'Prijem potvrđen', 'receive')}>Potvrdi prijem</Button>
              <label className="row small" style={{ gap: 6 }}>Primljeno dana
                <input type="date" className="input input-sm" value={day} max={today} onChange={(e) => setDay(e.target.value || today)} />
              </label>
            </>
          ) : null}
        </div>
      ) : null}

      {t.note ? <div className="well" style={{ whiteSpace: 'pre-wrap' }}>{t.note}</div> : null}
      <div className="row small muted" style={{ gap: 8 }}>
        <Avatar name={t.createdBy?.name} small me={t.createdBy?.id === me.id} />
        <span className="grow">Napravio/la {t.createdBy?.name} · {fmtWhen(t.createdAt)}</span>
        {!t.cancelled && (owner || side.from) && !t.items.some((l) => l.status === 'otpremljen') && t.status !== 'primljena'
          ? <Button size="sm" variant="quiet" busy={busy === 'cancel'} onClick={() => { if (confirm(`Otkazati ${t.number}?`)) send({ action: 'cancel' }, 'Otkazano', 'cancel'); }}>Otkaži</Button> : null}
        {t.cancelled && (owner || side.from) ? <Button size="sm" icon="undo" busy={busy === 'reopen'} onClick={() => send({ action: 'reopen' }, 'Vraćeno', 'reopen')}>Vrati</Button> : null}
      </div>

      <Comments comments={t.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />
      {t.history?.length ? (
        <details className="more">
          <summary><Icon name="history" size={16} />Historija · {t.history.length}</summary>
          <ul className="history">{[...t.history].reverse().map((h, i) => <li key={i}>{fmtWhen(h.at)} · {h.by}: {h.text}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

function LiveStock({ code, qty }) {
  const art = useArticle(code);
  return <StockPill art={art} qty={qty} />;
}

const blankLine = () => ({ key: Math.random().toString(36).slice(2), code: '', name: '', qty: '1', buy: null, sell: null, note: '', auto: false });

export function TransferForm({ t, preset, onClose }) {
  const { data, reload, toast, go, today } = useApp();
  const edit = !!t;
  const ws = data.settings.warehouses || [];
  const firstOf = (kind) => ws.find((w) => w.kind === kind)?.id || '';
  const [f, setF] = useState(() => (t ? {
    date: t.date, from: t.from.id, to: t.to.id, note: t.note || '', comment: '',
    items: t.items.map((l) => ({ ...l, key: l.id, qty: String(l.qty ?? 1), auto: false })),
  } : {
    date: today,
    from: preset?.from || read('stt_tr_from') || firstOf('vp'),
    to: preset?.to || read('stt_tr_to') || firstOf('mp'),
    note: preset?.note || '',
    comment: '',
    items: preset?.items?.length ? preset.items.map((l) => ({ ...blankLine(), ...l, qty: String(l.qty ?? 1) })) : [blankLine()],
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setLine = (key, patch) => setF((x) => ({ ...x, items: x.items.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const fromW = ws.find((w) => w.id === f.from);
  const toW = ws.find((w) => w.id === f.to);

  // A code typed in: fill in the name and prices (unless the name was typed by hand).
  const onCode = async (key, code) => {
    setLine(key, { code });
    const a = await lookupCode(code);
    setF((x) => ({ ...x, items: x.items.map((l) => (l.key !== key || l.code !== code ? l : a ? { ...l, name: !l.name || l.auto ? a.name : l.name, buy: a.buy, sell: a.sell, auto: !l.name || l.auto } : l.auto ? { ...l, name: '', buy: null, sell: null, auto: false } : l)) }));
  };

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (!f.from || !f.to) { setErr('Izaberi polazno i dolazno skladište.'); return; }
    if (f.from === f.to) { setErr('Polazno i dolazno skladište ne mogu biti isto.'); return; }
    const items = f.items.filter((l) => l.code.trim() || l.name.trim()).map((l) => ({ id: edit ? l.id : undefined, code: l.code, name: l.name, qty: parseMoney(l.qty) ?? 1, buy: l.buy, sell: l.sell, note: l.note }));
    if (!items.length) { setErr('Dodaj bar jedan artikal (šifru ili naziv).'); return; }
    setBusy(true);
    try {
      const payload = { date: f.date, from: f.from, to: f.to, note: f.note, items, ...(edit ? {} : { comment: f.comment }) };
      const r = edit ? await api('PATCH', '/api/transfers/' + t.id, payload) : await api('POST', '/api/transfers', payload);
      write('stt_tr_from', f.from); write('stt_tr_to', f.to);
      toast(edit ? 'Sačuvano' : `${r.transfer.number} je poslana: ${fromW?.name} → ${toW?.name}`);
      reload();
      onClose();
      if (!edit) go('prijenosnice', r.transfer.id);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Obrisati ${t.number} zauvijek?`)) return;
    try { await api('DELETE', '/api/transfers/' + t.id); toast('Obrisano'); reload(); onClose(); go('prijenosnice'); }
    catch (e2) { setErr(e2.message); }
  };

  return (
    <Sheet title={edit ? 'Uredi ' + t.number : 'Nova prijenosnica'} onClose={onClose} wide
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon={edit ? 'check' : 'send'} busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Pošalji prijenosnicu'}</Button>
      </>}>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <div className="route-pick">
          <div className="field">
            <label className="field-label" htmlFor="tr-from">Polazno skladište (odakle)</label>
            <select id="tr-from" className="select" value={f.from} onChange={(e) => set('from', e.target.value)}>
              {ws.map((w) => <option key={w.id} value={w.id}>{w.name} · {WAREHOUSE_KIND[w.kind]}</option>)}
            </select>
          </div>
          <button type="button" className="iconbtn route-swap" aria-label="Zamijeni smjer" title="Zamijeni smjer" onClick={() => setF((x) => ({ ...x, from: x.to, to: x.from }))}><Icon name="sync" /></button>
          <div className="field">
            <label className="field-label" htmlFor="tr-to">Dolazno skladište (gdje stiže)</label>
            <select id="tr-to" className="select" value={f.to} onChange={(e) => set('to', e.target.value)}>
              {ws.map((w) => <option key={w.id} value={w.id}>{w.name} · {WAREHOUSE_KIND[w.kind]}</option>)}
            </select>
          </div>
        </div>
        {fromW && toW && f.from !== f.to ? <RouteStrip from={fromW} to={toW} /> : null}

        <div className="field" style={{ maxWidth: 220 }}>
          <label className="field-label" htmlFor="tr-date">Datum</label>
          <input id="tr-date" type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value || today)} />
        </div>

        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 4 }}>Artikli</legend>
          <p className="small muted" style={{ marginBottom: 8 }}><strong>Unosi šifre.</strong> Naziv, nabavna i prodajna cijena i stanje u VP se popune sami iz zadnjeg izvoza zaliha.</p>
          <div className="stack" style={{ gap: 12 }}>
            {f.items.map((l, i) => (
              <div key={l.key} className="line-edit">
                <input className="input num" aria-label={`Šifra ${i + 1}`} placeholder="Šifra" value={l.code} onChange={(e) => onCode(l.key, e.target.value)} autoFocus={!edit && i === 0} />
                <ArticleNameInput aria-label={`Naziv ${i + 1}`} placeholder="Naziv artikla" value={l.name}
                  onChange={(v) => setLine(l.key, { name: v, auto: false })}
                  onPick={(a) => setLine(l.key, { code: a.code, name: a.name, buy: a.buy, sell: a.sell, auto: true })} />
                <input className="input num" aria-label={`Količina ${i + 1}`} inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                <button type="button" className="iconbtn" aria-label={`Ukloni ${i + 1}`} disabled={f.items.length === 1} onClick={() => setF((x) => ({ ...x, items: x.items.filter((y) => y.key !== l.key) }))}><Icon name="trash" size={18} /></button>
                <div className="line-edit-info">
                  {l.code ? <LiveStock code={l.code} qty={parseMoney(l.qty)} /> : null}
                  {l.sell != null ? <span className="small muted">{fmtMoney(l.sell)} × {l.qty || 1} = <strong>{fmtMoney(l.sell * (parseMoney(l.qty) || 1))}</strong></span> : null}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}><Button size="sm" icon="plus" onClick={() => set('items', [...f.items, blankLine()])}>Dodaj artikal</Button></div>
        </fieldset>

        <div className="field">
          <label className="field-label" htmlFor="tr-note">Napomena</label>
          <textarea id="tr-note" className="textarea" rows={2} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Npr. za kupca koji dolazi u petak" />
        </div>
        {!edit ? (
          <Note icon="bell">Obavijest dobija {fromW ? <strong>{fromW.name}</strong> : 'polazno skladište'} ({WAREHOUSE_KIND[fromW?.kind]?.toLowerCase()}), da javi dostupnost i otpremi robu.</Note>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
