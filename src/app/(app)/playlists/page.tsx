'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { SyncBanners } from '@/components/common';
import { IcAlert, IcPlus, IcWifiOff } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { Artwork, Button, EmptyState, Sheet, timeAgo } from '@/components/ui';
import { ApiError, NetworkError, api } from '@/lib/client/api';
import { useResource } from '@/lib/client/hooks';
import type { PlaylistDTO } from '@/lib/client/types';

type Preview = { duplicate: true; playlistId: string } | { duplicate: false; name: string; ownerName: string | null; imageUrl: string | null; trackCount: number };

function statusText(p: PlaylistDTO, online: boolean): { text: string; tone?: 'error' } {
  if (p.source === 'IMPORT') return { text: `Imported ${timeAgo(p.lastSyncedAt)}` };
  if (!p.monitoring) return { text: 'Paused' };
  if (p.syncStatus === 'UNREADABLE') return { text: 'Can’t read tracks', tone: 'error' };
  if (p.syncStatus === 'FAILED') return { text: 'Check failed', tone: 'error' };
  if (p.syncStatus === 'RATE_LIMITED') return { text: 'Rate limited', tone: 'error' };
  if (!p.lastSyncedAt) return { text: 'Checking…' };
  return { text: `${online ? '' : 'Offline · '}${timeAgo(p.lastSyncedAt)}` };
}

function AddPlaylist({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, bump } = useApp();
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<'input' | 'checking' | 'preview' | 'adding'>('input');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [err, setErr] = useState<{ title: string; body: string } | null>(null);
  const [seed, setSeed] = useState(true);

  const reset = useCallback(() => { setUrl(''); setPhase('input'); setPreview(null); setErr(null); setSeed(true); }, []);
  useEffect(() => { if (!open) reset(); }, [open, reset]);

  async function check() {
    setErr(null);
    setPhase('checking');
    try {
      const p = await api<Preview>(`/api/playlists/preview?url=${encodeURIComponent(url.trim())}`);
      setPreview(p);
      setPhase('preview');
    } catch (e) {
      setPhase('input');
      if (e instanceof NetworkError) setErr({ title: 'You are offline', body: 'Connect to the internet to add a playlist.' });
      else if (e instanceof ApiError && e.code === 'playlist.invalid_link') setErr({ title: 'Not a playlist link', body: 'Paste a link like open.spotify.com/playlist/… or a spotify:playlist: URI.' });
      else if (e instanceof ApiError && e.code === 'playlist.wrong_type') setErr({ title: 'That is not a playlist', body: e.message });
      else if (e instanceof ApiError && e.code === 'spotify.unreadable') setErr({ title: 'Can’t read this playlist', body: 'Spotify only shares tracks for playlists you own or collaborate on. Private or Spotify-made playlists may be unavailable.' });
      else if (e instanceof ApiError && e.code === 'spotify.not_connected') setErr({ title: 'Spotify is not connected', body: 'Connect Spotify in Settings first.' });
      else setErr({ title: 'Could not check that playlist', body: e instanceof ApiError ? e.message : 'Try again.' });
    }
  }

  async function add() {
    setPhase('adding');
    try {
      const r = await api<{ playlist: { id: string }; sync: { newTracks: number; outcome: string; error?: string } }>('/api/playlists', { method: 'POST', json: { url: url.trim(), seedRecent: seed } });
      bump();
      onClose();
      if (r.sync.outcome === 'FAILED' || r.sync.outcome === 'UNREADABLE') toast('Added, but the first check failed. Retry from the playlist.');
      else toast(r.sync.newTracks > 0 ? `${r.sync.newTracks} ${r.sync.newTracks === 1 ? 'track' : 'tracks'} in New Music` : 'Playlist added. New tracks will appear here.', r.sync.newTracks > 0 ? { label: 'View', run: () => router.push('/') } : undefined);
    } catch (e) {
      setPhase('preview');
      toast(e instanceof ApiError ? e.message : 'Could not add the playlist.');
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Add playlist">
      <h2 style={{ margin: '8px 0 14px', fontSize: 22, letterSpacing: '-0.02em' }}>Add playlist</h2>
      {phase === 'preview' || phase === 'adding' ? (
        preview?.duplicate ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ color: 'var(--text-2)', margin: 0 }}>Already monitored. No need to add it again.</p>
            <Link className="btn secondary" style={{ color: 'var(--text)' }} href={`/playlists/${preview.playlistId}`} onClick={onClose}>Go to playlist</Link>
          </div>
        ) : preview ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <Artwork src={preview.imageUrl} name={preview.name} size={88} />
              <div><div style={{ fontSize: 18, fontWeight: 700 }}>{preview.name}</div><div className="meta">{preview.ownerName ? `by ${preview.ownerName} · ` : ''}{preview.trackCount} tracks</div></div>
            </div>
            <p style={{ color: 'var(--text-2)', margin: 0, lineHeight: 1.45 }}>
              Its current tracks become the starting point, so your inbox is not flooded. Only tracks added from now on count as new.
            </p>
            <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
              <span>Show the 10 most recent tracks in New Music</span>
            </label>
            <Button variant="primary" loading={phase === 'adding'} onClick={() => void add()}>Add playlist</Button>
          </div>
        ) : null
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void check(); }} style={{ display: 'grid', gap: 14 }}>
          <label className="field">
            <span className="sr">Playlist link</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a Spotify playlist link" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-invalid={!!err} />
            <button type="button" className="btn text" style={{ minHeight: 36 }} onClick={async () => { try { setUrl(await navigator.clipboard.readText()); } catch { /* denied */ } }}>Paste</button>
          </label>
          {err && (
            <div role="alert" style={{ display: 'flex', gap: 10, color: 'var(--text-2)' }}>
              <span style={{ color: 'var(--error)' }}><IcAlert size={18} /></span>
              <div><b style={{ color: 'var(--text)' }}>{err.title}</b><div style={{ fontSize: 14, marginTop: 2 }}>{err.body}</div></div>
            </div>
          )}
          {!err && <p className="meta" style={{ margin: 0, lineHeight: 1.5 }}>In Spotify: ••• → Share → Copy link to playlist.</p>}
          <Button variant="primary" type="submit" loading={phase === 'checking'} disabled={!url.trim()}>Check playlist</Button>
        </form>
      )}
    </Sheet>
  );
}

export default function PlaylistsPage() {
  const { online } = useApp();
  const player = usePlayer();
  const { data, loading, error, reload } = useResource<{ items: PlaylistDTO[] }>('/api/playlists');
  const [adding, setAdding] = useState(false);
  const items = data?.items ?? [];

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header">
        <h1 className="page-title">Playlists</h1>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <Link href="/import" className="btn text" style={{ minHeight: 44 }}>Import</Link>
          <button className="icon-btn accent" onClick={() => setAdding(true)} disabled={!online} aria-label="Add playlist"><IcPlus /></button>
        </div>
      </div>
      <SyncBanners playlistNames={Object.fromEntries(items.map((p) => [p.id, p.name]))} />
      {loading && !data ? (
        <div className="grid2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ aspectRatio: '1', borderRadius: 16 }} />)}</div>
      ) : error && !data ? (
        <EmptyState title="Could not load playlists" action={<Button onClick={reload}>Try again</Button>}>{online ? 'Something went wrong.' : 'You are offline and no playlists are stored on this device yet.'}</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState title="Add your first playlist" action={<div style={{ display: 'grid', gap: 10, width: '100%', maxWidth: 280 }}><Button variant="primary" onClick={() => setAdding(true)} disabled={!online}>Paste a link</Button><Link href="/import" className="btn secondary" style={{ color: 'var(--text)' }}>Import a data export</Link></div>}>
          LIGHTOO watches playlists you own or collaborate on, and records every new track it finds.
        </EmptyState>
      ) : (
        <div className="grid2">
          {items.map((p) => {
            const s = statusText(p, online);
            return (
              <Link key={p.id} href={`/playlists/${p.id}`} className="card" style={{ color: 'var(--text)' }}>
                <div style={{ position: 'relative' }}>
                  <Artwork src={p.imageUrl} name={p.name} size="fill" radius={10} />
                  {p.newCount > 0 && <span className="status new" style={{ position: 'absolute', top: 8, right: 8 }}>{p.newCount} new</span>}
                </div>
                <div className="title" style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <div className="mono" style={{ fontSize: 12, color: s.tone ? 'var(--error)' : 'var(--text-3)', display: 'flex', gap: 4, alignItems: 'center' }}>
                  {!online && <IcWifiOff size={12} />}{s.tone && <IcAlert size={12} />}{s.text}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <AddPlaylist open={adding} onClose={() => setAdding(false)} />
    </main>
  );
}
