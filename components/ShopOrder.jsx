'use client';
// The order as the web shop (KupiLenovo, KupiTelevizor, …) sees it right now, and the one change the app makes
// there: Procesuiranje → Završeno. Nothing else is sent to the shop or to the customer.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Tag, Note } from '@/components/ui.jsx';
import { can } from '@/lib/constants.js';
import { fmtWhen } from '@/lib/format.js';

const TONE = { completed: 'ok', cancelled: 'danger', refunded: 'danger', failed: 'danger', pending: 'wait', 'on-hold': 'wait', processing: 'info' };

export default function ShopOrderPanel({ taskId, inboxId, shopName }) {
  const { me, toast, reload, go } = useApp();
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const allowed = can(me.role, 'webshop');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = taskId ? 'taskId=' + encodeURIComponent(taskId) : 'inboxId=' + encodeURIComponent(inboxId);
      setInfo(await api('GET', '/api/shop-order?' + q));
    } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [taskId, inboxId]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  if (!allowed) return null;

  const complete = async () => {
    if (!confirm(`Promijeniti status narudžbe #${info.order.number} u shopu ${info.shop.name} iz „Procesuiranje” u „Završeno”?`)) return;
    setBusy(true);
    try {
      const r = await api('POST', '/api/shop-order', { taskId, inboxId, orderId: info.order.id });
      toast(`${info.shop.name} #${info.order.number}: ${r.statusLabel}`);
      reload();
      await load();
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };

  return (
    <section className="shopbox" aria-label="Web shop">
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
      {loading && !info ? <p className="small muted">Pitam shop…</p> : null}
      {err ? <Note tone="danger" icon="alert">{err}</Note> : null}
      {info && !info.connected ? (
        <Note icon="plug">
          {info.reason === 'no_shop'
            ? `Narudžba je iz shopa ${info.shopName || shopName || ''}, ali taj shop još nije dodan u aplikaciju.`
            : `Za ${info.shop?.name} još nije upisan API ključ, pa se status ne može vidjeti ni mijenjati odavde.`}
          {' '}{me.role === 'admin' ? <button type="button" className="btn btn-quiet btn-sm" style={{ display: 'inline-flex', minHeight: 28 }} onClick={() => go('postavke', 'shopovi')}>Postavke → Web shopovi</button> : 'Administrator to podešava u Postavkama.'}
        </Note>
      ) : null}
      {info?.connected ? (
        <div className="row">
          {info.canComplete ? <Button variant="primary" icon="checkall" busy={busy} onClick={complete}>Završeno u shopu</Button> : null}
          <span className="small muted grow" style={{ minWidth: 200 }}>
            {info.canComplete
              ? 'Mijenja samo status „Procesuiranje” → „Završeno”. Ništa drugo se ne šalje.'
              : 'Iz aplikacije se mijenja samo „Procesuiranje” → „Završeno”.'}
            {info.order.modified ? ` Zadnja promjena u shopu: ${fmtWhen(Date.parse(info.order.modified))}.` : ''}
          </span>
        </div>
      ) : null}
    </section>
  );
}
