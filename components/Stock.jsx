'use client';
// Zalihe: the newest EKI EDI export compared with the previous one (tick each row once the web shop has the new
// stock), and Artikli: the latest export as a list with what is reserved and what is free (the sheet's ARTIKLI/STANJE).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, PageHead } from '@/components/App.jsx';
import { api } from '@/components/useData.js';
import { Icon, Button, Segmented, Sheet, Tag, CheckBox, Comments, Empty, Note, cx } from '@/components/ui.jsx';
import { fmtWhen, fmtQty, fmtDelta, fmtDate, fmtTime, fmtMoney } from '@/lib/format.js';

async function readFileText(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1250').decode(buf); } // older Windows exports
}

const SOURCE_LABEL = { agent: 'poslao agent iz ureda', rucno: 'učitano ručno' };

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }

export default function Stock() {
  const [tab, setTab] = useState(() => read('stt_stock_tab') || 'promjene');
  const change = (v) => { setTab(v); try { localStorage.setItem('stt_stock_tab', v); } catch { /* private mode */ } };
  const tabs = <Segmented label="Prikaz" value={tab} onChange={change} options={[{ value: 'promjene', label: 'Promjene za web' }, { value: 'artikli', label: 'Artikli i stanje' }]} />;
  return tab === 'artikli' ? <Articles tabs={tabs} /> : <StockChanges tabs={tabs} />;
}

function Articles({ tabs }) {
  const { data } = useApp();
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => { api('GET', '/api/articles?all=1&q=' + encodeURIComponent(q)).then((r) => { if (live) setRes(r); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [q, data.stockLatest?.at, data.reservations]);
  return (
    <main className="page">
      <PageHead title="Artikli i stanje" lead="Zadnji izvoz iz EKI EDI: stanje u VP, koliko je rezervisano i koliko je slobodno. Odavde se popunjavaju šifre u prijenosnicama, upitima i rezervacijama.">
        <a className="btn" href="/api/export?what=artikli" download><Icon name="download" />CSV</a>
      </PageHead>
      {tabs}
      <div className="row" style={{ gap: 12 }}>
        <label className="search grow" style={{ maxWidth: 420 }}>
          <Icon name="search" size={18} />
          <span className="sr">Traži</span>
          <input className="input" type="search" placeholder="Traži šifru ili naziv" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {res?.stockAt ? <span className="small muted">{res.filename} · {fmtDate(res.stockAt)} {fmtTime(res.stockAt)} · {res.total} {q ? 'pronađeno' : 'artikala'}</span> : null}
      </div>
      {!res ? <p className="muted">Učitavam…</p> : !res.stockAt ? <Empty>Još nema izvoza zaliha. Učitaj CSV u kartici „Promjene za web” ili ga pošalje agent iz ureda.</Empty> : res.items.length === 0 ? <Empty>Ništa ne odgovara.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Šifra</th><th>Naziv artikla</th><th className="r">Stanje VP</th><th className="r">Rezervisano</th><th className="r">Slobodno</th><th className="r">Nabavna</th><th className="r">Prodajna</th></tr></thead>
            <tbody>
              {res.items.map((a) => (
                <tr key={a.code} className={a.free != null && a.free <= 0 ? 'is-done' : undefined}>
                  <td className="code">{a.code}</td>
                  <td>{a.name}</td>
                  <td className="r">{fmtQty(a.qty)}</td>
                  <td className="r">{a.reserved ? fmtQty(a.reserved) : ''}</td>
                  <td className="r"><strong>{fmtQty(a.free)}</strong></td>
                  <td className="r">{a.buy != null ? fmtMoney(a.buy, '') : ''}</td>
                  <td className="r">{a.sell != null ? fmtMoney(a.sell, '') : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {res && res.total > res.items.length ? <p className="small muted">Prikazano prvih {res.items.length} od {res.total}. Suzi pretragu ili preuzmi CSV.</p> : null}
    </main>
  );
}

function StockChanges({ tabs }) {
  const { data, me, route, go, reload, toast, patch } = useApp();
  const [full, setFull] = useState({}); // older exports loaded on demand
  const [filter, setFilter] = useState('todo');
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);

  const listed = route.arg ? data.stock.find((d) => d.id === route.arg) : data.stock[0];
  const diff = listed && !listed.changes ? full[listed.id] || null : listed;

  useEffect(() => {
    if (listed && !listed.changes && !full[listed.id]) {
      api('GET', '/api/stock/' + listed.id).then((r) => setFull((f) => ({ ...f, [listed.id]: r.diff }))).catch(() => {});
    }
  }, [listed, full]);

  const upload = async (file) => {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { toast('Izaberi CSV datoteku (izlaz iz skripte).', { error: true }); return; }
    setBusy(true);
    try {
      const text = await readFileText(file);
      const r = await api('POST', '/api/stock', { filename: file.name, text });
      if (r.unchanged) toast('Isti fajl kao prethodni. Nema promjena.');
      else {
        toast(r.diff.baseline ? 'Prvi izvoz je sačuvan kao osnova.' : `${r.diff.changes.length} promjena pronađeno.`);
        reload();
        go('zalihe', r.diff.id);
      }
    } catch (e) { toast(e.message, { error: true }); }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const changes = diff?.changes || [];
  const done = diff?.done || {};
  const doneCount = changes.filter((c) => done[c.key]).length;
  const rows = useMemo(() => changes.filter((c) => (filter === 'todo' ? !done[c.key] : filter === 'all' ? true : c.kind === filter)), [changes, done, filter]);

  const mark = async (keys, value) => {
    // Show it at once; the server copy follows.
    const id = diff.id;
    const apply = (d) => {
      for (const k of keys) { if (value) d.done[k] = { by: me.name, at: Date.now() }; else delete d.done[k]; }
    };
    if (full[id]) setFull((f) => { const d = structuredClone(f[id]); apply(d); return { ...f, [id]: d }; });
    else patch((d) => { const x = d.stock.find((s) => s.id === id); if (x) apply(x); return d; });
    try {
      const r = await api('PATCH', '/api/stock/' + id, { keys, done: value });
      if (full[id]) setFull((f) => ({ ...f, [id]: r.diff }));
      reload();
    } catch (e) { toast(e.message, { error: true }); reload(); }
  };

  const addComment = async (text) => {
    try { await api('POST', '/api/comments', { kind: 'stock', id: diff.id, text }); reload(); return true; }
    catch (e) { toast(e.message, { error: true }); return false; }
  };
  const delComment = async (commentId) => {
    try { await api('DELETE', '/api/comments', { kind: 'stock', id: diff.id, commentId }); reload(); }
    catch (e) { toast(e.message, { error: true }); }
  };

  const onDrop = (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files?.[0]); };

  return (
    <main className="page" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }} onDrop={onDrop}>
      <PageHead title="Promjene zaliha" lead="Novi izvoz iz EKI EDI uporeden s prethodnim. Označi red kad promijeniš stanje na web shopu.">
        {data.stock.length ? <Button icon="history" onClick={() => setHistory(true)}>Historija izvoza</Button> : null}
        <Button variant="primary" icon="upload" busy={busy} onClick={() => fileRef.current?.click()}>Učitaj CSV</Button>
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
      </PageHead>
      {tabs}

      {over ? <div className="dropzone is-over"><Icon name="upload" size={28} /><strong>Pusti CSV ovdje</strong></div> : null}

      {!listed ? (
        <div className="stack" style={{ gap: 16 }}>
          <div className={cx('dropzone', over && 'is-over')}>
            <Icon name="upload" size={28} />
            <strong style={{ color: 'var(--ink)' }}>Još nema nijednog izvoza</strong>
            <p style={{ maxWidth: 520 }}>Učitaj CSV koji pravi tvoja skripta iz PDF faktura (ili ga prevuci ovdje). Prvi izvoz postaje osnova, a svaki sljedeći se poredi s prethodnim.</p>
            <Button variant="primary" icon="upload" busy={busy} onClick={() => fileRef.current?.click()}>Učitaj CSV</Button>
          </div>
          <Note icon="phonebig">
            {data.integrations.agent ? 'Agent na računaru u uredu je podešen: čim se pojavi novi CSV, sam ga šalje ovdje.' : 'Može i bez ručnog učitavanja: mali program na računaru u uredu (agent/eki_sync.py) svake minute provjeri folder s izvozima i pošalje novi CSV. Uputstvo je u README.'}
          </Note>
        </div>
      ) : !diff ? <p className="muted">Učitavam izvoz…</p> : (
        <>
          <section className="compare" aria-label="Poređenje">
            <div className="card compare-files">
              {diff.prev ? (
                <>
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="label muted">Prethodni</span>
                    <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{diff.prev.filename}</span>
                    <span className="small muted">{fmtDate(diff.prev.at)} {fmtTime(diff.prev.at)} · {diff.prev.count} artikala</span>
                  </div>
                  <Icon name="arrow" className="muted" />
                </>
              ) : null}
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="label muted">{diff.prev ? 'Novi' : 'Osnova'}</span>
                <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{diff.next.filename}</span>
                <span className="small muted">{fmtDate(diff.next.at)} {fmtTime(diff.next.at)} · {diff.next.count} artikala · {SOURCE_LABEL[diff.next.source] || diff.next.by?.name}{diff.next.source === 'rucno' && diff.next.by?.name ? ' (' + diff.next.by.name + ')' : ''}</span>
              </div>
            </div>
            {!diff.baseline ? (
              <div className="compare-stats">
                <div className="mini-stat"><span className="stat-label">Količina</span><span className="stat-value">{diff.counts?.qty ?? 0}</span></div>
                <div className="mini-stat"><span className="stat-label">Novi artikli</span><span className="stat-value">{diff.counts?.new ?? 0}</span></div>
                <div className="mini-stat"><span className="stat-label">Nestali</span><span className="stat-value">{diff.counts?.removed ?? 0}</span></div>
                <div className="mini-stat mini-stat-light" style={{ gap: 8 }}>
                  <span className="stat-label">Na webu</span>
                  <span style={{ fontWeight: 600 }} className="num">{doneCount} od {changes.length}</span>
                  <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={changes.length} aria-valuenow={doneCount} aria-label="Ažurirano na webu"><div className="bar-fill" style={{ width: (changes.length ? (doneCount / changes.length) * 100 : 0) + '%' }} /></div>
                </div>
              </div>
            ) : null}
          </section>

          {diff.next.guessed ? <Note tone="accent" icon="alert">Nisam prepoznao nazive kolona, pa sam pogodio: šifra je prva kolona, količina „{diff.next.qtyCol}”. Ako nije tačno, administrator bira kolone u Postavkama → Zalihe.</Note> : null}
          {diff.baseline ? <Note icon="info">Ovo je prvi izvoz ({diff.next.count} artikala) i sačuvan je kao osnova. Sljedeći izvoz će se porediti s njim.</Note> : null}
          {!diff.baseline && changes.length === 0 ? <Note icon="ok">Nema promjena u odnosu na prethodni izvoz.</Note> : null}

          {changes.length ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <Segmented label="Prikaži" value={filter} onChange={setFilter} options={[
                  { value: 'todo', label: 'Nije na webu', count: changes.length - doneCount },
                  { value: 'all', label: 'Sve', count: changes.length },
                  { value: 'qty', label: 'Količina' },
                  { value: 'new', label: 'Novi' },
                  { value: 'removed', label: 'Nestali' },
                ]} />
                {rows.some((c) => !done[c.key]) ? <Button size="sm" icon="checkall" onClick={() => mark(rows.filter((c) => !done[c.key]).map((c) => c.key), true)}>Označi sve prikazane</Button> : null}
              </div>
              {rows.length === 0 ? <Empty>{filter === 'todo' ? 'Sve je ažurirano na webu.' : 'Ništa u ovoj grupi.'}</Empty> : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr><th style={{ width: 90 }}>Na webu</th><th>Šifra</th><th>Naziv</th><th className="r">Prije</th><th className="r">Sada</th><th>Razlika</th><th>Označio/la</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((c) => (
                        <tr key={c.key} className={done[c.key] ? 'is-done' : undefined}>
                          <td><CheckBox checked={!!done[c.key]} label={'Ažurirano na webu: ' + (c.name || c.key)} onChange={(v) => mark([c.key], v)} /></td>
                          <td className="code">{c.key}</td>
                          <td style={{ fontWeight: done[c.key] ? 400 : 600, minWidth: 200 }}>{c.name || '—'}</td>
                          <td className="r">{c.before == null ? '—' : fmtQty(c.before)}</td>
                          <td className="r" style={{ fontWeight: 700 }}>{c.after == null ? '—' : fmtQty(c.after)}</td>
                          <td>
                            {c.kind === 'new' ? <Tag tone="info" icon="plus">Novi artikal</Tag>
                              : c.kind === 'removed' ? <Tag tone="wait" icon="minus">Nestao</Tag>
                                : <span className="delta"><Icon name={c.delta > 0 ? 'up' : 'down'} size={16} strokeWidth={2.5} />{fmtDelta(c.delta)}</span>}
                          </td>
                          <td className="small muted">{done[c.key] ? done[c.key].by : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}

          <p className="small muted">Kolone: šifra = „{diff.next.keyCol}”, količina = „{diff.next.qtyCol}”{diff.next.nameCol ? `, naziv = „${diff.next.nameCol}”` : ''}. Isti artikal u više redova se sabira.</p>

          <div className="card card-pad">
            <Comments comments={diff.comments} me={me} users={data.users} onAdd={addComment} onDelete={delComment} placeholder="Npr. P2425H nije na webu, provjeriti cijenu" />
          </div>
        </>
      )}

      {history ? (
        <Sheet title="Historija izvoza" onClose={() => setHistory(false)} flush>
          <div className="rows">
            {data.stock.map((d) => {
              const n = d.changes ? d.changes.length : (d.counts ? d.counts.qty + d.counts.new + d.counts.removed : 0);
              return (
                <button key={d.id} type="button" className="rowlink" onClick={() => { setHistory(false); go('zalihe', d.id); }}>
                  <span className="rowlink-main">
                    <span className="rowlink-title">{d.next.filename}</span>
                    <span className="rowlink-meta">{fmtWhen(d.at)} · {d.baseline ? 'osnova' : n + ' promjena'} · {SOURCE_LABEL[d.next.source] || ''}</span>
                  </span>
                  {d.id === diff?.id ? <Tag tone="accent">Otvoreno</Tag> : null}
                </button>
              );
            })}
          </div>
        </Sheet>
      ) : null}
    </main>
  );
}
