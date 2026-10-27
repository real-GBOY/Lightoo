'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { GroupedFeed } from '@/components/common';
import { IcAlert, IcBack, IcExternal, IcRefresh } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { PlaylistLibrary } from '@/components/PlaylistLibrary';
import { SpotifyEmbed } from '@/components/SpotifyEmbed';
import { Artwork, Banner, Button, Dialog, EmptyState, RowSkeleton, timeAgo } from '@/components/ui';
import { ApiError, api } from '@/lib/client/api';
import { useFeed, useResource, useViewItems } from '@/lib/client/hooks';
import { spotifyPlaylistUrl, type PlaylistDTO } from '@/lib/client/types';

type Detail = PlaylistDTO & { syncRuns: { id: string; outcome: string; startedAt: string }[] };

export default function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { online, toast, bump, setTrackState } = useApp();
  const player = usePlayer();
  const pl = useResource<Detail>(`/api/playlists/${id}`);
  const list = useResource<{ items: PlaylistDTO[] }>('/api/playlists');
  const feed = useFeed(`scope=history&playlistId=${id}&limit=50`);
  const items = useViewItems(feed.items);
  const [checking, setChecking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [embed, setEmbed] = useState(false);
  const [view, setView] = useState<'finds' | 'all'>('all');
  const [link, setLink] = useState('');
  const [linkErr, setLinkErr] = useState<string | null>(null);
  const p = pl.data;
  const summary = list.data?.items.find((x) => x.id === id);

  async function check() {
    setChecking(true);
    try {
      const r = await api<{ outcome: string; newTracks: number; error?: string }>(`/api/playlists/${id}/sync`, { method: 'POST' });
      bump();
      toast(r.error ?? (r.newTracks ? `${r.newTracks} new ${r.newTracks === 1 ? 'track' : 'tracks'} found` : 'No changes'));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Still offline. Try again when you reconnect.');
    } finally { setChecking(false); }
  }

  async function saveLink() {
    setLinkErr(null);
    try {
      await api(`/api/playlists/${id}`, { method: 'PATCH', json: { spotifyLink: link.trim() } });
      setLink('');
      pl.reload();
      bump();
    } catch (e) {
      setLinkErr(e instanceof ApiError ? e.message : 'Could not save the link.');
    }
  }

  async function stop() {
    try {
      await api(`/api/playlists/${id}`, { method: 'DELETE' });
      bump();
      toast('Stopped monitoring. Earlier finds are kept in History.');
      router.replace('/playlists');
    } catch { toast('Could not stop monitoring. Try again.'); }
  }

  const imported = p?.source === 'IMPORT';
  const embedId = (p as (Detail & { embedId?: string | null }) | null)?.embedId ?? null;
  const failed = !imported && p && (p.syncStatus === 'FAILED' || p.syncStatus === 'UNREADABLE' || p.syncStatus === 'RATE_LIMITED');

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header" style={{ paddingBottom: 0 }}>
        <Link href="/playlists" className="back"><IcBack /> Playlists</Link>
      </div>
      {pl.loading && !p ? (
        <RowSkeleton n={4} />
      ) : !p ? (
        <EmptyState title="Playlist not found" action={<Link href="/playlists" className="btn secondary" style={{ color: 'var(--text)' }}>Back to playlists</Link>}>It may have been removed.</EmptyState>
      ) : (
        <>
          <div className="pad" style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '12px 20px 16px' }}>
            <Artwork src={p.imageUrl} name={p.name} size={124} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 24, letterSpacing: '-0.02em', lineHeight: 1.15 }}>{p.name}</h1>
              <div className="meta" style={{ marginTop: 4 }}>{p.ownerName ? `by ${p.ownerName}` : ''}</div>
              <div className="meta mono" style={{ marginTop: 6 }}>{imported ? `Imported ${timeAgo(p.lastSyncedAt)}` : p.monitoring ? `Checked ${timeAgo(p.lastSyncedAt)}` : 'Paused'}{summary && summary.newCount > 0 ? ` · ${summary.newCount} new` : ''}</div>
            </div>
          </div>
          {failed && (
            <Banner tone="error" title={p.syncStatus === 'UNREADABLE' ? 'Spotify will not return this playlist' : p.syncStatus === 'RATE_LIMITED' ? 'Spotify asked LIGHTOO to slow down' : 'The last check failed'}>
              {p.syncStatus === 'RATE_LIMITED' ? 'Wait a few minutes before checking again.' : 'Earlier discoveries are still below.'}
            </Banner>
          )}
          {imported ? (
            <div className="pad" style={{ display: 'grid', gap: 8, paddingBottom: 8 }}>
              <Link href="/import" className="btn secondary" style={{ color: 'var(--text)' }}>Import a newer export</Link>
              <p className="meta" style={{ margin: 0 }}>Loaded from a Spotify data export, so it updates when you import a newer one.</p>
            </div>
          ) : (
          <div className="pad" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, paddingBottom: 8 }}>
            <Button loading={checking} disabled={!online} onClick={() => void check()}><IcRefresh size={20} /> Check now</Button>
            <a className="btn secondary" href={spotifyPlaylistUrl(p.spotifyPlaylistId)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text)', ...(online ? {} : { opacity: 0.4, pointerEvents: 'none' }) }}>
              Open in Spotify <IcExternal size={20} />
            </a>
          </div>
          )}
          <div className="pad" style={{ display: 'flex', gap: 10, paddingBottom: 12 }}>
            {!imported && (
              <Button variant="text" onClick={async () => { await api(`/api/playlists/${id}`, { method: 'PATCH', json: { monitoring: !p.monitoring } }); pl.reload(); bump(); }}>
                {p.monitoring ? 'Pause monitoring' : 'Resume monitoring'}
              </Button>
            )}
            <Button variant="text" style={{ color: 'var(--error)' }} onClick={() => setConfirm(true)}>{imported ? 'Remove playlist' : 'Stop monitoring'}</Button>
          </div>
          <div className="pad" style={{ display: 'grid', gap: 10, paddingBottom: 12 }}>
            {embedId ? (
              embed ? (
                <SpotifyEmbed kind="playlist" id={embedId} title={p.name} />
              ) : (
                <Button variant="primary" onClick={() => setEmbed(true)}>Play playlist with Spotify</Button>
              )
            ) : imported ? (
              <form onSubmit={(e) => { e.preventDefault(); void saveLink(); }} style={{ display: 'grid', gap: 8 }}>
                <label className="field"><span className="sr">Spotify playlist link</span>
                  <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste this playlist’s Spotify link to play it here" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                </label>
                {linkErr && <span role="alert" style={{ color: 'var(--error)', fontSize: 14 }}>{linkErr}</span>}
                <Button variant="secondary" type="submit" disabled={!link.trim()}>Link playlist</Button>
              </form>
            ) : null}
          </div>
          <div className="chips" role="group" aria-label="View">
            <button className="chip" aria-pressed={view === 'all'} onClick={() => setView('all')}>All tracks{p.trackCount ? <span className="n">{p.trackCount}</span> : null}</button>
            <button className="chip" aria-pressed={view === 'finds'} onClick={() => setView('finds')}>New finds</button>
          </div>
          {view === 'all' ? <PlaylistLibrary playlistId={id} /> : (<>
          {feed.loading && !feed.data ? <RowSkeleton n={4} /> : items.length === 0 ? (
            <EmptyState title="No discoveries yet">New tracks that LIGHTOO finds in this playlist will be listed here.</EmptyState>
          ) : (
            <GroupedFeed items={items} context="playlist" onToggleHeard={(i) => void setTrackState(i.track.id, { heard: !i.heard }, { toast: i.heard ? 'Marked as new' : 'Marked as listened' })} />
          )}
          {feed.hasMore && <div style={{ padding: 20 }}><Button className="block" loading={feed.loadingMore} onClick={() => void feed.loadMore()}>Show more</Button></div>}
          </>)}
        </>
      )}
      {confirm && p && (
        <Dialog title={`Stop monitoring “${p.name}”?`} onClose={() => setConfirm(false)}>
          <p>LIGHTOO will stop checking this playlist. Tracks it already found stay in History and Saved.</p>
          <Button variant="destructive" onClick={() => void stop()}>Stop monitoring</Button>
          <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
        </Dialog>
      )}
      <span hidden><IcAlert /></span>
    </main>
  );
}
