'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { GroupedFeed, SyncBanners, SyncLine } from '@/components/common';
import { IcBookmark, IcCheck, IcRefresh, IcSearch } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { Button, EmptyState, RowSkeleton } from '@/components/ui';
import { useFeed, useResource, useViewItems } from '@/lib/client/hooks';
import type { PlaylistDTO } from '@/lib/client/types';

type Filter = 'all' | 'unheard' | 'saved';

function NoticeFromSpotify() {
  const { toast, refreshMe } = useApp();
  useEffect(() => {
    const r = new URLSearchParams(window.location.search).get('spotify');
    if (!r) return;
    window.history.replaceState(null, '', '/');
    if (r === 'connected') { toast('Spotify connected'); void refreshMe(); }
    else if (r === 'cancelled') toast('Cancelled. Nothing was shared with LIGHTOO.');
    else toast('Sign-in failed. Try connecting again.');
  }, [toast, refreshMe]);
  return null;
}

export default function NewMusicPage() {
  const { me, sync, runSync, setTrackState, online } = useApp();
  const player = usePlayer();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const feed = useFeed('scope=new&limit=100');
  const lists = useResource<{ items: PlaylistDTO[] }>('/api/playlists');
  const items = useViewItems(feed.items);

  useEffect(() => {
    if (me?.spotify.status === 'NOT_CONNECTED' && lists.data && lists.data.items.length === 0) router.replace('/connect');
  }, [me, lists.data, router]);

  const unheard = items.filter((i) => !i.heard).length;
  const shown = useMemo(() => items.filter((i) => (filter === 'unheard' ? !i.heard : filter === 'saved' ? i.saved : true)), [items, filter]);
  const names = useMemo(() => Object.fromEntries((lists.data?.items ?? []).map((p) => [p.id, p.name])), [lists.data]);
  const noPlaylists = lists.data && lists.data.items.length === 0;
  const syncing = sync.phase === 'syncing';

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <NoticeFromSpotify />
      <div className="header">
        <div>
          <h1 className="page-title">New Music</h1>
          <div className="meta mono" style={{ marginTop: 4 }}>{unheard} unheard · last 7 days</div>
        </div>
        <div style={{ display: 'flex' }}>
          <Link href="/search" className="icon-btn" aria-label="Search"><IcSearch /></Link>
          <Link href="/saved" className="icon-btn accent" aria-label="Saved"><IcBookmark /></Link>
          <button className="icon-btn" aria-label="Check playlists now" aria-busy={syncing} disabled={syncing} onClick={() => void runSync()}>
            <span className={syncing ? 'spin' : ''} style={{ display: 'inline-flex' }}><IcRefresh /></span>
          </button>
        </div>
      </div>
      <SyncLine />
      <SyncBanners playlistNames={names} />

      <div className="chips" role="group" aria-label="Filter">
        {(['all', 'unheard', 'saved'] as const).map((f) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'unheard' ? 'Unheard' : 'Saved'}
            <span className="n">{f === 'all' ? items.length : f === 'unheard' ? unheard : items.filter((i) => i.saved).length}</span>
          </button>
        ))}
      </div>

      {feed.loading && !feed.data ? (
        <RowSkeleton />
      ) : feed.error && !feed.data ? (
        <EmptyState title="Could not load New Music" action={<Button onClick={feed.reload}>Try again</Button>}>
          {online ? 'Something went wrong on our side.' : 'You are offline and nothing is stored on this device yet.'}
        </EmptyState>
      ) : noPlaylists && items.length === 0 ? (
        <EmptyState icon={<span className="mono" style={{ fontSize: 40 }}>○ ○</span>} title="No playlists yet" action={<Link href="/playlists" className="btn primary" style={{ color: 'var(--accent-ink)' }}>Add a playlist</Link>}>
          Paste a Spotify playlist link. LIGHTOO will keep watch and show new tracks here.
        </EmptyState>
      ) : shown.length === 0 ? (
        <EmptyState icon={<span className="mono" style={{ fontSize: 40 }}>○ ○</span>} title={filter === 'unheard' ? 'All caught up' : filter === 'saved' ? 'Nothing saved here' : 'No new music this week'}>
          {filter === 'unheard' ? 'Every new track from the last 7 days is marked listened.' : filter === 'saved' ? 'Save a track from its details to find it here.' : 'When a monitored playlist gains tracks, they land here.'}
        </EmptyState>
      ) : (
        <GroupedFeed
          items={shown} context="inbox"
          onToggleHeard={(i) => void setTrackState(i.track.id, { heard: !i.heard }, { toast: i.heard ? 'Marked as new' : 'Marked as listened' })}
        />
      )}
      {feed.hasMore && <div style={{ padding: 20 }}><Button className="block" loading={feed.loadingMore} onClick={() => void feed.loadMore()}>Show more</Button></div>}
      <span hidden><IcCheck /></span>
    </main>
  );
}
