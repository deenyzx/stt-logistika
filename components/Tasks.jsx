'use client';
// Narudžbe i zadaci: the list (sorted by order date by default, grouped by day), the detail (status steps, customer,
// arrival date, items, comments), the full form and the quick form for orders taken by phone or in person.
import { useEffect, useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import ShopOrderPanel from '@/components/ShopOrder.jsx';
import {
  Icon, Button, Segmented, Chips, Input, Textarea, Select, Sheet, StatusTag, SourceChip, Tag, Comments, Empty, Note, useMedia, cx,
} from '@/components/ui.jsx';
import { TASK_STATUS, TASK_FLOW, OPEN_STATUSES, SOURCES, DEPTS, TASK_TYPES, TASK_SORTS, PAYMENT, isOpenTask } from '@/lib/constants.js';
import { fmtDue, fmtDate, fmtWhen, fmtMoney, fmtQty, daysFromToday, fold, taskDate, dayLabel, parseMoney } from '@/lib/format.js';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const STATUS_FILTERS = [
  { value: 'otvorene', label: 'Sve otvorene' },
  { value: 'dopuniti', label: 'Treba dopuniti' },
  { value: 'stize', label: 'Roba stiže (s datumom)' },
  ...OPEN_STATUSES.map((s) => ({ value: s, label: TASK_STATUS[s].label })),
  { value: 'zavrseno', label: 'Završene' },
  { value: 'otkazano', label: 'Otkazane' },
  { value: 'sve', label: 'Sve, i zatvorene' },
];

const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Sorts the list and cuts it into groups with a heading (a day, a status, …).
function arrange(list, sort, today) {
  const xs = [...list];
  const late = (iso) => iso && iso < today;
  let key;
  let label;
  if (sort === 'status') {
    const order = [...TASK_FLOW, 'otkazano'];
    xs.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || byStr(a.due || '9999', b.due || '9999') || b.createdAt - a.createdAt);
    key = (t) => t.status;
    label = (t) => TASK_STATUS[t.status].label;
  } else if (sort === 'dolazak') {
    xs.sort((a, b) => byStr(a.expectedAt || '9999', b.expectedAt || '9999') || byStr(taskDate(b), taskDate(a)));
    key = (t) => t.expectedAt || '~';
    label = (t) => (!t.expectedAt ? 'Bez datuma dolaska' : (late(t.expectedAt) && isOpenTask(t) ? 'Trebalo stići · ' : 'Stiže · ') + dayLabel(t.expectedAt));
  } else if (sort === 'rok') {
    xs.sort((a, b) => byStr(a.due || '9999', b.due || '9999') || byStr(taskDate(b), taskDate(a)));
    key = (t) => t.due || '~';
    label = (t) => (!t.due ? 'Bez roka' : (late(t.due) && isOpenTask(t) ? 'Kasni · rok ' : 'Rok · ') + dayLabel(t.due));
  } else {
    const asc = sort === 'datum_asc';
    xs.sort((a, b) => (asc ? byStr(taskDate(a), taskDate(b)) || a.createdAt - b.createdAt : byStr(taskDate(b), taskDate(a)) || b.createdAt - a.createdAt));
    key = taskDate;
    label = (t) => dayLabel(taskDate(t));
  }
  const groups = [];
  for (const t of xs) {
    const k = key(t);
    if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, label: label(t), items: [] });
    groups[groups.length - 1].items.push(t);
  }
  return groups;
}

export default function Tasks() {
  const { data, me, route, go, today } = useApp();
  const wide = useMedia('(min-width: 1100px)');
  const [scope, setScope] = useState(() => read('stt_scope') || (me.role === 'admin' ? 'sve' : me.role));
  const [sort, setSort] = useState(() => (TASK_SORTS[read('stt_sort')] ? read('stt_sort') : 'datum'));
  const [status, setStatus] = useState('otvorene');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | 'quick' | task

  // #zadaci/~ceka_robu opens the list filtered to that status; #zadaci/<id> opens that task.
  useEffect(() => {
    if (!route.arg || !route.arg.startsWith('~')) return;
    const f = route.arg.slice(1);
    setStatus(f);
    if (f === 'stize') setSort('dolazak');
  }, [route.arg]);
  const selectedId = route.arg && !route.arg.startsWith('~') ? route.arg : null;
  const selected = selectedId ? data.tasks.find((t) => t.id === selectedId) : null;

  const changeScope = (s) => { setScope(s); write('stt_scope', s); };
  const changeSort = (s) => { setSort(s); write('stt_sort', s); };

  const list = useMemo(() => {
    const f = fold(q);
    const keep = (t) => {
      if (status === 'sve') return true;
      if (status === 'otvorene') return isOpenTask(t);
      if (status === 'dopuniti') return isOpenTask(t) && t.needsInfo;
      if (status === 'stize') return isOpenTask(t) && !!t.expectedAt;
      return t.status === status;
    };
    return data.tasks
      .filter((t) => (scope === 'sve' ? true : scope === 'moje' ? t.assignee === me.id || t.createdBy?.id === me.id || (t.watchers || []).includes(me.id) : t.dept === scope))
      .filter(keep)
      .filter((t) => !f || [t.number, t.title, t.customer?.name, t.customer?.contact, t.customer?.phone, t.customer?.email, t.note, t.supplier, ...(t.items || []).flatMap((i) => [i.code, i.name])].some((x) => fold(x).includes(f)));
  }, [data.tasks, scope, status, q, me.id]);

  const groups = useMemo(() => arrange(list, sort, today), [list, sort, today]);

  const scopeOpts = [
    { value: 'moje', label: 'Moje' },
    { value: 'veleprodaja', label: 'Veleprodaja' },
    { value: 'maloprodaja', label: 'Maloprodaja' },
    { value: 'sve', label: 'Sve' },
  ];

  const detail = selected ? <TaskDetail task={selected} onEdit={() => setForm(selected)} /> : null;

  return (
    <main className="page">
      <PageHead title="Narudžbe i zadaci">
        <Segmented label="Čije" options={scopeOpts} value={scope} onChange={changeScope} />
        <Button icon="quick" onClick={() => setForm('quick')}>Brzi unos</Button>
        <Button variant="primary" icon="plus" onClick={() => setForm('new')}>Nova narudžba</Button>
      </PageHead>

      <div className="split">
        <section className="stack" style={{ gap: 12 }} aria-label="Lista">
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr">Traži</span>
            <input className="input" type="search" placeholder="Traži broj, kupca, telefon, šifru" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="grid2">
            <div className="field">
              <label className="sr" htmlFor="status-filter">Prikaži</label>
              <select id="status-filter" className="select" style={{ minHeight: 44 }} value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="sr" htmlFor="sort">Poredaj</label>
              <select id="sort" className="select" style={{ minHeight: 44 }} value={sort} onChange={(e) => changeSort(e.target.value)} title="Poredaj po datumu narudžbe, dolasku robe, roku ili statusu">
                {Object.entries(TASK_SORTS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          {list.length === 0 ? <Empty>{q ? 'Ništa ne odgovara pretrazi.' : status === 'otvorene' ? 'Nema otvorenih narudžbi. Nova narudžba ili brzi unos su gore desno.' : 'Ovdje nema ništa.'}</Empty> : null}
          {groups.map((g) => (
            <div key={g.key} className="stack" style={{ gap: 10 }}>
              <h2 className="group-h label muted">{g.label} · {g.items.length}</h2>
              <div className="tlist">
                {g.items.map((t) => <TaskCard key={t.id} t={t} sort={sort} on={t.id === selectedId} onClick={() => go('zadaci', t.id)} />)}
              </div>
            </div>
          ))}
        </section>

        {wide ? (
          <section className="card split-detail" aria-label="Detalji">
            {detail || (
              <div className="split-detail-empty stack" style={{ padding: 40, alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <Icon name="tasks" size={32} className="muted" />
                <p className="muted">Izaberi narudžbu ili zadatak s liste.</p>
              </div>
            )}
          </section>
        ) : null}
      </div>

      {!wide && selected ? (
        <Sheet title={selected.number} onClose={() => go('zadaci')} flush>{detail}</Sheet>
      ) : null}
      {!wide && selectedId && !selected ? <Sheet title="Ne postoji" onClose={() => go('zadaci')}><p>Ova narudžba je obrisana ili nemaš pristup.</p></Sheet> : null}
      {form === 'quick' ? <QuickOrderForm onClose={() => setForm(null)} /> : null}
      {form && form !== 'quick' ? <TaskForm task={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </main>
  );
}

export function TaskCard({ t, on, onClick, sort }) {
  const open = isOpenTask(t);
  const late = t.due && daysFromToday(t.due) < 0 && open;
  const arrivalLate = t.expectedAt && daysFromToday(t.expectedAt) < 0 && open;
  const last = t.comments?.[t.comments.length - 1];
  return (
    <button type="button" className={cx('tcard', on && 'is-on')} onClick={onClick} aria-current={on ? 'true' : undefined}>
      <span className="tcard-top">
        <span className="num-label" style={{ color: 'inherit' }}>{t.number}</span>
        <span className="grow">· {SOURCES[t.source]?.label}{t.customer?.name ? ' · ' + t.customer.name : ''}</span>
        {sort !== 'datum' && sort !== 'datum_asc' ? <span>{fmtDate(taskDate(t))}</span> : null}
      </span>
      <span style={{ fontWeight: 600, lineHeight: '22px' }}>{t.title}</span>
      <span className="tcard-tags">
        {sort !== 'status' ? <StatusTag status={t.status} short /> : null}
        {t.needsInfo && open ? <Tag tone="accent" icon="edit">Dopuniti</Tag> : null}
        {t.expectedAt && open ? <Tag tone={arrivalLate ? 'danger' : 'wait'} icon="truck">{arrivalLate ? 'Kasni roba' : 'Stiže ' + fmtDue(t.expectedAt)}</Tag> : null}
        {t.due && open ? <span className={cx('small', late ? 'is-late' : 'muted')}>{late ? 'Kasni, rok ' : 'Rok '}{fmtDue(t.due)}</span> : null}
      </span>
      {last ? <span className="cc tcard-last"><Icon name="chat" size={14} /><span>{t.comments.length} · {last.by?.name}: {last.text}</span></span> : null}
    </button>
  );
}

// The next obvious step from each status, shown as the one primary button.
const NEXT = {
  nova: { to: 'u_obradi', label: 'Počni obradu' },
  u_obradi: { to: 'za_fakturu', label: 'Spremno za fakturu' },
  ceka_robu: { to: 'ceka_kalkulaciju', label: 'Roba stigla' },
  ceka_kalkulaciju: { to: 'za_fakturu', label: 'Kalkulacija urađena' },
  za_fakturu: { to: 'zavrseno', label: 'Fakturisano, završi' },
};

const small = { minHeight: 40, padding: '6px 10px' };

export function TaskDetail({ task: t, onEdit }) {
  const { data, me, reload, toast, go } = useApp();
  const [busy, setBusy] = useState(false);
  const idx = TASK_FLOW.indexOf(t.status);
  const users = data.users.filter((u) => !u.disabled);
  const watching = (t.watchers || []).includes(me.id);
  const c = t.customer || {};

  const save = async (patch, msg) => {
    setBusy(true);
    try {
      await api('PATCH', '/api/tasks/' + t.id, patch);
      if (msg) toast(msg);
      reload();
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'task', id: t.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'task', id: t.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const next = NEXT[t.status];
  const open = isOpenTask(t);
  const late = t.due && daysFromToday(t.due) < 0 && open;
  const arrivalLate = t.expectedAt && daysFromToday(t.expectedAt) < 0 && open;

  return (
    <article className="detail">
      <div className="detail-top">
        <span className="num-label">{t.number}</span>
        <SourceChip source={t.source} />
        <span className="src">{DEPTS[t.dept]}</span>
        {t.type === 'zadatak' ? <span className="src">Zadatak</span> : null}
        <span className="grow" />
        <Button icon={watching ? 'bellring' : 'bell'} aria-pressed={watching} busy={busy} onClick={() => save({ watch: !watching }, watching ? 'Više ne pratiš ' + t.number : 'Pratiš ' + t.number + '. Dobijaš obavijesti o promjenama.')}>
          {watching ? 'Pratiš' : 'Prati'}
        </Button>
        <Button icon="edit" onClick={onEdit}>Uredi</Button>
      </div>
      <h2 className="h-title" style={{ marginTop: -6 }}>{t.title}</h2>

      {t.needsInfo && open ? (
        <div className="note note-accent">
          <Icon name="edit" size={20} />
          <div className="stack grow" style={{ gap: 10 }}>
            <span>Unesena na brzinu. Dopuni kupca, stavke i ostalo kad budeš imao/la podatke.</span>
            <div className="row">
              <Button size="sm" variant="primary" icon="edit" onClick={onEdit}>Dopuni podatke</Button>
              <Button size="sm" icon="check" busy={busy} onClick={() => save({ needsInfo: false }, 'Označeno kao dopunjeno')}>Sve je upisano</Button>
            </div>
          </div>
        </div>
      ) : null}

      {t.status === 'otkazano' ? (
        <div className="row"><StatusTag status="otkazano" /><Button size="sm" icon="undo" busy={busy} onClick={() => save({ status: 'u_obradi' }, 'Vraćeno u obradu')}>Vrati u obradu</Button></div>
      ) : (
        <ol className="stepper" aria-label="Status">
          {TASK_FLOW.map((s, i) => (
            <li key={s}>
              <button type="button" className={cx('step', i < idx && 'is-done', i === idx && 'is-now')} aria-current={i === idx ? 'step' : undefined}
                disabled={busy} onClick={() => i !== idx && save({ status: s }, 'Status: ' + TASK_STATUS[s].label)} title={'Postavi: ' + TASK_STATUS[s].label}>
                <span className="step-bar" />
                <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>{i < idx ? <Icon name="check" size={14} strokeWidth={3} /> : null}{TASK_STATUS[s].short || TASK_STATUS[s].label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {next ? (
        <div className="row">
          <Button variant="primary" iconAfter="arrow" busy={busy} onClick={() => save({ status: next.to }, 'Status: ' + TASK_STATUS[next.to].label)}>{next.label}</Button>
          {t.status === 'u_obradi' || t.status === 'nova' ? <Button busy={busy} icon="truck" onClick={() => save({ status: 'ceka_robu' }, 'Status: Čeka robu')}>Čeka robu</Button> : null}
          {open ? <Button variant="quiet" busy={busy} onClick={() => { if (confirm('Otkazati ' + t.number + '?')) save({ status: 'otkazano' }, 'Otkazano'); }}>Otkaži</Button> : null}
        </div>
      ) : null}

      {t.status === 'ceka_robu' || t.status === 'ceka_kalkulaciju' ? (
        <Note tone="accent" icon={t.status === 'ceka_robu' ? 'truck' : 'calculator'}>
          {t.status === 'ceka_robu'
            ? (t.expectedAt ? `Roba ${arrivalLate ? 'je trebala stići' : 'stiže'} ${fmtDate(t.expectedAt)}. ` : 'Upiši kad roba stiže, pa te podsjetim tog jutra. ') + 'Faktura tek kad roba fizički stigne i uradi se ulazna kalkulacija.'
            : 'Roba je stigla. Uradi ulaznu kalkulaciju, pa fakturu.'}
        </Note>
      ) : null}

      <dl className="dl">
        <div><dt>Kupac</dt><dd style={{ fontWeight: 600 }}>{c.name || '—'}</dd></div>
        {c.contact ? <div><dt>Kontakt osoba</dt><dd>{c.contact}</dd></div> : null}
        <div><dt>Telefon</dt><dd>{c.phone ? <a href={'tel:' + c.phone.replace(/[^\d+]/g, '')}>{c.phone}</a> : '—'}</dd></div>
        <div style={{ gridColumn: c.email && c.email.length > 18 ? 'span 2' : undefined }}><dt>Email</dt><dd>{c.email ? <a href={'mailto:' + c.email}>{c.email}</a> : '—'}</dd></div>
        {c.address ? <div style={{ gridColumn: 'span 2' }}><dt>Adresa</dt><dd>{c.address}</dd></div> : null}
        <div><dt>Datum narudžbe</dt><dd>{fmtDate(taskDate(t))}</dd></div>
        <div>
          <dt><label htmlFor={'exp-' + t.id}>Roba stiže</label></dt>
          <dd>
            <input id={'exp-' + t.id} type="date" className="input" style={small} value={t.expectedAt || ''} disabled={busy}
              onChange={(e) => save({ expectedAt: e.target.value || null }, e.target.value ? 'Roba stiže ' + fmtDate(e.target.value) : 'Datum dolaska uklonjen')} />
            {arrivalLate ? <span className="is-late small">Kasni</span> : null}
          </dd>
        </div>
        <div>
          <dt><label htmlFor={'due-' + t.id}>Rok</label></dt>
          <dd>
            <input id={'due-' + t.id} type="date" className="input" style={small} value={t.due || ''} disabled={busy}
              onChange={(e) => save({ due: e.target.value || null }, e.target.value ? 'Rok: ' + fmtDate(e.target.value) : 'Rok uklonjen')} />
            {late ? <span className="is-late small">Kasni</span> : null}
          </dd>
        </div>
        <div>
          <dt><label htmlFor={'as-' + t.id}>Dodijeljeno</label></dt>
          <dd>
            <select id={'as-' + t.id} className="select" style={{ minHeight: 40, padding: '6px 32px 6px 10px', backgroundPosition: 'calc(100% - 18px) 17px, calc(100% - 13px) 17px' }} value={t.assignee || ''} disabled={busy}
              onChange={(e) => save({ assignee: e.target.value || null }, 'Dodjela sačuvana')}>
              <option value="">Niko</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === me.id ? ' (ja)' : ''}</option>)}
            </select>
          </dd>
        </div>
        {t.payment ? <div><dt>Plaćanje</dt><dd>{t.payment}</dd></div> : null}
        {t.delivery ? <div style={{ gridColumn: 'span 2' }}><dt>Dostava</dt><dd>{t.delivery}</dd></div> : null}
        {t.total != null ? <div><dt>Ukupno</dt><dd style={{ fontWeight: 600 }} className="num">{fmtMoney(t.total, t.currency || 'KM')}</dd></div> : null}
        {t.supplier ? <div><dt>Dobavljač</dt><dd>{t.supplier}</dd></div> : null}
        <div><dt>Unio/la</dt><dd>{t.createdBy?.name} · {fmtWhen(t.createdAt)}</dd></div>
      </dl>

      {t.items?.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="items">
            <thead><tr><th>Šifra</th><th>Naziv</th><th className="r">Kol.</th><th className="r">Cijena</th></tr></thead>
            <tbody>
              {t.items.map((i, n) => (
                <tr key={n}><td className="small">{i.code || '—'}</td><td>{i.name}</td><td className="r">{fmtQty(i.qty)}</td><td className="r">{i.price != null ? fmtMoney(i.price, t.currency || 'KM') : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {t.note ? <div className="well" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: '22px' }}>{t.note}</div> : null}
      {t.source === 'web' && (t.links?.shopId || t.links?.shopName || t.links?.inboxId) ? <ShopOrderPanel taskId={t.id} shopName={t.links?.shopName} /> : null}
      {t.links?.inboxId ? (
        <div className="row">
          <Button size="sm" icon="inbox" onClick={() => go('prijem', t.links.inboxId)}>Original iz prijema</Button>
        </div>
      ) : null}

      <Comments comments={t.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />

      {t.history?.length ? (
        <details className="more">
          <summary><Icon name="history" size={16} />Historija · {t.history.length}</summary>
          <ul className="history">
            {[...t.history].reverse().map((h, i) => <li key={i}>{fmtWhen(h.at)} · {h.by}: {h.text}</li>)}
          </ul>
        </details>
      ) : null}
    </article>
  );
}

/* ---------- quick entry: an order taken by phone or in person, filled in later ---------- */
const QUICK_SOURCES = ['telefon', 'licno', 'viber', 'whatsapp', 'email', 'ostalo'];

export function QuickOrderForm({ onClose }) {
  const { reload, toast, go, today } = useApp();
  const [f, setF] = useState({ name: '', phone: '', what: '', source: 'telefon', orderedAt: today, expectedAt: '', needsInfo: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const submit = async (e) => {
    e?.preventDefault();
    const what = f.what.trim();
    if (!what) { setErr('Upiši šta je naručeno, makar ukratko.'); return; }
    const first = what.split(/\n/)[0].trim();
    setBusy(true);
    try {
      const r = await api('POST', '/api/tasks', {
        type: 'narudzba',
        title: first.length > 120 ? first.slice(0, 117) + '…' : first,
        customer: { name: f.name, phone: f.phone },
        source: f.source,
        orderedAt: f.orderedAt || today,
        expectedAt: f.expectedAt || null,
        status: f.expectedAt ? 'ceka_robu' : 'nova',
        needsInfo: f.needsInfo,
        note: what !== first ? what : '',
      });
      toast(`${r.task.number} je upisana${f.needsInfo ? '. Dopuni je kad budeš imao/la podatke.' : ''}`);
      reload();
      onClose();
      go('zadaci', r.task.id);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  return (
    <Sheet title="Brzi unos narudžbe" onClose={onClose}
      footer={<><Button onClick={onClose}>Odustani</Button><Button variant="primary" icon="check" busy={busy} onClick={submit}>Upiši narudžbu</Button></>}>
      <form className="stack" style={{ gap: 18 }} onSubmit={submit}>
        <p className="muted">Za narudžbe primljene telefonom ili uživo. Upiši ono što znaš, ostalo dopuni kasnije.</p>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <Textarea label="Šta je naručeno" value={f.what} onChange={(v) => set('what', v)} rows={3} placeholder={'Npr. 2× Lenovo IdeaPad Slim 3, crni\nhoće račun na firmu'} autoFocus />
        <div className="grid2">
          <Input label="Ko naručuje" value={f.name} onChange={(v) => set('name', v)} placeholder="Ime ili firma" />
          <Input label="Telefon" type="tel" value={f.phone} onChange={(v) => set('phone', v)} />
        </div>
        <div className="field">
          <span className="field-label">Kako je naručeno</span>
          <Chips label="Izvor" value={f.source} onChange={(v) => set('source', v)} options={QUICK_SOURCES.map((k) => ({ value: k, label: SOURCES[k].label }))} />
        </div>
        <div className="grid2">
          <Input label="Datum narudžbe" type="date" value={f.orderedAt} onChange={(v) => set('orderedAt', v)} />
          <Input label="Roba stiže (ako se čeka)" type="date" value={f.expectedAt} onChange={(v) => set('expectedAt', v)} hint={f.expectedAt ? 'Status će biti „Čeka robu”, i podsjetim te tog jutra.' : undefined} />
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={f.needsInfo} onChange={(e) => set('needsInfo', e.target.checked)} />
          <span>Podatke dopunjavam kasnije (ostaje označeno dok ne dopuniš)</span>
        </label>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

/* ---------- the full form ---------- */
const emptyItem = () => ({ code: '', name: '', qty: 1 });
const emptyCustomer = { name: '', contact: '', phone: '', email: '', address: '' };

export function TaskForm({ task, onClose, preset }) {
  const { data, me, reload, toast, go, today } = useApp();
  const edit = !!task;
  const [f, setF] = useState(() => task ? structuredClone({
    ...task,
    customer: { ...emptyCustomer, ...task.customer },
    items: task.items?.length ? task.items : [],
    orderedAt: taskDate(task),
    expectedAt: task.expectedAt || '',
    payment: task.payment || '',
    delivery: task.delivery || '',
    total: task.total ?? '',
    needsInfo: !!task.needsInfo,
  }) : {
    type: 'narudzba',
    title: '',
    customer: { ...emptyCustomer },
    source: 'email',
    dept: me.role === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja',
    assignee: me.id,
    orderedAt: today,
    expectedAt: '',
    due: '',
    status: 'nova',
    supplier: '',
    payment: '',
    delivery: '',
    total: '',
    items: [],
    note: '',
    needsInfo: false,
    ...preset,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setC = (k, v) => setF((x) => ({ ...x, customer: { ...x.customer, [k]: v } }));
  const setItem = (i, k, v) => setF((x) => { const items = [...x.items]; items[i] = { ...items[i], [k]: v }; return { ...x, items }; });

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title.trim()) { setErr('Upiši naslov, npr. „10× Lenovo ThinkPad za Tehnocentar”.'); return; }
    setBusy(true);
    const payload = {
      type: f.type, title: f.title, customer: f.customer, source: f.source, dept: f.dept, assignee: f.assignee || null,
      orderedAt: f.orderedAt || today, expectedAt: f.expectedAt || null, due: f.due || null, status: f.status,
      supplier: f.supplier, payment: f.payment, delivery: f.delivery, total: f.total === '' ? null : parseMoney(f.total),
      note: f.note, needsInfo: f.needsInfo,
      items: f.items.filter((i) => i.name || i.code).map((i) => ({ ...i, qty: i.qty === '' ? null : i.qty })),
    };
    try {
      const r = edit ? await api('PATCH', '/api/tasks/' + task.id, payload) : await api('POST', '/api/tasks', payload);
      toast(edit ? 'Sačuvano' : `${r.task.number} je napravljena`);
      reload();
      onClose();
      if (!edit) go('zadaci', r.task.id);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Obrisati ${task.number} zauvijek? Umjesto toga možeš staviti status Otkazano.`)) return;
    try { await api('DELETE', '/api/tasks/' + task.id); toast('Obrisano'); reload(); onClose(); go('zadaci'); }
    catch (e2) { setErr(e2.message); }
  };

  const order = f.type === 'narudzba';
  const sources = Object.entries(SOURCES).filter(([k]) => !order || k !== 'interno').map(([value, s]) => ({ value, label: s.label }));
  const users = data.users.filter((u) => !u.disabled);

  return (
    <Sheet title={edit ? 'Uredi ' + task.number : order ? 'Nova narudžba' : 'Novi zadatak'} onClose={onClose} wide
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon="check" busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Napravi'}</Button>
      </>}>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        {!edit ? <Segmented label="Vrsta" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v, source: v === 'zadatak' ? 'interno' : x.source === 'interno' ? 'email' : x.source }))} options={Object.entries(TASK_TYPES).map(([value, t]) => ({ value, label: t.label }))} /> : null}
        <Input label="Naslov" value={f.title} onChange={(v) => set('title', v)} placeholder={order ? 'Npr. 10× Lenovo ThinkPad E14 za Tehnocentar' : 'Npr. nazvati distributera zbog roka isporuke'} maxLength={200} autoFocus={!edit} />

        {order ? (
          <fieldset className="stack" style={{ gap: 12, border: 0, padding: 0, margin: 0 }}>
            <legend className="field-label" style={{ marginBottom: 8 }}>Kupac</legend>
            <div className="grid2">
              <Input label="Ime ili firma" value={f.customer.name} onChange={(v) => setC('name', v)} />
              <Input label="Kontakt osoba" value={f.customer.contact} onChange={(v) => setC('contact', v)} placeholder="Ako je firma" />
              <Input label="Telefon" type="tel" value={f.customer.phone} onChange={(v) => setC('phone', v)} />
              <Input label="Email" type="email" value={f.customer.email} onChange={(v) => setC('email', v)} />
            </div>
            <Input label="Adresa za dostavu" value={f.customer.address} onChange={(v) => setC('address', v)} placeholder="Ulica, poštanski broj, grad" />
          </fieldset>
        ) : null}

        <div className="field">
          <span className="field-label">Odakle je stiglo</span>
          <Chips label="Izvor" options={sources} value={f.source} onChange={(v) => set('source', v)} />
        </div>
        <div className="grid3">
          <Input label="Datum narudžbe" type="date" value={f.orderedAt} onChange={(v) => set('orderedAt', v)} />
          <Input label="Roba stiže" type="date" value={f.expectedAt} onChange={(v) => set('expectedAt', v)} hint="Kad se čeka roba od dobavljača." />
          <Input label="Rok" type="date" value={f.due || ''} onChange={(v) => set('due', v)} hint="Do kad kupac treba robu." />
          <Select label="Status" value={f.status} onChange={(v) => set('status', v)} options={Object.entries(TASK_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          <Select label="Odjel" value={f.dept} onChange={(v) => set('dept', v)} options={Object.entries(DEPTS).map(([value, label]) => ({ value, label }))} />
          <Select label="Dodijeljeno" value={f.assignee || ''} onChange={(v) => set('assignee', v)} options={[{ value: '', label: 'Niko' }, ...users.map((u) => ({ value: u.id, label: u.name + (u.id === me.id ? ' (ja)' : '') }))]} />
        </div>

        {order ? (
          <>
            <div className="stack" style={{ gap: 8 }}>
              <span className="field-label">Stavke</span>
              {f.items.map((it, i) => (
                <div className="item-edit" key={i}>
                  <input className="input item-code" aria-label={`Šifra, stavka ${i + 1}`} placeholder="Šifra" value={it.code || ''} onChange={(e) => setItem(i, 'code', e.target.value)} />
                  <input className="input" aria-label={`Naziv, stavka ${i + 1}`} placeholder="Naziv" value={it.name || ''} onChange={(e) => setItem(i, 'name', e.target.value)} />
                  <input className="input num" aria-label={`Količina, stavka ${i + 1}`} inputMode="decimal" placeholder="Kol." value={it.qty ?? ''} onChange={(e) => setItem(i, 'qty', e.target.value)} />
                  <button type="button" className="iconbtn iconbtn-bare" aria-label={`Ukloni stavku ${i + 1}`} onClick={() => setF((x) => ({ ...x, items: x.items.filter((_, n) => n !== i) }))}><Icon name="close" /></button>
                </div>
              ))}
              <div><Button size="sm" icon="plus" onClick={() => setF((x) => ({ ...x, items: [...x.items, emptyItem()] }))}>Dodaj stavku</Button></div>
            </div>
            <div className="grid2">
              <Input label="Plaćanje" value={f.payment} onChange={(v) => set('payment', v)} list="task-payments" placeholder="Npr. virman, pouzeće" />
              <Input label="Ukupno (KM)" value={f.total} onChange={(v) => set('total', v)} inputMode="decimal" className="num" placeholder="Nije obavezno" />
              <Input label="Dostava" value={f.delivery} onChange={(v) => set('delivery', v)} placeholder="Npr. brza pošta, preuzima lično" />
              <Input label="Dobavljač / pošiljka" value={f.supplier} onChange={(v) => set('supplier', v)} placeholder="Npr. distributer, kamion u četvrtak" />
            </div>
            <datalist id="task-payments">{Object.values(PAYMENT).map((p) => <option key={p} value={p} />)}</datalist>
          </>
        ) : null}

        <Textarea label="Napomena" value={f.note} onChange={(v) => set('note', v)} rows={4} placeholder="Šta je dogovoreno, šta treba uraditi, zašto se čeka." />
        <label className="checkrow">
          <input type="checkbox" checked={f.needsInfo} onChange={(e) => set('needsInfo', e.target.checked)} />
          <span>Treba još dopuniti podatke</span>
        </label>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
