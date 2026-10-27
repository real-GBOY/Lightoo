'use client';

import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { GroupedFeed, SyncBanners } from '@/components/common';
import { IcClose, IcSearch } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { Button, EmptyState, RowSkeleton } from '@/components/ui';
import { useFeed, useResource, useViewItems } from '@/lib/client/hooks';
import type { PlaylistDTO } from '@/lib/client/types';

export default function HistoryPage() {
  const { setTrackState } = useApp();
  const player = usePlayer();
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [filter, setFilter] = useState<'all' | 'unheard' | 'saved'>('all');
  const [playlistId, setPlaylistId] = useState('');
  const lists = useResource<{ items: PlaylistDTO[] }>('/api/playlists');

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 150); return () => clearTimeout(t); }, [q]);

  const params = new URLSearchParams({ scope: 'history', filter, limit: '50' });
  if (dq) params.set('q', dq);
  if (playlistId) params.set('playlistId', playlistId);
  const feed = useFeed(params.toString());
  const items = useViewItems(feed.items);
  const filtered = filter === 'all' && !dq && !playlistId ? false : true;

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header"><div><h1 className="page-title">History</h1><div className="meta" style={{ marginTop: 4 }}>Everything LIGHTOO has found, including removed tracks.</div></div></div>
      <SyncBanners />
      <div className="pad" style={{ paddingBottom: 8 }}>
        <label className="field">
          <IcSearch size={18} /><span className="sr">Search history</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Track, artist or playlist" type="search" enterKeyHint="search" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="icon-btn" style={{ width: 32, height: 32 }}><IcClose size={18} /></button>}
        </label>
      </div>
      <div className="chips" role="group" aria-label="Filter">
        {(['all', 'unheard', 'saved'] as const).map((f) => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0]!.toUpperCase() + f.slice(1)}</button>)}
        <label className="chip" style={{ position: 'relative' }}>
          <span>{playlistId ? (lists.data?.items.find((p) => p.id === playlistId)?.name ?? 'Playlist') : 'All playlists'} ▾</span>
          <select aria-label="Filter by playlist" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)} style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%' }}>
            <option value="">All playlists</option>
            {lists.data?.items.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <p className="meta pad" style={{ margin: '4px 0 0' }}>Times are when LIGHTOO first detected a track, not when it was added to the playlist.</p>

      {feed.loading && !feed.data ? <RowSkeleton /> : feed.error && !feed.data ? (
        <EmptyState title="Could not load History" action={<Button onClick={feed.reload}>Try again</Button>}>Check your connection and try again.</EmptyState>
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState icon={<IcSearch size={40} />} title="No results" action={<Button onClick={() => { setQ(''); setFilter('all'); setPlaylistId(''); }}>Reset search and filters</Button>}>Nothing matches. Searching covers only tracks LIGHTOO has recorded.</EmptyState>
        ) : (
          <EmptyState title="Nothing recorded yet">Tracks LIGHTOO finds will be kept here, even after they leave the playlist.</EmptyState>
        )
      ) : (
        <GroupedFeed items={items} context="history" onToggleHeard={(i) => void setTrackState(i.track.id, { heard: !i.heard }, { toast: i.heard ? 'Marked as new' : 'Marked as listened' })} />
      )}
      {feed.hasMore && <div style={{ padding: 20 }}><Button className="block" loading={feed.loadingMore} onClick={() => void feed.loadMore()}>Show more</Button></div>}
    </main>
  );
}
