'use client';
// Loads everything once, then asks the server every 20 seconds whether anything changed (one cheap request;
// the full data only comes back when something did). Paused while the tab is hidden.
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 20000;

export async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (r.status === 401) { window.location.href = '/login'; throw new Error('Prijavi se ponovo.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || 'Nije uspjelo. Pokušaj ponovo.');
  return j;
}

export function useData() {
  const [data, setData] = useState(null);
  const [online, setOnline] = useState(true);
  const ver = useRef(null);
  const busy = useRef(false);

  const load = useCallback(async (force) => {
    if (busy.current && !force) return;
    busy.current = true;
    try {
      const q = !force && ver.current != null ? '?ver=' + ver.current : '';
      const r = await fetch('/api/data' + q, { cache: 'no-store' });
      if (r.status === 401) { window.location.href = '/login'; return; }
      if (!r.ok) throw new Error('bad');
      const j = await r.json();
      setOnline(true);
      if (j.same) return;
      ver.current = j.ver;
      setData({ ...j, loadedAt: Date.now() });
    } catch {
      setOnline(false);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    load(true);
    const tick = () => { if (document.visibilityState === 'visible') load(false); };
    const iv = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(iv); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  // Show a change at once, before the server confirms it.
  const patch = useCallback((fn) => setData((d) => (d ? fn(structuredClone(d)) : d)), []);

  return { data, online, reload: () => load(true), patch };
}
