'use client';
// Prijem: WordPress/WooCommerce orders and emails, sorted into orders, customers' emails and the rest.
// An order becomes an order (task); a customer's email becomes a task to answer it, or goes onto the order it is
// about; anything else is marked done or dismissed.
import { useMemo, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Sheet, Tag, Comments, Empty, Note, cx } from '@/components/ui.jsx';
import ShopOrderPanel from '@/components/ShopOrder.jsx';
import { INBOX_KIND, isOpenTask, can } from '@/lib/constants.js';
import { fmtWhen, fmtMoney, fmtQty, fold, preview, taskDate, fmtDate } from '@/lib/format.js';

export function KindTag({ item }) {
  const k = INBOX_KIND[item.kind || (item.source === 'web' ? 'narudzba' : 'upit')];
  return <Tag tone={k.tone} icon={k.icon}>{item.source === 'web' ? (item.shopName || 'Web narudžba') : k.label}</Tag>;
}

const STATUS_TAG = {
  novo: <Tag tone="info" icon="new">Novo</Tag>,
  prihvaceno: <Tag tone="ok" icon="check">Prihvaćeno</Tag>,
  rijeseno: <Tag tone="ok" icon="check">Riješeno</Tag>,
  odbaceno: <Tag tone="plain" icon="ban">Odbačeno</Tag>,
};

export function InboxActions({ item, compact, onAttach }) {
  const { reload, toast, go, data } = useApp();
  const [busy, setBusy] = useState(null);
  const [picker, setPicker] = useState(false);
  const act = async (action, extra = {}) => {
    setBusy(action + (extra.as || ''));
    try {
      const r = await api('POST', '/api/inbox/' + item.id, { action, ...extra });
      reload();
      if (action === 'accept') { toast(`Napravljena ${r.task.number}`); go('zadaci', r.task.id); }
      else toast({ resolve: 'Označeno kao riješeno', dismiss: 'Odbačeno', restore: 'Vraćeno u prijem' }[action] || 'Sačuvano');
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(null);
  };
  const size = compact ? 'sm' : undefined;
  const kind = item.kind || (item.source === 'web' ? 'narudzba' : 'upit');

  if (item.status === 'novo') {
    return (
      <div className="row">
        {kind === 'narudzba' ? (
          <>
            <Button variant="primary" size={size} icon={compact ? undefined : 'check'} busy={busy === 'accept'} onClick={() => act('accept', { as: 'narudzba' })}>Prihvati kao narudžbu</Button>
            {!compact && item.source !== 'web' ? <Button size={size} icon="attach" onClick={() => (onAttach ? onAttach() : setPicker(true))}>Dodaj u narudžbu</Button> : null}
            <Button size={size} busy={busy === 'dismiss'} onClick={() => act('dismiss')}>Odbaci</Button>
          </>
        ) : kind === 'upit' ? (
          <>
            <Button variant="primary" size={size} icon={compact ? undefined : 'tasks'} busy={busy === 'acceptzadatak'} onClick={() => act('accept', { as: 'zadatak' })}>Napravi zadatak</Button>
            <Button size={size} icon={compact ? undefined : 'attach'} onClick={() => (onAttach ? onAttach() : setPicker(true))}>Dodaj u narudžbu</Button>
            {!compact ? <Button size={size} icon="cart" busy={busy === 'acceptnarudzba'} onClick={() => act('accept', { as: 'narudzba' })}>Nova narudžba</Button> : null}
            <Button size={size} variant="quiet" busy={busy === 'resolve'} onClick={() => act('resolve')}>Riješeno</Button>
          </>
        ) : (
          <>
            <Button variant="primary" size={size} icon={compact ? undefined : 'tasks'} busy={busy === 'acceptzadatak'} onClick={() => act('accept', { as: 'zadatak' })}>Napravi zadatak</Button>
            {!compact ? <Button size={size} icon="cart" busy={busy === 'acceptnarudzba'} onClick={() => act('accept', { as: 'narudzba' })}>Nova narudžba</Button> : null}
            <Button size={size} variant="quiet" busy={busy === 'dismiss'} onClick={() => act('dismiss')}>Odbaci</Button>
          </>
        )}
        {picker ? <AttachPicker item={item} onClose={() => setPicker(false)} /> : null}
      </div>
    );
  }
  const task = item.taskId ? data.tasks.find((t) => t.id === item.taskId) : null;
  return (
    <div className="row">
      {task ? <Button size={size} icon="tasks" onClick={() => go('zadaci', task.id)}>Otvori {task.number}</Button> : null}
      <Button size={size} icon="undo" busy={busy === 'restore'} onClick={() => act('restore')}>Vrati u prijem</Button>
    </div>
  );
}

/** Pick the order a customer's email is about. Orders from the same sender (email or phone) come first. */
function AttachPicker({ item, onClose }) {
  const { data, reload, toast, go } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const mail = fold(item.from?.email);
  const phone = String(item.from?.phone || '').replace(/\D/g, '').slice(-8);
  const same = (t) => (mail && fold(t.customer?.email) === mail) || (phone && String(t.customer?.phone || '').replace(/\D/g, '').endsWith(phone));
  const list = useMemo(() => {
    const f = fold(q);
    return data.tasks
      .filter((t) => !f || [t.number, t.title, t.customer?.name, t.customer?.email, t.customer?.phone].some((x) => fold(x).includes(f)))
      .sort((a, b) => Number(same(b)) - Number(same(a)) || Number(isOpenTask(b)) - Number(isOpenTask(a)) || (taskDate(a) < taskDate(b) ? 1 : -1))
      .slice(0, 40);
  }, [data.tasks, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const attach = async (t) => {
    setBusy(t.id);
    try {
      await api('POST', '/api/inbox/' + item.id, { action: 'attach', taskId: t.id });
      toast(`Email je dodan u ${t.number}`);
      reload();
      onClose();
      go('zadaci', t.id);
    } catch (e) { toast(e.message, { error: true }); setBusy(null); }
  };
  return (
    <Sheet title="Dodaj email u narudžbu" onClose={onClose} flush>
      <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }} className="stack">
        <p className="small muted" style={{ marginBottom: 10 }}>Email „{item.title}” ide kao komentar na narudžbu koju izabereš, pa ga vide svi koji je prate.</p>
        <label className="search">
          <Icon name="search" size={18} />
          <span className="sr">Traži narudžbu</span>
          <input className="input" type="search" autoFocus placeholder="Broj, kupac, telefon" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <div className="rows">
        {list.length === 0 ? <p className="muted" style={{ padding: 20 }}>Nema narudžbi koje odgovaraju.</p> : list.map((t) => (
          <button key={t.id} type="button" className="rowlink" disabled={!!busy} onClick={() => attach(t)}>
            <span className="rowlink-main">
              <span className="row"><span className="num-label">{t.number}</span>{same(t) ? <Tag tone="accent" icon="user">Isti kupac</Tag> : null}{!isOpenTask(t) ? <Tag tone="plain">Zatvorena</Tag> : null}</span>
              <span className="rowlink-title">{t.title}</span>
              <span className="rowlink-meta">{[t.customer?.name, fmtDate(taskDate(t))].filter(Boolean).join(' · ')}</span>
            </span>
            {busy === t.id ? <Icon name="sync" className="spin" /> : <Icon name="next" />}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export default function InboxPage() {
  const { data, me, route, go, reload, toast } = useApp();
  const [status, setStatus] = useState('novo');
  const [kind, setKind] = useState('sve');
  const [syncing, setSyncing] = useState(false);
  const canSync = can(me.role, 'webshop') && (data.shops || []).some((s) => s.api);
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api('POST', '/api/shops/sync');
      const added = r.result.reduce((n, x) => n + (x.added || 0), 0);
      const errs = r.result.filter((x) => x.error);
      toast(errs.length ? errs.map((x) => x.error).join(' ') : added ? `Dodano ${added} ${added === 1 ? 'narudžba' : 'narudžbi'} iz shopova.` : 'Nema novih narudžbi u shopovima.', { error: !!errs.length });
      reload();
    } catch (e) { toast(e.message, { error: true }); }
    setSyncing(false);
  };
  const kindOf = (x) => x.kind || (x.source === 'web' ? 'narudzba' : 'upit');
  const inStatus = data.inbox.filter((x) => status === 'sve' || x.status === status);
  const list = inStatus.filter((x) => kind === 'sve' || kindOf(x) === kind);
  const count = (k) => inStatus.filter((x) => kindOf(x) === k).length;
  const selected = route.arg ? data.inbox.find((x) => x.id === route.arg) : null;
  const { woo, email } = data.integrations;

  return (
    <main className="page">
      <PageHead title="Prijem" lead="Sve što stigne sa sajtova i emailom. Ti biraš šta postaje narudžba ili zadatak: narudžbu prihvati, a email pretvori u zadatak ili ga dodaj narudžbi na koju se odnosi.">
        {canSync ? <Button icon="sync" busy={syncing} onClick={sync}>Provjeri shopove</Button> : null}
        <Segmented label="Status" value={status} onChange={setStatus} options={[
          { value: 'novo', label: 'Novo', count: data.inbox.filter((x) => x.status === 'novo').length },
          { value: 'prihvaceno', label: 'Prihvaćeno' },
          { value: 'rijeseno', label: 'Riješeno' },
          { value: 'odbaceno', label: 'Odbačeno' },
          { value: 'sve', label: 'Sve' },
          ...((data.skipped || []).length || data.settings?.keepOther === false ? [{ value: 'preskoceno', label: 'Preskočeno', count: (data.skipped || []).length || undefined }] : []),
        ]} />
      </PageHead>

      {!woo || !email ? (
        <Note icon="plug">
          {!woo && !email ? 'Web shop i email još nisu povezani.' : !woo ? 'Web shop (WooCommerce) još nije povezan.' : 'Email još nije povezan.'}{' '}
          {me.role === 'admin' ? <button type="button" className="btn btn-quiet btn-sm" style={{ display: 'inline-flex', minHeight: 28 }} onClick={() => go('postavke', 'integracije')}>Kako povezati</button> : 'Administrator ih povezuje u Postavkama.'}
        </Note>
      ) : null}

      {status === 'preskoceno' ? <SkippedList /> : (
      <>
      <Segmented label="Vrsta" value={kind} onChange={setKind} options={[
        { value: 'sve', label: 'Sve', count: inStatus.length },
        { value: 'narudzba', label: 'Narudžbe', count: count('narudzba') },
        { value: 'upit', label: 'Upiti kupaca', count: count('upit') },
        ...(count('ostalo') || data.settings?.keepOther ? [{ value: 'ostalo', label: 'Ostalo', count: count('ostalo') }] : []),
      ]} />

      <section className="card" aria-label="Lista">
        {list.length === 0 ? <Empty>{status === 'novo' ? 'Ništa ne čeka.' : 'Ovdje nema ništa.'}</Empty> : (
          <div className="rows">
            {list.map((x) => (
              <div key={x.id} className="rowlink inbox-row">
                <button type="button" className="inbox-open" onClick={() => go('prijem', x.id)}>
                  <span className="row small muted">
                    <KindTag item={x} />
                    <span>{x.source === 'web' ? 'Web shop' + (x.order?.number ? ' #' + x.order.number : '') : x.from?.name || x.from?.email}</span>
                    <span>· {fmtWhen(x.receivedAt)}</span>
                    {status === 'sve' ? STATUS_TAG[x.status] : null}
                  </span>
                  <span className="rowlink-title">{x.title}</span>
                  {x.order ? (
                    <span className="rowlink-meta">{[x.from?.name, x.order.city, x.from?.phone, x.order.total != null && fmtMoney(x.order.total, x.order.currency), x.order.payment].filter(Boolean).join(' · ')}</span>
                  ) : <span className="rowlink-meta nbody nbody-2">{preview(x.body, 220)}</span>}
                </button>
                <div className="inbox-actions"><InboxActions item={x} compact /></div>
              </div>
            ))}
          </div>
        )}
      </section>

      </>
      )}

      {selected ? <InboxDetail item={selected} onClose={() => go('prijem')} /> : null}
      {route.arg && !selected ? <Sheet title="Ne postoji" onClose={() => go('prijem')}><p>Ova stavka više nije u prijemu.</p></Sheet> : null}
    </main>
  );
}

/** Emails that didn't enter Prijem (newsletters, suppliers, robots, ignored senders). Bring one back if it matters. */
function SkippedList() {
  const { data, reload, toast, go } = useApp();
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(null);
  const list = data.skipped || [];
  const restore = async (x, kind) => {
    setBusy(x.id + kind);
    try {
      const r = await api('POST', '/api/inbox/skipped', { id: x.id, kind, remember });
      toast(`Vraćeno u prijem${remember && x.from?.email ? `; emailovi od ${x.from.email} odsad idu pravo u ${INBOX_KIND[kind].plural}` : ''}.`);
      reload();
      if (r.item) go('prijem', r.item.id);
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(null);
  };
  return (
    <section className="stack" style={{ gap: 12 }}>
      <Note icon="info">Ovi emailovi nisu ušli u prijem jer nisu narudžbe ni upiti kupaca. Ako je neki ipak bitan, vrati ga. Čuva se zadnjih 200.</Note>
      <label className="checkrow"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Kad vratim email, zapamti pošiljaoca (njegovi emailovi odsad ulaze u prijem)</span></label>
      <div className="card">
        {list.length === 0 ? <Empty>Nema preskočenih emailova.</Empty> : (
          <div className="rows">
            {list.map((x) => (
              <div key={x.id} className="rowlink inbox-row">
                <div className="stack grow" style={{ gap: 4, minWidth: 260 }}>
                  <span className="row small muted"><Icon name="mail" size={16} /><span>{x.from?.name ? `${x.from.name} <${x.from.email}>` : x.from?.email}</span><span>· {fmtWhen(x.receivedAt || x.at)}</span></span>
                  <span className="rowlink-title">{x.title}</span>
                  <span className="rowlink-meta nbody nbody-2">{x.preview}</span>
                  <span className="small" style={{ color: 'var(--ink-muted)' }}><Icon name="ban" size={14} /> {x.reason}</span>
                </div>
                <div className="row inbox-actions">
                  <Button size="sm" busy={busy === x.id + 'upit'} onClick={() => restore(x, 'upit')}>Upit kupca</Button>
                  <Button size="sm" busy={busy === x.id + 'narudzba'} onClick={() => restore(x, 'narudzba')}>Narudžba</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InboxDetail({ item: x, onClose }) {
  const { data, me, reload, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'inbox', id: x.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'inbox', id: x.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const setKind = async (kind) => {
    setBusy(true);
    try {
      await api('POST', '/api/inbox/' + x.id, { action: 'kind', kind, remember });
      toast('Premješteno: ' + INBOX_KIND[kind].plural + (remember ? `. Isto i za sve buduće emailove od ${x.from.email}.` : ''));
      reload();
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
  };
  const ignoreSender = async () => {
    if (!confirm(`Nikad više ne prikazivati emailove od ${x.from.email}? (Idu u Preskočeno; pravilo se može obrisati u Postavkama.)`)) return;
    try { await api('POST', '/api/inbox/' + x.id, { action: 'ignoreSender' }); toast('Emailovi od ' + x.from.email + ' se više ne prikazuju.'); reload(); onClose(); }
    catch (e) { toast(e.message, { error: true }); }
  };
  const o = x.order;
  const kind = x.kind || (x.source === 'web' ? 'narudzba' : 'upit');
  return (
    <Sheet title={x.source === 'web' ? (x.shopName || 'Web narudžba') + (o?.number ? ' #' + o.number : '') : 'Email'} onClose={onClose} wide>
      <div className="row">
        {STATUS_TAG[x.status]}
        {x.source === 'web' ? <KindTag item={x} /> : null}
        <span className="small muted">{fmtWhen(x.receivedAt)}</span>
      </div>
      <h2 className="h-title">{x.title}</h2>
      {x.rule ? <p className="small muted">Razvrstano pravilom: sadrži „{x.rule.contains}”</p> : null}
      {x.source !== 'web' ? (
        <div className="field">
          <span className="field-label">Vrsta emaila</span>
          <Segmented label="Vrsta emaila" value={kind} onChange={(k) => !busy && k !== kind && setKind(k)} options={Object.entries(INBOX_KIND).map(([value, k]) => ({ value, label: k.label }))} />
          {x.from?.email ? (
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <label className="checkrow small"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Zapamti za sve emailove od {x.from.email}</span></label>
              <button type="button" className="btn btn-quiet btn-sm" onClick={ignoreSender}>Nikad od ovog pošiljaoca</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <dl className="dl">
        <div><dt>{o ? 'Kupac' : 'Od'}</dt><dd style={{ fontWeight: 600 }}>{x.from?.name || '—'}</dd></div>
        {o?.company ? <div><dt>Firma</dt><dd>{o.company}</dd></div> : null}
        <div><dt>Email</dt><dd>{x.from?.email ? <a href={'mailto:' + x.from.email + '?subject=' + encodeURIComponent('Re: ' + x.title)}>{x.from.email}</a> : '—'}</dd></div>
        <div><dt>Telefon</dt><dd>{x.from?.phone ? <a href={'tel:' + x.from.phone.replace(/[^\d+]/g, '')}>{x.from.phone}</a> : '—'}</dd></div>
        {x.from?.address ? <div style={{ gridColumn: 'span 2' }}><dt>Adresa</dt><dd>{x.from.address}</dd></div> : null}
        {o ? <div><dt>Ukupno</dt><dd style={{ fontWeight: 600 }}>{o.total != null ? fmtMoney(o.total, o.currency) : '—'}</dd></div> : null}
        {o?.payment ? <div><dt>Plaćanje</dt><dd>{o.payment}</dd></div> : null}
        {o?.shippingMethod ? <div><dt>Dostava</dt><dd>{o.shippingMethod}</dd></div> : null}
        {o?.status ? <div><dt>Status u shopu</dt><dd>{String(o.statusLabel || o.status).replace(/^./, (c) => c.toUpperCase())}</dd></div> : null}
        {x.orderRef && !o ? <div><dt>Broj narudžbe</dt><dd>#{x.orderRef}</dd></div> : null}
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
      {o?.note ? <Note tone="accent" icon="phone">{o.note}</Note> : null}
      {x.source === 'web' ? <ShopOrderPanel inboxId={x.id} shopName={x.shopName} /> : null}
      {!o && x.body ? <div className={cx('well')} style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: '22px', maxHeight: 420, overflowY: 'auto' }}>{x.body}</div> : null}
      <div className="row">
        <InboxActions item={x} />
        {x.from?.email && !o ? <a className="btn btn-quiet" href={'mailto:' + x.from.email + '?subject=' + encodeURIComponent('Re: ' + x.title)}>Odgovori emailom<Icon name="external" size={16} /></a> : null}
      </div>
      <Comments comments={x.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} />
      {x.history?.length ? (
        <details className="more">
          <summary><Icon name="history" size={16} />Historija · {x.history.length}</summary>
          <ul className="history">{[...x.history].reverse().map((h, i) => <li key={i}>{fmtWhen(h.at)} · {h.by}: {h.text}</li>)}</ul>
        </details>
      ) : null}
    </Sheet>
  );
}
