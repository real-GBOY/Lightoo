'use client';

import Link from 'next/link';
import { IcBack, IcBookmark, IcExternal } from '@/components/Icons';
import { useApp } from '@/components/AppProvider';
import { usePlayer } from '@/components/PlayerProvider';
import { useOpenTrack } from '@/components/Shell';
import { TrackRow } from '@/components/TrackRow';
import { Button, EmptyState, RowSkeleton } from '@/components/ui';
import { useFeed, useViewItems } from '@/lib/client/hooks';
import { spotifyTrackUrl } from '@/lib/client/types';

export default function SavedPage() {
  const { online } = useApp();
  const player = usePlayer();
  const open = useOpenTrack();
  const feed = useFeed('scope=history&filter=saved&limit=50');
  // Un-saving elsewhere should drop the row here without waiting for a refetch.
  const items = useViewItems(feed.items).filter((i) => i.saved);

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header" style={{ paddingBottom: 0 }}><Link href="/" className="back"><IcBack /> New Music</Link></div>
      <div className="header"><h1 className="page-title">Saved</h1></div>
      {feed.loading && !feed.data ? <RowSkeleton /> : items.length === 0 ? (
        <EmptyState icon={<IcBookmark size={40} />} title="Nothing saved yet">Open a track and choose Save to keep it here.</EmptyState>
      ) : (
        items.map((i) => (
          <TrackRow
            key={i.id} item={i} context="history" onOpen={open}
            trailing={
              <a className="icon-btn accent" href={spotifyTrackUrl(i.track.spotifyId)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${i.track.title} in Spotify`} aria-disabled={!online} style={online ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
                <IcExternal />
              </a>
            }
          />
        ))
      )}
      {feed.hasMore && <div style={{ padding: 20 }}><Button className="block" loading={feed.loadingMore} onClick={() => void feed.loadMore()}>Show more</Button></div>}
    </main>
  );
}
