'use client';
// Prijem: WooCommerce orders and emails that arrived on their own. Accept one and it becomes an order (task).
import { useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Sheet, Tag, Comments, Empty, Note, cx } from '@/components/ui.jsx';
import { fmtWhen, fmtMoney, fmtQty } from '@/lib/format.js';

export function InboxActions({ item, compact }) {
  const { reload, toast, go, data } = useApp();
  const [busy, setBusy] = useState(null);
  const act = async (action) => {
    setBusy(action);
    try {
      const r = await api('POST', '/api/inbox/' + item.id, { action });
      reload();
      if (action === 'accept') { toast(`Napravljena ${r.task.number}`); go('zadaci', r.task.id); }
      else toast(action === 'dismiss' ? 'Odbačeno' : 'Vraćeno u prijem');
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(null);
  };
  if (item.status === 'novo') {
    return (
      <div className="row">
        <Button variant="primary" size={compact ? 'sm' : undefined} icon={compact ? undefined : 'check'} busy={busy === 'accept'} onClick={() => act('accept')}>Prihvati kao zadatak</Button>
        <Button size={compact ? 'sm' : undefined} busy={busy === 'dismiss'} onClick={() => act('dismiss')}>Odbaci</Button>
      </div>
    );
  }
  const task = item.taskId ? data.tasks.find((t) => t.id === item.taskId) : null;
  return (
    <div className="row">
      {task ? <Button size={compact ? 'sm' : undefined} icon="tasks" onClick={() => go('zadaci', task.id)}>Otvori {task.number}</Button> : null}
      {item.status === 'odbaceno' ? <Button size={compact ? 'sm' : undefined} icon="undo" busy={busy === 'restore'} onClick={() => act('restore')}>Vrati u prijem</Button> : null}
    </div>
  );
}

const STATUS_TAG = {
  novo: <Tag tone="info" icon="new">Novo</Tag>,
  prihvaceno: <Tag tone="ok" icon="check">Prihvaćeno</Tag>,
  odbaceno: <Tag tone="plain" icon="ban">Odbačeno</Tag>,
};

export default function InboxPage() {
  const { data, me, route, go } = useApp();
  const [status, setStatus] = useState('novo');
  const list = data.inbox.filter((x) => status === 'sve' || x.status === status);
  const selected = route.arg ? data.inbox.find((x) => x.id === route.arg) : null;
  const { woo, email } = data.integrations;

  return (
    <main className="page">
      <PageHead title="Prijem" lead="Web narudžbe i emailovi stižu ovdje sami. Prihvati ih kao zadatak ili odbaci.">
        <Segmented label="Status" value={status} onChange={setStatus} options={[
          { value: 'novo', label: 'Novo', count: data.inbox.filter((x) => x.status === 'novo').length },
          { value: 'prihvaceno', label: 'Prihvaćeno' },
          { value: 'odbaceno', label: 'Odbačeno' },
          { value: 'sve', label: 'Sve' },
        ]} />
      </PageHead>

      {!woo || !email ? (
        <Note icon="plug">
          {!woo && !email ? 'Web shop i email još nisu povezani.' : !woo ? 'Web shop (WooCommerce) još nije povezan.' : 'Email još nije povezan.'}{' '}
          {me.role === 'admin' ? <button type="button" className="btn btn-quiet btn-sm" style={{ display: 'inline-flex', minHeight: 28 }} onClick={() => go('postavke', 'integracije')}>Kako povezati</button> : 'Administrator ih povezuje u Postavkama.'}
        </Note>
      ) : null}

      <section className="card" aria-label="Lista">
        {list.length === 0 ? <Empty>{status === 'novo' ? 'Ništa ne čeka.' : 'Ovdje nema ništa.'}</Empty> : (
          <div className="rows">
            {list.map((x) => (
              <div key={x.id} className="rowlink" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <button type="button" className="rowlink-main" style={{ all: 'unset', flex: 1, minWidth: 240, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6 }} onClick={() => go('prijem', x.id)}>
                  <span className="row small muted">
                    <Icon name={x.source === 'web' ? 'globe' : 'mail'} size={16} />
                    <span>{x.source === 'web' ? 'Web shop' + (x.order?.number ? ' #' + x.order.number : '') : 'Email'}</span>
                    <span>· {x.from?.name || x.from?.email}</span>
                    <span>· {fmtWhen(x.receivedAt)}</span>
                    {status === 'sve' ? STATUS_TAG[x.status] : null}
                  </span>
                  <span className="rowlink-title">{x.title}</span>
                  {x.order ? <span className="rowlink-meta">{[x.order.total != null && fmtMoney(x.order.total, x.order.currency), x.order.payment].filter(Boolean).join(' · ')}</span>
                    : <span className="rowlink-meta">{x.body.slice(0, 140)}{x.body.length > 140 ? '…' : ''}</span>}
                </button>
                <div style={{ alignSelf: 'center' }}><InboxActions item={x} compact /></div>
              </div>
            ))}
          </div>
        )}
      </section>

      {selected ? <InboxDetail item={selected} onClose={() => go('prijem')} /> : null}
      {route.arg && !selected ? <Sheet title="Ne postoji" onClose={() => go('prijem')}><p>Ova stavka više nije u prijemu.</p></Sheet> : null}
    </main>
  );
}

function InboxDetail({ item: x, onClose }) {
  const { data, me, reload, toast } = useApp();
  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'inbox', id: x.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'inbox', id: x.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const o = x.order;
  return (
    <Sheet title={x.source === 'web' ? 'Web narudžba' + (o?.number ? ' #' + o.number : '') : 'Email'} onClose={onClose} wide>
      <div className="row">{STATUS_TAG[x.status]}<span className="small muted">{fmtWhen(x.receivedAt)}</span></div>
      <h2 className="h-title">{x.title}</h2>
      <dl className="dl">
        <div><dt>Od</dt><dd style={{ fontWeight: 600 }}>{x.from?.name || '—'}</dd></div>
        <div><dt>Email</dt><dd>{x.from?.email ? <a href={'mailto:' + x.from.email}>{x.from.email}</a> : '—'}</dd></div>
        <div><dt>Telefon</dt><dd>{x.from?.phone || '—'}</dd></div>
        {o ? <div><dt>Ukupno</dt><dd style={{ fontWeight: 600 }}>{o.total != null ? fmtMoney(o.total, o.currency) : '—'}</dd></div> : null}
        {o?.payment ? <div><dt>Plaćanje</dt><dd>{o.payment}</dd></div> : null}
        {o?.shipping ? <div style={{ gridColumn: 'span 2' }}><dt>Dostava</dt><dd>{o.shipping}</dd></div> : null}
        {o?.status ? <div><dt>Status u shopu</dt><dd>{o.status}</dd></div> : null}
      </dl>
      {o?.items?.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="items">
            <thead><tr><th>Šifra</th><th>Naziv</th><th className="r">Kol.</th><th className="r">Cijena</th></tr></thead>
            <tbody>{o.items.map((i, n) => <tr key={n}><td className="small">{i.code || '—'}</td><td>{i.name}</td><td className="r">{fmtQty(i.qty)}</td><td className="r">{i.price != null ? fmtMoney(i.price, o.currency) : '—'}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {o?.customerNote ? <Note icon="chat">Napomena kupca: {o.customerNote}</Note> : null}
      {!o && x.body ? <div className={cx('well')} style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: '22px', maxHeight: 360, overflowY: 'auto' }}>{x.body}</div> : null}
      <div className="row">
        <InboxActions item={x} />
        {o?.url ? <a className="btn btn-quiet" href={o.url} target="_blank" rel="noreferrer">Otvori u WooCommerce<Icon name="external" size={16} /></a> : null}
      </div>
      <Comments comments={x.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />
    </Sheet>
  );
}
