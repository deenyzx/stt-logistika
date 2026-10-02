'use client';
// The order as the web shop (KupiLenovo, KupiTelevizor, …) sees it right now, and changing it there: status, and a
// note that can go to the customer by email from the shop.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Tag, Note, cx } from '@/components/ui.jsx';
import { can } from '@/lib/constants.js';
import { fmtWhen } from '@/lib/format.js';

const TONE = { completed: 'ok', poslano: 'ok', cancelled: 'danger', refunded: 'danger', failed: 'danger', pending: 'wait', 'on-hold': 'wait', processing: 'info' };

export default function ShopOrderPanel({ taskId, inboxId, shopName }) {
  const { me, toast, reload, go } = useApp();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [toCustomer, setToCustomer] = useState(false);
  const allowed = can(me.role, 'webshop');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = taskId ? 'taskId=' + encodeURIComponent(taskId) : 'inboxId=' + encodeURIComponent(inboxId);
      const r = await api('GET', '/api/shop-order?' + q);
      setInfo(r);
      setStatus('');
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [taskId, inboxId]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  if (!allowed) return null;

  const save = async () => {
    setBusy(true);
    try {
      const r = await api('POST', '/api/shop-order', { taskId, inboxId, orderId: info.order.id, status: status || undefined, note: note.trim() || undefined, customerNote: toCustomer });
      toast(`${info.shop.name}: ${status ? 'status je „' + r.statusLabel + '”' : 'napomena sačuvana'}${note.trim() && toCustomer ? ', kupac je dobio email' : ''}`);
      setNote('');
      setToCustomer(false);
      reload();
      await load();
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };

  const head = (
    <div className="row" style={{ justifyContent: 'space-between' }}>
      <span className="row" style={{ gap: 8 }}>
        <Icon name="globe" size={18} />
        <strong>{info?.shop?.name || shopName || 'Web shop'}{info?.order ? ' #' + info.order.number : ''}</strong>
        {info?.order ? <Tag tone={TONE[info.order.status] || 'plain'}>{info.order.statusLabel}</Tag> : null}
      </span>
      <span className="row" style={{ gap: 4 }}>
        {info?.order?.url ? <a className="btn btn-sm btn-quiet" href={info.order.url} target="_blank" rel="noreferrer">Otvori u shopu<Icon name="external" size={14} /></a> : null}
        <button type="button" className="iconbtn iconbtn-bare" aria-label="Osvježi iz shopa" title="Osvježi iz shopa" onClick={load} disabled={loading}><Icon name="sync" size={18} className={loading ? 'spin' : undefined} /></button>
      </span>
    </div>
  );

  return (
    <section className="shopbox" aria-label="Web shop">
      {head}
      {loading && !info ? <p className="small muted">Pitam shop…</p> : null}
      {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
      {info && !info.connected ? (
        <Note icon="plug">
          {info.reason === 'no_shop'
            ? `Narudžba je iz shopa ${info.shopName || shopName || ''}, ali taj shop još nije dodan u aplikaciju.`
            : `Za ${info.shop?.name} još nisu upisani API ključevi, pa se status ne može mijenjati odavde.`}
          {' '}{me.role === 'admin' ? <button type="button" className="btn btn-quiet btn-sm" style={{ display: 'inline-flex', minHeight: 28 }} onClick={() => go('postavke', 'shopovi')}>Postavke → Web shopovi</button> : 'Administrator to podešava u Postavkama.'}
        </Note>
      ) : null}
      {info?.connected ? (
        <>
          <div className="grid2">
            <div className="field">
              <label className="field-label" htmlFor={'st-' + (taskId || inboxId)}>Promijeni status u shopu</label>
              <select id={'st-' + (taskId || inboxId)} className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Ostavi „{info.order.statusLabel}”</option>
                {info.statuses.filter((s) => s.slug !== info.order.status).map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={'nt-' + (taskId || inboxId)}>Napomena (nije obavezna)</label>
              <input id={'nt-' + (taskId || inboxId)} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Npr. poslano brzom poštom, broj pošiljke…" maxLength={1000} />
            </div>
          </div>
          <label className="checkrow">
            <input type="checkbox" checked={toCustomer} onChange={(e) => setToCustomer(e.target.checked)} disabled={!note.trim()} />
            <span>Pošalji napomenu kupcu emailom (iz shopa)</span>
          </label>
          <div className="row">
            <Button variant="primary" icon="save" busy={busy} disabled={!status && !note.trim()} onClick={save}>Sačuvaj u shopu</Button>
            {info.order.modified ? <span className="small muted">Zadnja promjena u shopu: {fmtWhen(Date.parse(info.order.modified))}</span> : null}
          </div>
          {info.notes?.length ? (
            <details className="more">
              <summary><Icon name="history" size={16} />Napomene u shopu · {info.notes.length}</summary>
              <ul className="history">
                {info.notes.map((n) => (
                  <li key={n.id} className={cx(n.customer && 'is-customer')}>
                    {n.at ? fmtWhen(Date.parse(n.at)) + ' · ' : ''}{n.customer ? 'kupcu: ' : ''}{n.note}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
