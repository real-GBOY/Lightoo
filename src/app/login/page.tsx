'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from '@/lib/client/api';
import { Button, Wordmark } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', json: { email, password } });
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach LIGHTOO. Check your connection.');
      setBusy(false);
    }
  }

  return (
    <main className="screen bare pad" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 28 }}>
      <Wordmark size={56} />
      <div>
        <h1 className="page-title" style={{ fontSize: 28 }}>Your new music, in one place.</h1>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.5, margin: '10px 0 0' }}>
          LIGHTOO watches the Spotify playlists you choose and keeps a record of every new track it finds.
        </p>
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-2)', lineHeight: 1.7 }}>
        <li>Connect Spotify</li><li>Pick playlists to watch</li><li>Open new finds in Spotify</li>
      </ol>
      <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
        <label className="field"><span className="sr">Email</span>
          <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field"><span className="sr">Password</span>
          <input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div role="alert" style={{ color: 'var(--error)', fontSize: 14 }}>{error}</div>}
        <Button variant="primary" type="submit" loading={busy}>Sign in</Button>
      </form>
    </main>
  );
}
