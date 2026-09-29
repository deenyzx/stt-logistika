'use client';
// Rezervacije laptopa: who reserved what, for whom and why, how it's paid, with comments. Everyone gets notified.
import { useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Chips, Input, Textarea, Sheet, ResTag, Avatar, Comments, Empty, Note, cx } from '@/components/ui.jsx';
import { RES_PURPOSE, PAYMENT, ROLES } from '@/lib/constants.js';
import { fmtDate, fmtDue, fmtWhen, fmtMoney, fold, addDaysISO, parseMoney } from '@/lib/format.js';

export default function Reservations() {
  const { data, me, route, go } = useApp();
  const [status, setStatus] = useState('aktivna');
  const [q, setQ] = useState('');
  const [form, setForm] = useState(null);
  const all = data.reservations;
  const count = (s) => all.filter((r) => r.status === s).length;

  const list = useMemo(() => {
    const f = fold(q);
    return all
      .filter((r) => status === 'sve' || r.status === status || (status === 'moje' && r.createdBy?.id === me.id))
      .filter((r) => !f || [r.number, r.model, r.code, r.customer?.name, r.customer?.phone, r.purpose, r.createdBy?.name].some((x) => fold(x).includes(f)))
      .sort((a, b) => (status === 'aktivna' ? (a.until || '9999') < (b.until || '9999') ? -1 : 1 : b.createdAt - a.createdAt));
  }, [all, status, q, me.id]);

  const selected = route.arg ? all.find((r) => r.id === route.arg) : null;

  return (
    <main className="page">
      <PageHead title="Rezervacije laptopa" lead="Ko je rezervisao, za koga i zašto. Svaka nova rezervacija stiže kao obavijest veleprodaji i maloprodaji.">
        <Button variant="primary" icon="plus" onClick={() => setForm('new')}>Nova rezervacija</Button>
      </PageHead>

      <div className="row" style={{ gap: 12 }}>
        <Segmented label="Status" value={status} onChange={setStatus} options={[
          { value: 'aktivna', label: 'Aktivne', count: count('aktivna') },
          { value: 'preuzeto', label: 'Preuzete' },
          { value: 'otkazana', label: 'Otkazane' },
          { value: 'moje', label: 'Moje' },
          { value: 'sve', label: 'Sve' },
        ]} />
        <label className="search grow" style={{ minWidth: 220, maxWidth: 360 }}>
          <Icon name="search" size={18} />
          <span className="sr">Traži</span>
          <input className="input" type="search" placeholder="Traži model, kupca, S/N" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {list.length === 0 ? <Empty>{status === 'aktivna' && !q ? 'Nema aktivnih rezervacija.' : 'Ništa ne odgovara.'}</Empty> : (
        <div className="rgrid">
          {list.map((r) => <ResCard key={r.id} r={r} onOpen={() => go('rezervacije', r.id)} />)}
        </div>
      )}

      {selected ? <ReservationDetail r={selected} onClose={() => go('rezervacije')} onEdit={() => setForm(selected)} /> : null}
      {route.arg && !selected ? <Sheet title="Ne postoji" onClose={() => go('rezervacije')}><p>Ova rezervacija je obrisana.</p></Sheet> : null}
      {form ? <ReservationForm r={form === 'new' ? null : form} onClose={() => setForm(null)} /> : null}
    </main>
  );
}

function ResCard({ r, onOpen }) {
  const { me, today } = useApp();
  const last = r.comments?.[r.comments.length - 1];
  return (
    <button type="button" className={cx('card rcard', r.status !== 'aktivna' && 'is-closed')} onClick={onOpen}>
      <span className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
        <span className="num-label">{r.number}</span>
        <ResTag r={r} today={today} />
      </span>
      <span className="stack" style={{ gap: 2 }}>
        <span className="h-heading">{r.model}</span>
        <span className="small muted">{[r.code && (r.code.length > 12 ? 'S/N ' : 'Šifra ') + r.code, (r.qty || 1) + ' kom', r.price != null && fmtMoney(r.price)].filter(Boolean).join(' · ')}</span>
      </span>
      <dl className="rcard-dl">
        <dt>Za koga</dt><dd>{[r.customer?.name, r.customer?.phone].filter(Boolean).join(' · ') || '—'}</dd>
        <dt>Svrha</dt><dd>{r.purpose || RES_PURPOSE[r.purposeType]}</dd>
        <dt>Plaćanje</dt><dd className="row" style={{ gap: 8 }}><span className="pay">{PAYMENT[r.payment]}</span>{r.deposit ? <span>avans {fmtMoney(r.deposit)}</span> : null}</dd>
        <dt>{r.status === 'preuzeto' ? 'Preuzeto' : 'Do'}</dt><dd>{r.status === 'preuzeto' ? fmtDate(r.closedAt) : r.until ? fmtDate(r.until) : 'Bez roka'}</dd>
      </dl>
      {last ? <span className="well" style={{ width: '100%' }}><strong>{last.by?.name}:</strong> {last.text.length > 110 ? last.text.slice(0, 110) + '…' : last.text}</span> : null}
      <span className="rcard-foot">
        <Avatar name={r.createdBy?.name} me={r.createdBy?.id === me.id} small />
        <span className="grow">{r.createdBy?.name} · {ROLES[r.createdBy?.role]?.short || ''} · {fmtWhen(r.createdAt)}</span>
        <span className="cc"><Icon name="chat" size={16} />{r.comments?.length || 0}</span>
      </span>
    </button>
  );
}

function ReservationDetail({ r, onClose, onEdit }) {
  const { data, me, reload, toast, today } = useApp();
  const [busy, setBusy] = useState(false);
  const save = async (patch, msg) => {
    setBusy(true);
    try { await api('PATCH', '/api/reservations/' + r.id, patch); toast(msg); reload(); }
    catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'reservation', id: r.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'reservation', id: r.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  return (
    <Sheet title={`${r.number} · ${r.model}`} onClose={onClose}>
      <div className="row"><ResTag r={r} today={today} /><span className="grow" /><Button icon="edit" size="sm" onClick={onEdit}>Uredi</Button></div>
      <div className="stack" style={{ gap: 2 }}>
        <h2 className="h-title">{r.model}{r.qty > 1 ? ' ×' + r.qty : ''}</h2>
        <span className="muted">{[r.code && 'Šifra / S/N ' + r.code, r.price != null && fmtMoney(r.price)].filter(Boolean).join(' · ')}</span>
      </div>
      <dl className="dl" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div><dt>Za koga</dt><dd style={{ fontWeight: 600 }}>{r.customer?.name || '—'}</dd></div>
        <div><dt>Telefon</dt><dd>{r.customer?.phone ? <a href={'tel:' + r.customer.phone.replace(/\s/g, '')}>{r.customer.phone}</a> : '—'}</dd></div>
        <div style={{ gridColumn: '1 / -1' }}><dt>Svrha</dt><dd><strong>{RES_PURPOSE[r.purposeType]}</strong>{r.purpose ? ' · ' + r.purpose : ''}</dd></div>
        <div><dt>Plaćanje</dt><dd className="row" style={{ gap: 8 }}><span className="pay">{PAYMENT[r.payment]}</span>{r.deposit ? 'avans ' + fmtMoney(r.deposit) : null}</dd></div>
        <div>
          <dt><label htmlFor={'until-' + r.id}>Rezervisano do</label></dt>
          <dd><input id={'until-' + r.id} type="date" className="input" style={{ minHeight: 40, padding: '6px 10px' }} value={r.until || ''} disabled={busy} onChange={(e) => save({ until: e.target.value || null }, e.target.value ? 'Produženo do ' + fmtDate(e.target.value) : 'Bez roka')} /></dd>
        </div>
        <div style={{ gridColumn: '1 / -1' }}><dt>Rezervisao/la</dt><dd className="row" style={{ gap: 8 }}><span className="ava ava-sm">{(r.createdBy?.name || '?').charAt(0)}</span>{r.createdBy?.name} · {ROLES[r.createdBy?.role]?.label || ''} · {fmtWhen(r.createdAt)}</dd></div>
      </dl>
      <div className="row">
        {r.status === 'aktivna' ? (
          <>
            <Button variant="primary" icon="check" busy={busy} onClick={() => save({ status: 'preuzeto' }, 'Označeno kao preuzeto')}>Kupac preuzeo</Button>
            <Button busy={busy} icon="calendar" onClick={() => save({ until: addDaysISO(r.until && r.until > today ? r.until : today, 3) }, 'Produženo za 3 dana')}>Produži 3 dana</Button>
            <Button variant="quiet" busy={busy} onClick={() => { if (confirm('Otkazati rezervaciju ' + r.number + '?')) save({ status: 'otkazana' }, 'Rezervacija otkazana'); }}>Otkaži</Button>
          </>
        ) : <Button icon="undo" busy={busy} onClick={() => save({ status: 'aktivna' }, 'Vraćeno u aktivne')}>Vrati u aktivne</Button>}
      </div>
      <Comments comments={r.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />
      {r.history?.length ? (
        <details className="more">
          <summary><Icon name="history" size={16} />Historija · {r.history.length}</summary>
          <ul className="history">{[...r.history].reverse().map((h, i) => <li key={i}>{fmtWhen(h.at)} · {h.by}: {h.text}</li>)}</ul>
        </details>
      ) : null}
    </Sheet>
  );
}

export function ReservationForm({ r, onClose }) {
  const { data, me, reload, toast, go, today } = useApp();
  const edit = !!r;
  const [f, setF] = useState(() => r ? { ...r, deposit: r.deposit ?? '', price: r.price ?? '' } : {
    model: '', code: '', qty: 1, price: '', customer: { name: '', phone: '' }, purposeType: 'prodaja', purpose: '',
    payment: 'nije_dogovoreno', deposit: '', until: addDaysISO(today, 3), comment: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const models = useMemo(() => [...new Set(data.reservations.map((x) => x.model))].slice(0, 50), [data.reservations]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.model.trim()) { setErr('Upiši koji laptop rezervišeš.'); return; }
    setBusy(true);
    const payload = {
      model: f.model, code: f.code, qty: f.qty, price: f.price === '' ? null : parseMoney(f.price), customer: f.customer,
      purposeType: f.purposeType, purpose: f.purpose, payment: f.payment, deposit: f.deposit === '' ? null : parseMoney(f.deposit),
      until: f.until || null, ...(edit ? {} : { comment: f.comment }),
    };
    try {
      const res = edit ? await api('PATCH', '/api/reservations/' + r.id, payload) : await api('POST', '/api/reservations', payload);
      toast(edit ? 'Sačuvano' : `Rezervacija ${res.reservation.number} je sačuvana. Kolege su obaviještene.`);
      reload();
      onClose();
      if (!edit) go('rezervacije', res.reservation.id);
    } catch (e2) { setErr(e2.message); setBusy(false); }
  };
  const remove = async () => {
    if (!confirm(`Obrisati ${r.number} zauvijek? Umjesto toga je možeš otkazati.`)) return;
    try { await api('DELETE', '/api/reservations/' + r.id); toast('Obrisano'); reload(); onClose(); go('rezervacije'); }
    catch (e2) { setErr(e2.message); }
  };

  return (
    <Sheet title={edit ? 'Uredi ' + r.number : 'Nova rezervacija'} onClose={onClose}
      footer={<>
        {edit ? <Button variant="danger" icon="trash" onClick={remove} style={{ marginRight: 'auto' }}>Obriši</Button> : null}
        <Button onClick={onClose}>Odustani</Button>
        <Button variant="primary" icon="check" busy={busy} onClick={submit}>{edit ? 'Sačuvaj' : 'Sačuvaj rezervaciju'}</Button>
      </>}>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
        <Input label="Laptop" value={f.model} onChange={(v) => set('model', v)} placeholder="Npr. Lenovo LOQ 15IRX9" list="res-models" autoFocus />
        <datalist id="res-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <div className="grid3">
          <Input label="Šifra / S/N" value={f.code} onChange={(v) => set('code', v)} />
          <Input label="Količina" value={f.qty} onChange={(v) => set('qty', v)} inputMode="numeric" className="num" />
          <Input label="Cijena (KM)" value={f.price} onChange={(v) => set('price', v)} inputMode="decimal" className="num" placeholder="Nije obavezno" />
        </div>
        <div className="grid2">
          <Input label="Za koga" value={f.customer.name} onChange={(v) => set('customer', { ...f.customer, name: v })} placeholder="Ime kupca ili firma" />
          <Input label="Telefon" type="tel" value={f.customer.phone} onChange={(v) => set('customer', { ...f.customer, phone: v })} />
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>Svrha rezervacije</legend>
          <Chips label="Svrha" value={f.purposeType} onChange={(v) => set('purposeType', v)} options={Object.entries(RES_PURPOSE).map(([value, label]) => ({ value, label }))} />
          <label className="sr" htmlFor="res-purpose">Opis svrhe</label>
          <textarea id="res-purpose" className="textarea" rows={2} style={{ marginTop: 8 }} value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="Npr. dolazi u petak da ga isproba, čeka odobrenje kredita" />
        </fieldset>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field-label" style={{ marginBottom: 8 }}>Način plaćanja</legend>
          <Chips grid label="Način plaćanja" value={f.payment} onChange={(v) => set('payment', v)} options={Object.entries(PAYMENT).map(([value, label]) => ({ value, label }))} />
        </fieldset>
        <div className="grid2">
          <Input label="Avans (KM)" value={f.deposit} onChange={(v) => set('deposit', v)} inputMode="decimal" className="num" placeholder="0,00" />
          <Input label="Rezervisano do" type="date" value={f.until || ''} onChange={(v) => set('until', v)} />
        </div>
        {!edit ? <Textarea label="Komentar" value={f.comment} onChange={(v) => set('comment', v)} rows={3} placeholder="Npr. kupac traži i torbu, zvati prije petka" /> : null}
        {!edit ? <Note icon="bell">Obavijest dobijaju veleprodaja i maloprodaja. Rezervacija se sprema pod tvojim imenom ({me.name}).</Note> : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
