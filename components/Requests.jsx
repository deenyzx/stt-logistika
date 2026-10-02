'use client';
// Upiti MP: maloprodaja asks veleprodaja about an article for a customer; veleprodaja answers (price, time, details)
// and the answer's date and author are recorded by themselves. Replaces the UPITI MP sheet.
import { useEffect, useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Sheet, Tag, Note, Comments, Empty, Avatar, cx, useMedia } from '@/components/ui.jsx';
import { useArticle, StockPill, ArticleNameInput, lookupCode } from '@/components/Article.jsx';
import { TransferForm } from '@/components/Transfers.jsx';
import { ReservationForm } from '@/components/Reservations.jsx';
import { REQUEST_STATUS, can } from '@/lib/constants.js';
import { fmtDate, fmtWhen, fmtQty, fold, dayLabel, addDaysISO, parseMoney } from '@/lib/format.js';

const ANSWERS = ['admin', 'veleprodaja'];
const dayClass = (iso, today) => (iso === today ? 'is-today' : iso === addDaysISO(today, -1) ? 'is-yesterday' : null);
const titleOf = (r) => r.name || r.code || r.pn || r.question.slice(0, 80);

export function RequestTag({ r }) {
  const s = REQUEST_STATUS[r.status];
  return <Tag tone={s.tone} icon={s.icon}>{s.label}</Tag>;
}

export default function Requests() {
  const { data, me, route, go, today } = useApp();
  const wide = useMedia('(min-width: 1100px)');
  const answerer = ANSWERS.includes(me.role);
  const [show, setShow] = useState(answerer ? 'novi' : 'otvoreni');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const all = data.requests;
  const count = (fn) => all.filter(fn).length;

  const list = useMemo(() => {
    const f = fold(q);
    return all
      .filter((r) => (show === 'novi' ? r.status === 'novi' : show === 'otvoreni' ? r.status !== 'zavrseno' : show === 'moji' ? r.createdBy?.id === me.id : show === 'zavrseni' ? r.status === 'zavrseno' : true))
      .filter((r) => !f || [r.number, r.pn, r.code, r.name, r.customer, r.question, r.answer, r.createdBy?.name].some((x) => fold(x).includes(f)));
  }, [all, show, q, me.id]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const r of list) { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r); }
    return [...m.entries()].map(([date, items]) => ({ date, items }));
  }, [list]);

  const selected = route.arg ? all.find((r) => r.id === route.arg) : null;
  const detail = selected ? <RequestDetail r={selected} onEdit={() => setForm(selected)} /> : null;

  return (
    <main className="page">
      <PageHead title="Upiti MP" lead="Maloprodaja pita veleprodaju za cijenu, dostupnost i rok. Odgovor i datum odgovora se upišu ovdje, a ko je pitao dobije obavijest.">
        <a className="btn" href="/api/export?what=upiti" download><Icon name="download" />CSV</a>
        <Button variant="primary" icon="plus" onClick={() => setForm('new')}>Novi upit</Button>
      </PageHead>

      <div className="split">
        <section className="stack" style={{ gap: 12 }} aria-label="Lista">
          <Segmented label="Prikaži" value={show} onChange={setShow} options={[
            { value: 'novi', label: 'Čeka odgovor', count: count((r) => r.status === 'novi') || undefined },
            { value: 'otvoreni', label: 'Otvoreni', count: count((r) => r.status !== 'zavrseno') || undefined },
            { value: 'moji', label: 'Moji' },
            { value: 'zavrseni', label: 'Završeni' },
            { value: 'sve', label: 'Sve' },
          ]} />
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr">Traži</span>
            <input className="input" type="search" placeholder="Traži artikal, P/N, kupca, odgovor" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {list.length === 0 ? <Empty>{q ? 'Ništa ne odgovara.' : show === 'novi' ? 'Nijedan upit ne čeka odgovor.' : 'Ovdje nema upita.'}</Empty> : null}
          {groups.map((g) => (
            <div key={g.date} className="stack" style={{ gap: 10 }}>
              <h2 className={cx('group-h label muted', dayClass(g.date, today))}>{dayLabel(g.date)} · {g.items.length}</h2>
              <div className="tlist">
                {g.items.map((r) => (
                  <button key={r.id} type="button" className={cx('tcard', r.id === route.arg && 'is-on', dayClass(r.date, today))} onClick={() => go('upiti', r.id)}>
                    <span className="tcard-top">
                      <span className="num-label">{r.number}</span>
                      <RequestTag r={r} />
                      <span className="grow" />
                      {r.qty ? <span>{fmtQty(r.qty)} kom</span> : null}
                    </span>
                    <span className="rowlink-title">{titleOf(r)}</span>
                    {r.question && r.question !== titleOf(r) ? <span className="small nbody nbody-2">{r.question}</span> : null}
                    {r.answer ? <span className="answer-mini"><Icon name="chat" size={14} /><span className="nbody nbody-2">{r.answer}</span></span> : null}
                    <span className="small muted row" style={{ gap: 6 }}>
                      <span className="grow">{[r.customer && 'Kupac: ' + r.customer, r.createdBy?.name].filter(Boolean).join(' · ')}</span>
                      <span className="cc"><Icon name="chat" size={16} />{r.comments?.length || 0}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        {wide ? (
          <section className="card split-detail" aria-label="Detalji">
            {detail || (
              <div className="split-detail-empty stack" style={{ padding: 40, alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <Icon name="chat" size={32} className="muted" />
                <p className="muted">Izaberi upit s liste.</p>
              </div>
            )}
          </section>
        ) : null}
      </div>

      {!wide && selected ? <Sheet title={selected.number} onClose={() => go('upiti')} flush>{detail}</Sheet> : null}
      {route.arg && !selected ? <Sheet title="Ne postoji" onClose={() => go('upiti')}><p>Ovaj upit je obrisan ili je stariji od 60 dana (ostaje u CSV izvozu).</p></Sheet> : null}
      {form ? <RequestForm r={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </main>
  );
}

function RequestDetail({ r, onEdit }) {
  const { data, me, reload, toast } = useApp();
  const answerer = ANSWERS.includes(me.role);
  const owner = me.role === 'admin' || r.createdBy?.id === me.id;
  const [answer, setAnswer] = useState(r.answer || '');
  const [busy, setBusy] = useState(null);
  const [follow, setFollow] = useState(null); // 'transfer' | 'reservation'
  const art = useArticle(r.code);
  useEffect(() => { setAnswer(r.answer || ''); }, [r.id, r.answer]);

  const save = async (patch, msg, key) => {
    setBusy(key);
    try { await api('PATCH', '/api/requests/' + r.id, patch); toast(msg); reload(); }
    catch (e) { toast(e.message, { error: true }); }
    setBusy(null);
  };
  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'request', id: r.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'request', id: r.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const vp = (data.settings.warehouses || []).find((w) => w.kind === 'vp');
  const mp = (data.settings.warehouses || []).find((w) => w.kind === 'mp');

  return (
    <div className="detail">
      <div className="detail-top">
        <span className="num-label">{r.number}</span>
        <RequestTag r={r} />
        <span className="small muted">{dayLabel(r.date)}</span>
        <span className="grow" />
        {owner ? <Button size="sm" icon="edit" onClick={onEdit}>Uredi</Button> : null}
      </div>
      <div className="stack" style={{ gap: 4 }}>
        <h2 className="h-title">{titleOf(r)}{r.qty > 1 ? ' ×' + fmtQty(r.qty) : ''}</h2>
        {r.code ? <StockPill art={art} qty={r.qty} /> : null}
      </div>
      <dl className="dl">
        <div><dt>P/N</dt><dd>{r.pn || '—'}</dd></div>
        <div><dt>Kataloški broj</dt><dd>{r.code || '—'}</dd></div>
        <div><dt>Količina</dt><dd>{fmtQty(r.qty)}</dd></div>
        <div><dt>Detalji o kupcu</dt><dd>{r.customer || '—'}</dd></div>
        <div style={{ gridColumn: '1 / -1' }}><dt>Pitanje / zahtjev</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{r.question || '—'}</dd></div>
        <div style={{ gridColumn: '1 / -1' }}><dt>Pitao/la</dt><dd className="row" style={{ gap: 8 }}><Avatar name={r.createdBy?.name} small me={r.createdBy?.id === me.id} />{r.createdBy?.name} · {fmtWhen(r.createdAt)}</dd></div>
      </dl>

      <section className="answer-box" aria-label="Odgovor veleprodaje">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 className="h-heading">Odgovor veleprodaje</h3>
          {r.answeredAt ? <span className="small muted">{r.answeredBy?.name} · {fmtDate(r.answeredAt)} · {fmtWhen(r.answeredAt)}</span> : null}
        </div>
        {answerer && r.status !== 'zavrseno' ? (
          <>
            <label className="sr" htmlFor={'ans-' + r.id}>Odgovor</label>
            <textarea id={'ans-' + r.id} className="textarea" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Cijena, rok, detalji. Npr. 82X3003HMX, u dolasku za 15 dana, 1570 KM" />
            <div className="row">
              <Button variant="primary" icon="ok" busy={busy === 'dostupno'} disabled={!answer.trim()} onClick={() => save({ answer, status: 'dostupno' }, 'Odgovor poslan: dostupno', 'dostupno')}>Dostupno</Button>
              <Button icon="ban" busy={busy === 'nije'} disabled={!answer.trim()} onClick={() => save({ answer, status: 'nije_dostupno' }, 'Odgovor poslan: nije dostupno', 'nije')}>Nije dostupno</Button>
              <span className="small muted">Datum odgovora se upiše sam.</span>
            </div>
          </>
        ) : r.answer ? <p style={{ whiteSpace: 'pre-wrap' }}>{r.answer}</p> : <p className="muted">Još nema odgovora. Veleprodaja je obaviještena.</p>}
      </section>

      <div className="row">
        {r.status === 'dostupno' && can(me.role, 'prijenosnice') ? <Button icon="truck" onClick={() => setFollow('transfer')}>Napravi prijenosnicu</Button> : null}
        {r.status === 'dostupno' && can(me.role, 'rezervacije') ? <Button icon="laptop" onClick={() => setFollow('reservation')}>Rezerviši</Button> : null}
        {r.status !== 'zavrseno' && r.status !== 'novi' ? <Button variant="primary" icon="check" busy={busy === 'done'} onClick={() => save({ status: 'zavrseno' }, 'Upit završen', 'done')}>Završeno</Button> : null}
        {r.status === 'zavrseno' ? <Button icon="undo" busy={busy === 'again'} onClick={() => save({ status: 'novi' }, 'Upit ponovo čeka odgovor', 'again')}>Pitaj ponovo</Button> : null}
      </div>

      <Comments comments={r.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />
      {r.history?.length ? (
        <details className="more">
          <summary><Icon name="history" size={16} />Historija · {r.history.length}</summary>
          <ul className="history">{[...r.history].reverse().map((h, i) => <li key={i}>{fmtWhen(h.at)} · {h.by}: {h.text}</li>)}</ul>
        </details>
      ) : null}

      {follow === 'transfer' ? (
        <TransferForm onClose={() => setFollow(null)} preset={{ from: vp?.id, to: mp?.id, note: `Za upit ${r.number}${r.customer ? ' · ' + r.customer : ''}`, items: [{ code: r.code, name: r.name || r.pn, qty: r.qty || 1, auto: false }] }} />
      ) : null}
      {follow === 'reservation' ? (
        <ReservationForm onClose={() => setFollow(null)} preset={{ model: r.name || r.pn, code: r.code, qty: r.qty || 1, customerText: r.customer, purpose: `Upit ${r.number}: ${r.answer}`.slice(0, 600) }} />
      ) : null}
    </div>
  );
}

export function RequestForm({ r, onClose }) {
  const { reload, toast, go, today } = useApp();
  const edit = !!r;
  const [f, setF] = useState(() => (r ? { ...r, qty: String(r.qty ?? 1) } : { date: today, pn: '', code: '', name: '', qty: '1', customer: '', question: '' }));
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const art = useArticle(f.code);

  const onCode = async (code) => {
    set('code', code);
    const a = await lookupCode(code);
    if (a && (!f.name || auto)) { set('name', a.name); setAuto(true); }
  };
  const submit = async (e) => {
    e?.preventDefault();
    setErr(null);
    if (!f.name.trim() && !f.code.trim() && !f.pn.trim() && !f.question.trim()) { setErr('Upiši artikal ili pitanje.'); return; }
    setBusy(true);
    const payload = { date: f.date, pn: f.pn, code: f.code, name: f.name, qty: parseMoney(f.qty) ?? 1, customer: f.customer, question: f.question };
    try {
      const res = edit ? await api('PATCH', '/api/requests/' + r.id, payload) : await api('POST', '/api/requests', payload);
      toast(edit ? 'Sačuvano' : `Upit ${res.request.number} je poslan veleprodaji`);
      reload();
      onClose();
      if (!edit) go('upiti', res.request.id);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Obrisati ${r.number}?`)) return;
    try { await api('DELETE', '/api/requests/' + r.id); toast('Obrisano'); reload(); onClose(); go('upiti'); }
    catch (e2) { setErr(e2.message); }
  };

  return (
    <Sheet title={edit ? 'Uredi ' + r.number : 'Novi upit'} onClose={onClose}
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon={edit ? 'check' : 'send'} busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Pošalji upit'}</Button>
      </>}>
      <form className="stack" style={{ gap: 16 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <div className="field">
          <label className="field-label" htmlFor="rq-name">Artikal</label>
          <ArticleNameInput id="rq-name" placeholder="Npr. ThinkBook 16 G8, USB-C punjač 95W" value={f.name}
            onChange={(v) => { set('name', v); setAuto(false); }} onPick={(a) => { setF((x) => ({ ...x, code: a.code, name: a.name })); setAuto(true); }} autoFocus={!edit} />
        </div>
        <div className="grid3">
          <div className="field">
            <label className="field-label" htmlFor="rq-code">Kataloški broj (šifra)</label>
            <input id="rq-code" className="input num" value={f.code} onChange={(e) => onCode(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rq-pn">P/N</label>
            <input id="rq-pn" className="input" value={f.pn} onChange={(e) => set('pn', e.target.value)} placeholder="Npr. 21SK0076SC" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rq-qty">Količina</label>
            <input id="rq-qty" className="input num" inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value)} />
          </div>
        </div>
        {f.code ? <StockPill art={art} qty={parseMoney(f.qty)} /> : null}
        <div className="field">
          <label className="field-label" htmlFor="rq-q">Pitanje / zahtjev</label>
          <textarea id="rq-q" className="textarea" rows={3} value={f.question} onChange={(e) => set('question', e.target.value)} placeholder="Npr. najjeftiniji laptop s OLED ekranom, treba do ponedjeljka" />
        </div>
        <div className="grid2">
          <div className="field">
            <label className="field-label" htmlFor="rq-cust">Detalji o kupcu</label>
            <input id="rq-cust" className="input" value={f.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Ime i telefon" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="rq-date">Datum</label>
            <input id="rq-date" type="date" className="input" value={f.date} onChange={(e) => set('date', e.target.value || today)} />
          </div>
        </div>
        {!edit ? <Note icon="bell">Veleprodaja dobija obavijest. Kad odgovori, ti dobiješ obavijest s odgovorom.</Note> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
