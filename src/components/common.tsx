'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { DiscoveryDTO } from '@/lib/client/types';
import { useApp } from './AppProvider';
import { IcRefresh, IcWifiOff } from './Icons';
import { TrackRow } from './TrackRow';
import { useOpenTrack } from './Shell';
import { Banner, dayLabel, timeAgo } from './ui';

export function SyncLine() {
  const { sync, online } = useApp();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i); }, []);
  const syncing = sync.phase === 'syncing';
  return (
    <div className="sync-line" role="status">
      {!online ? <IcWifiOff size={14} /> : <span className={syncing ? 'spin' : ''} style={{ display: 'inline-flex' }}><IcRefresh size={14} /></span>}
      <span>
        {syncing ? 'Checking playlists…' : !online ? `Offline · last checked ${timeAgo(sync.at)}` : sync.phase === 'failed' ? `Check failed · last success ${timeAgo(sync.at)}` : sync.at ? `Checked ${timeAgo(sync.at)}` : 'Not checked yet'}
      </span>
    </div>
  );
}

/** Offline, sign-in expired and per-playlist failure banners. The inbox never says "synced" when something failed. */
export function SyncBanners({ playlistNames }: { playlistNames?: Record<string, string> }) {
  const { online, sync, runSync } = useApp();
  return (
    <>
      {!online && (
        <Banner title="You are offline">Showing what LIGHTOO recorded earlier. New tracks appear when you reconnect.</Banner>
      )}
      {online && sync.phase === 'failed' && sync.needsReconnect && (
        <Banner tone="warn" title="Spotify sign-in expired" action={<Link href="/connect" className="btn text">Reconnect</Link>}>
          Earlier finds are still here.
        </Banner>
      )}
      {online && sync.phase === 'failed' && !sync.needsReconnect && (
        <Banner tone="error" title="Some playlists did not update" action={<button className="btn text" onClick={() => void runSync()}>Retry</button>}>
          {sync.failedIds.map((id) => playlistNames?.[id]).filter(Boolean).join(', ') || sync.message || 'Try again in a moment.'}
        </Banner>
      )}
    </>
  );
}

/** Day-grouped list used by New Music, History and playlist detail. */
export function GroupedFeed({
  items, context, onToggleHeard,
}: { items: DiscoveryDTO[]; context: 'inbox' | 'history' | 'playlist'; onToggleHeard?: (i: DiscoveryDTO) => void }) {
  const open = useOpenTrack();
  const groups: { label: string; rows: DiscoveryDTO[] }[] = [];
  for (const i of items) {
    const label = dayLabel(i.detectedAt);
    const g = groups.at(-1);
    if (g && g.label === label) g.rows.push(i);
    else groups.push({ label, rows: [i] });
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <div className="day section-label">{g.label}</div>
          {g.rows.map((i) => <TrackRow key={i.id} item={i} context={context} onOpen={open} onToggleHeard={onToggleHeard} />)}
        </section>
      ))}
    </>
  );
}
