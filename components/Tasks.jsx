'use client';
// Narudžbe i zadaci: filters, the list grouped by status, the detail (status steps, items, comments) and the form.
import { useEffect, useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import {
  Icon, Button, Segmented, Chips, Input, Textarea, Select, Sheet, StatusTag, SourceChip, Tag, Comments, Empty, Note, useMedia, cx,
} from '@/components/ui.jsx';
import { TASK_STATUS, TASK_FLOW, OPEN_STATUSES, SOURCES, DEPTS, TASK_TYPES, isOpenTask } from '@/lib/constants.js';
import { fmtDue, fmtDate, fmtWhen, fmtMoney, fmtQty, daysFromToday, fold } from '@/lib/format.js';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

const STATUS_FILTERS = [
  { value: 'otvorene', label: 'Sve otvorene' },
  ...OPEN_STATUSES.map((s) => ({ value: s, label: TASK_STATUS[s].label })),
  { value: 'zavrseno', label: 'Završene' },
  { value: 'otkazano', label: 'Otkazane' },
];

export default function Tasks() {
  const { data, me, route, go } = useApp();
  const wide = useMedia('(min-width: 1100px)');
  const [scope, setScope] = useState(() => read('stt_scope') || (me.role === 'admin' ? 'sve' : me.role));
  const [status, setStatus] = useState('otvorene');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null); // null | 'new' | task

  // #zadaci/~ceka_robu opens the list filtered to that status; #zadaci/<id> opens that task.
  useEffect(() => {
    if (route.arg && route.arg.startsWith('~')) setStatus(route.arg.slice(1));
  }, [route.arg]);
  const selectedId = route.arg && !route.arg.startsWith('~') ? route.arg : null;
  const selected = selectedId ? data.tasks.find((t) => t.id === selectedId) : null;

  const changeScope = (s) => { setScope(s); write('stt_scope', s); };

  const list = useMemo(() => {
    const f = fold(q);
    return data.tasks
      .filter((t) => (scope === 'sve' ? true : scope === 'moje' ? t.assignee === me.id || t.createdBy?.id === me.id : t.dept === scope))
      .filter((t) => (status === 'otvorene' ? isOpenTask(t) : t.status === status))
      .filter((t) => !f || [t.number, t.title, t.customer?.name, t.customer?.contact, t.note, t.supplier, ...(t.items || []).flatMap((i) => [i.code, i.name])].some((x) => fold(x).includes(f)))
      .sort((a, b) => {
        const da = a.due ? daysFromToday(a.due) : 999;
        const db = b.due ? daysFromToday(b.due) : 999;
        return da - db || b.createdAt - a.createdAt;
      });
  }, [data.tasks, scope, status, q, me.id]);

  const groups = useMemo(() => {
    const order = [...TASK_FLOW, 'otkazano'];
    const g = order.map((s) => ({ status: s, items: list.filter((t) => t.status === s) })).filter((x) => x.items.length);
    // Late first inside each group is already given by the sort.
    return g;
  }, [list]);

  const scopeOpts = [
    { value: 'moje', label: 'Moje' },
    { value: 'veleprodaja', label: 'Veleprodaja' },
    { value: 'maloprodaja', label: 'Maloprodaja' },
    { value: 'sve', label: 'Sve' },
  ];

  const detail = selected ? <TaskDetail task={selected} onEdit={() => setForm(selected)} onClose={() => go('zadaci')} /> : null;

  return (
    <main className="page">
      <PageHead title="Narudžbe i zadaci">
        <Segmented label="Čije" options={scopeOpts} value={scope} onChange={changeScope} />
        <Button variant="primary" icon="plus" onClick={() => setForm('new')}>Nova narudžba</Button>
      </PageHead>

      <div className="split">
        <section className="stack" style={{ gap: 12 }} aria-label="Lista">
          <div className="grid2">
            <label className="search">
              <Icon name="search" size={18} />
              <span className="sr">Traži</span>
              <input className="input" type="search" placeholder="Traži broj, kupca, šifru" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <label className="sr" htmlFor="status-filter">Status</label>
            <select id="status-filter" className="select" style={{ minHeight: 44 }} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_FILTERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {list.length === 0 ? <Empty>{q ? 'Ništa ne odgovara pretrazi.' : status === 'otvorene' ? 'Nema otvorenih narudžbi. Nova narudžba ide gore desno.' : 'Ovdje nema ništa.'}</Empty> : null}
          {groups.map((g) => (
            <div key={g.status} className="stack" style={{ gap: 10 }}>
              <h2 className="group-h label muted">{TASK_STATUS[g.status].label} · {g.items.length}</h2>
              <div className="tlist">
                {g.items.map((t) => <TaskCard key={t.id} t={t} on={t.id === selectedId} onClick={() => go('zadaci', t.id)} />)}
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
      {form ? <TaskForm task={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </main>
  );
}

function TaskCard({ t, on, onClick }) {
  const late = t.due && daysFromToday(t.due) < 0 && isOpenTask(t);
  return (
    <button type="button" className={cx('tcard', on && 'is-on')} onClick={onClick} aria-current={on ? 'true' : undefined}>
      <span className="tcard-top">
        <span className="num-label" style={{ color: 'inherit' }}>{t.number}</span>
        <span className="grow">· {SOURCES[t.source]?.label}{t.customer?.name ? ' · ' + t.customer.name : ''}</span>
        {t.due ? <span className={late ? 'is-late' : undefined}>{late ? 'Kasni ' : 'Rok '}{fmtDue(t.due)}</span> : null}
      </span>
      <span style={{ fontWeight: 600, lineHeight: '22px' }}>{t.title}</span>
      {t.comments?.length ? <span className="cc tcard-last"><Icon name="chat" size={14} /><span>{t.comments.length} · {t.comments[t.comments.length - 1].by?.name}: {t.comments[t.comments.length - 1].text}</span></span> : null}
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

export function TaskDetail({ task: t, onEdit }) {
  const { data, me, reload, toast, go } = useApp();
  const [busy, setBusy] = useState(false);
  const idx = TASK_FLOW.indexOf(t.status);
  const users = data.users.filter((u) => !u.disabled);

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
  const late = t.due && daysFromToday(t.due) < 0 && isOpenTask(t);

  return (
    <article className="detail">
      <div className="detail-top">
        <span className="num-label">{t.number}</span>
        <SourceChip source={t.source} />
        <span className="src">{DEPTS[t.dept]}</span>
        {t.type === 'zadatak' ? <span className="src">Zadatak</span> : null}
        <span className="grow" />
        <Button icon="edit" onClick={onEdit}>Uredi</Button>
      </div>
      <h2 className="h-title" style={{ marginTop: -6 }}>{t.title}</h2>

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
          {isOpenTask(t) ? <Button variant="quiet" busy={busy} onClick={() => { if (confirm('Otkazati ' + t.number + '?')) save({ status: 'otkazano' }, 'Otkazano'); }}>Otkaži</Button> : null}
        </div>
      ) : null}

      <dl className="dl">
        <div><dt>Kupac</dt><dd style={{ fontWeight: 600 }}>{t.customer?.name || '—'}</dd></div>
        <div><dt>Kontakt</dt><dd>{t.customer?.contact || '—'}</dd></div>
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
        <div>
          <dt><label htmlFor={'due-' + t.id}>Rok</label></dt>
          <dd>
            <input id={'due-' + t.id} type="date" className="input" style={{ minHeight: 40, padding: '6px 10px' }} value={t.due || ''} disabled={busy}
              onChange={(e) => save({ due: e.target.value || null }, e.target.value ? 'Rok: ' + fmtDate(e.target.value) : 'Rok uklonjen')} />
            {late ? <span className="is-late small">Kasni</span> : null}
          </dd>
        </div>
        {t.supplier ? <div><dt>Dobavljač</dt><dd>{t.supplier}</dd></div> : null}
        <div><dt>Napravio/la</dt><dd>{t.createdBy?.name} · {fmtWhen(t.createdAt)}</dd></div>
      </dl>

      {t.status === 'ceka_robu' || t.status === 'ceka_kalkulaciju' ? (
        <Note tone="accent" icon={t.status === 'ceka_robu' ? 'truck' : 'calculator'}>
          {t.status === 'ceka_robu' ? 'Faktura tek kad roba fizički stigne i uradi se ulazna kalkulacija. Kad stigne, klikni „Roba stigla”.' : 'Roba je stigla. Uradi ulaznu kalkulaciju, pa fakturu.'}
        </Note>
      ) : null}

      {t.items?.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="items">
            <thead><tr><th>Šifra</th><th>Naziv</th><th className="r">Kol.</th><th className="r">Cijena</th></tr></thead>
            <tbody>
              {t.items.map((i, n) => (
                <tr key={n}><td className="small">{i.code || '—'}</td><td>{i.name}</td><td className="r">{fmtQty(i.qty)}</td><td className="r">{i.price != null ? fmtMoney(i.price) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {t.note ? <div className="well" style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: '22px' }}>{t.note}</div> : null}
      {t.links?.inboxId ? <div><Button size="sm" icon="inbox" onClick={() => go('prijem', t.links.inboxId)}>Otvori original iz prijema</Button></div> : null}

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

const emptyItem = () => ({ code: '', name: '', qty: 1 });

export function TaskForm({ task, onClose, preset }) {
  const { data, me, reload, toast, go } = useApp();
  const edit = !!task;
  const [f, setF] = useState(() => task ? structuredClone({ ...task, items: task.items?.length ? task.items : [] }) : {
    type: 'narudzba',
    title: '',
    customer: { name: '', contact: '' },
    source: 'email',
    dept: me.role === 'maloprodaja' ? 'maloprodaja' : 'veleprodaja',
    assignee: me.id,
    due: '',
    status: 'nova',
    supplier: '',
    items: [],
    note: '',
    ...preset,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setItem = (i, k, v) => setF((x) => { const items = [...x.items]; items[i] = { ...items[i], [k]: v }; return { ...x, items }; });

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title.trim()) { setErr('Upiši naslov, npr. „10× Lenovo ThinkPad za Tehnocentar”.'); return; }
    setBusy(true);
    const payload = {
      type: f.type, title: f.title, customer: f.customer, source: f.source, dept: f.dept, assignee: f.assignee || null,
      due: f.due || null, status: f.status, supplier: f.supplier, note: f.note,
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

  const sources = Object.entries(SOURCES).filter(([k]) => f.type === 'zadatak' || k !== 'interno').map(([value, s]) => ({ value, label: s.label }));
  const users = data.users.filter((u) => !u.disabled);

  return (
    <Sheet title={edit ? 'Uredi ' + task.number : f.type === 'zadatak' ? 'Novi zadatak' : 'Nova narudžba'} onClose={onClose} wide
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon="check" busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Napravi'}</Button>
      </>}>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        {!edit ? <Segmented label="Vrsta" value={f.type} onChange={(v) => setF((x) => ({ ...x, type: v, source: v === 'zadatak' ? 'interno' : x.source === 'interno' ? 'email' : x.source }))} options={Object.entries(TASK_TYPES).map(([value, t]) => ({ value, label: t.label }))} /> : null}
        <Input label="Naslov" value={f.title} onChange={(v) => set('title', v)} placeholder={f.type === 'zadatak' ? 'Npr. nazvati distributera zbog roka isporuke' : 'Npr. 10× Lenovo ThinkPad E14 za Tehnocentar'} maxLength={200} autoFocus />
        {f.type === 'narudzba' ? (
          <div className="grid2">
            <Input label="Kupac" value={f.customer.name} onChange={(v) => set('customer', { ...f.customer, name: v })} placeholder="Ime ili firma" />
            <Input label="Kontakt" value={f.customer.contact} onChange={(v) => set('customer', { ...f.customer, contact: v })} placeholder="Telefon ili email" />
          </div>
        ) : null}
        <div className="field">
          <span className="field-label">Odakle je stiglo</span>
          <Chips label="Izvor" options={sources} value={f.source} onChange={(v) => set('source', v)} />
        </div>
        <div className="grid3">
          <Select label="Status" value={f.status} onChange={(v) => set('status', v)} options={Object.entries(TASK_STATUS).map(([value, s]) => ({ value, label: s.label }))} />
          <Select label="Odjel" value={f.dept} onChange={(v) => set('dept', v)} options={Object.entries(DEPTS).map(([value, label]) => ({ value, label }))} />
          <Select label="Dodijeljeno" value={f.assignee || ''} onChange={(v) => set('assignee', v)} options={[{ value: '', label: 'Niko' }, ...users.map((u) => ({ value: u.id, label: u.name + (u.id === me.id ? ' (ja)' : '') }))]} />
          <Input label="Rok" type="date" value={f.due || ''} onChange={(v) => set('due', v)} />
          {f.type === 'narudzba' ? <Input label="Dobavljač / pošiljka" value={f.supplier} onChange={(v) => set('supplier', v)} placeholder="Npr. distributer, kamion u četvrtak" /> : null}
        </div>

        {f.type === 'narudzba' ? (
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
        ) : null}

        <Textarea label="Napomena" value={f.note} onChange={(v) => set('note', v)} rows={4} placeholder="Šta je dogovoreno, šta treba uraditi, zašto se čeka." />
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
