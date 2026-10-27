'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { IcBack, IcClose, IcSearch } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { useOpenTrack } from '@/components/Shell';
import { Artwork, EmptyState } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { FeedPage } from '@/lib/client/types';

type Result = {
  artists: string[];
  playlists: { id: string; name: string; imageUrl: string | null }[];
  tracks: { id: string; title: string; artistNames: string; imageUrl: string | null }[];
};

export default function SearchPage() {
  const player = usePlayer();
  const open = useOpenTrack();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Result | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    const term = q.trim();
    if (!term) { setRes(null); setState('idle'); return; }
    setState('loading');
    const t = setTimeout(() => {
      api<Result>(`/api/search?q=${encodeURIComponent(term)}`).then((r) => { setRes(r); setState('idle'); }).catch(() => setState('error'));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // A track result opens the same sheet as everywhere else; fetch the matching discovery for it.
  async function openTrack(title: string, id: string) {
    const page = await api<FeedPage>(`/api/discoveries?scope=history&q=${encodeURIComponent(title)}&limit=20`).catch(() => null);
    const hit = page?.items.find((i) => i.track.id === id);
    if (hit) open(hit);
  }

  const none = res && !res.artists.length && !res.playlists.length && !res.tracks.length;
  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header" style={{ paddingBottom: 0 }}><Link href="/" className="back"><IcBack /> New Music</Link></div>
      <div className="pad" style={{ padding: '8px 20px 12px' }}>
        <label className="field">
          <IcSearch size={18} /><span className="sr">Search</span>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Track, artist or playlist" type="search" enterKeyHint="search" />
          {q && <button onClick={() => setQ('')} aria-label="Clear search" className="icon-btn" style={{ width: 32, height: 32 }}><IcClose size={18} /></button>}
        </label>
        <p className="meta" style={{ margin: '8px 0 0' }}>Searches tracks LIGHTOO has recorded, not all of Spotify.</p>
      </div>
      {state === 'error' && <EmptyState title="Search failed">Check your connection and try again.</EmptyState>}
      {!res && state !== 'error' && <EmptyState icon={<IcSearch size={40} />} title="Search your finds">Look up a track, artist or playlist from your History.</EmptyState>}
      {none && <EmptyState icon={<IcSearch size={40} />} title="No results">Nothing recorded matches “{q.trim()}”. This does not search Spotify.</EmptyState>}
      {res && res.artists.length > 0 && (<section><div className="day section-label">Artists</div>{res.artists.map((a) => <button key={a} className="row" onClick={() => setQ(a)}><div className="grow"><div className="title">{a}</div></div></button>)}</section>)}
      {res && res.playlists.length > 0 && (<section><div className="day section-label">Playlists</div>{res.playlists.map((p) => <Link key={p.id} href={`/playlists/${p.id}`} className="row" style={{ color: 'var(--text)' }}><Artwork src={p.imageUrl} name={p.name} size={44} /><div className="grow"><div className="title">{p.name}</div></div></Link>)}</section>)}
      {res && res.tracks.length > 0 && (<section><div className="day section-label">Tracks</div>{res.tracks.map((t) => <button key={t.id} className="row" onClick={() => void openTrack(t.title, t.id)}><Artwork src={t.imageUrl} name={t.title} size={44} /><div className="grow"><div className="title">{t.title}</div><div className="sub">{t.artistNames}</div></div></button>)}</section>)}
    </main>
  );
}
