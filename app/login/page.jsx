'use client';
import { useState } from 'react';
import { Wordmark, Input, Button, Icon } from '@/components/ui.jsx';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) { window.location.href = '/'; return; }
      setErr(j.error === 'not_configured' ? 'Server još nije podešen (ADMIN_PASSWORD u Vercelu).' : 'Pogrešno korisničko ime ili lozinka.');
    } catch {
      setErr('Nema veze sa serverom. Pokušaj ponovo.');
    }
    setBusy(false);
  }
  return (
    <main className="login">
      <div className="stack" style={{ gap: 16 }}>
        <Wordmark size="lg" />
        <p className="login-lead">Narudžbe, zadaci i rezervacije za veleprodaju i maloprodaju, dok ne pređemo na novi ERP.</p>
      </div>
      <form className="stack" style={{ gap: 20 }} onSubmit={submit}>
        {err ? <p className="login-err" role="alert"><Icon name="alert" size={18} />{err}</p> : null}
        <Input label="Korisničko ime" value={username} onChange={setUsername} autoComplete="username" autoCapitalize="none" autoFocus />
        <Input label="Lozinka" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <Button type="submit" variant="primary" size="lg" icon="lock" block busy={busy} disabled={!username || !password}>Prijavi se</Button>
      </form>
      <div className="login-foot">
        <span className="label">Pristup po odjelima</span>
        <div className="row">
          <span className="src" style={{ background: 'var(--band-raised)', color: 'var(--on-band)' }}>Veleprodaja</span>
          <span className="src" style={{ background: 'var(--band-raised)', color: 'var(--on-band)' }}>Maloprodaja</span>
          <span className="src" style={{ background: 'var(--band-raised)', color: 'var(--on-band)' }}>Administrator</span>
        </div>
        <p>Račun i lozinku dodjeljuje administrator u Postavkama.</p>
      </div>
    </main>
  );
}
