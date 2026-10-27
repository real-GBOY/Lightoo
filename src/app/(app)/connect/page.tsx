'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { Button, Wordmark } from '@/components/ui';

// Also the "Reconnect" screen (14i): same page, recovery copy when the sign-in expired.
export default function ConnectPage() {
  const { me, online } = useApp();
  const router = useRouter();
  const expired = me?.spotify.status === 'EXPIRED';
  useEffect(() => { if (me?.spotify.status === 'ACTIVE') router.replace('/'); }, [me, router]);

  return (
    <main className="screen bare pad" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingTop: 48 }}>
      <Wordmark size={32} />
      <div>
        <h1 className="page-title">{expired ? 'Reconnect Spotify' : 'Connect Spotify'}</h1>
        <p style={{ color: 'var(--text-2)', lineHeight: 1.5, marginTop: 10 }}>
          {expired ? 'Your Spotify sign-in expired or was revoked. Earlier finds are safe. Sign in again to resume checking your playlists.' : 'LIGHTOO signs in through Spotify. Your Spotify password never reaches LIGHTOO.'}
        </p>
      </div>
      <div className="list-group" style={{ margin: 0 }}>
        <div className="row"><div className="grow"><div className="title">What LIGHTOO will ask for</div><div className="sub">Read your playlists, including private and collaborative ones.</div></div></div>
        <div className="row"><div className="grow"><div className="title">What it will never do</div><div className="sub">Change playlists, follow artists, or play or download Spotify audio.</div></div></div>
      </div>
      <p className="meta" style={{ lineHeight: 1.5 }}>
        Spotify&apos;s developer rules only return a playlist&apos;s tracks if you own it or collaborate on it. Playlists you merely follow may not be readable.
      </p>
      <div style={{ marginTop: 'auto', display: 'grid', gap: 10 }}>
        <Button variant="primary" disabled={!online} onClick={() => { window.location.href = '/api/spotify/connect'; }}>
          {expired ? 'Reconnect with Spotify' : 'Continue with Spotify'}
        </Button>
        {!online && <span className="meta">You are offline. Connect when you have a network.</span>}
        <Link href="/import" className="btn secondary" style={{ color: 'var(--text)' }}>Import a Spotify data export instead</Link>
        <p className="meta" style={{ margin: 0, textAlign: 'center' }}>No live checks, but no Spotify connection or Premium needed.</p>
        <Link href="/" className="btn text" style={{ justifyContent: 'center' }}>Not now</Link>
      </div>
    </main>
  );
}
