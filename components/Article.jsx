'use client';
// Typing a šifra (article code) fills in the name and prices and shows the free VP stock, from the latest EKI EDI
// export (what the sheet's VLOOKUPs into ARTIKLI and STANJE did). Typing part of a name offers matching articles.
import { useEffect, useRef, useState } from 'react';
import { api } from '@/components/useData.js';
import { Tag, cx } from '@/components/ui.jsx';
import { stockLabel } from '@/lib/constants.js';
import { fmtQty, fmtMoney } from '@/lib/format.js';

const cache = new Map();
export async function lookupCode(code) {
  const k = String(code || '').trim().toLowerCase();
  if (!k) return null;
  if (!cache.has(k)) cache.set(k, api('GET', '/api/articles?code=' + encodeURIComponent(code)).then((r) => r.items[0] || null).catch(() => null));
  return cache.get(k);
}

/** The article for a code, looked up a moment after typing stops. undefined = not checked yet, null = not found. */
export function useArticle(code) {
  const [art, setArt] = useState(undefined);
  useEffect(() => {
    if (!String(code || '').trim()) { setArt(undefined); return undefined; }
    let live = true;
    const h = setTimeout(() => { lookupCode(code).then((a) => { if (live) setArt(a); }); }, 350);
    return () => { live = false; clearTimeout(h); };
  }, [code]);
  return art;
}

/** "Na stanju · VP 7 (2 rez.)" */
export function StockPill({ art, qty, compact }) {
  if (art === undefined) return null;
  if (art === null) return <Tag tone="plain">Nema u izvozu</Tag>;
  const s = stockLabel(art.free, qty);
  return (
    <span className="row" style={{ gap: 6 }}>
      <Tag tone={s.tone}>{s.label}</Tag>
      {!compact ? <span className="small muted">VP {fmtQty(art.qty)}{art.reserved ? ` (${fmtQty(art.reserved)} rez.)` : ''}{art.sell != null ? ' · ' + fmtMoney(art.sell) : ''}</span> : null}
    </span>
  );
}

/** A name field that suggests articles from the stock export; picking one fills in the code too. */
export function ArticleNameInput({ id, value, onChange, onPick, placeholder, className, ...rest }) {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    const q = String(value || '').trim();
    if (!open || q.length < 3) { setList([]); return undefined; }
    let live = true;
    const h = setTimeout(() => { api('GET', '/api/articles?q=' + encodeURIComponent(q)).then((r) => { if (live) setList(r.items); }).catch(() => {}); }, 300);
    return () => { live = false; clearTimeout(h); };
  }, [value, open]);
  return (
    <div className="artpick" ref={box} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget)) setOpen(false); }}>
      <input id={id} className={cx('input', className)} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} {...rest} />
      {open && list.length ? (
        <div className="artpick-list" role="listbox">
          {list.map((a) => (
            <button key={a.code} type="button" role="option" aria-selected="false" className="artpick-opt" onClick={() => { onPick(a); setOpen(false); }}>
              <span className="grow"><strong>{a.name || a.code}</strong><span className="small muted"> · {a.code}</span></span>
              <span className="small muted">VP {fmtQty(a.free)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
