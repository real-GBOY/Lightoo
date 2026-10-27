'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { audio, storageEstimate } from '@/lib/client/idb';
import { readTags, type Tags } from '@/lib/client/audioMeta';
import { useResource } from '@/lib/client/hooks';
import type { PlayerTrack } from '@/lib/client/providers';
import { matchFiles } from '@/lib/match';
import { useApp } from './AppProvider';
import { IcDownload, IcPlay } from './Icons';
import { usePlayer } from './PlayerProvider';
import { importAudioFile } from './TrackSheet';
import { Artwork, Button, EmptyState, RowSkeleton, Sheet, fmtBytes } from './ui';

type LibItem = { id: string; spotifyId: string; title: string; artistNames: string; albumName: string | null; imageUrl: string | null; durationMs: number | null; removed: boolean };
type LibData = { playlist: { id: string; name: string }; total: number; items: LibItem[] };
type Filter = 'all' | 'device' | 'missing';
type Plan = { files: File[]; matched: { file: File; item: LibItem; confidence: 'high' | 'medium' }[]; unmatched: { file: File; reason: string }[]; bytes: number };

const REASON: Record<string, string> = {
  no_title: 'No title found',
  no_candidate: 'Not in this playlist',
  artist_mismatch: 'Artist differs',
  ambiguous: 'More than one possible track',
  duplicate: 'Another file already matches this track',
};
const PAGE = 100;

const csvCell = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** All tracks of a playlist, with what is playable on this device and tools to fill the gaps with files you own. */
export function PlaylistLibrary({ playlistId }: { playlistId: string }) {
  const { toast, bump, version } = useApp();
  const player = usePlayer();
  const { data, loading, error, reload } = useResource<LibData>(`/api/playlists/${playlistId}/tracks`);
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [phase, setPhase] = useState<'idle' | 'reading' | 'review' | 'adding'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [space, setSpace] = useState<{ usage: number; quota: number } | null>(null);
  const bulkRef = useRef<HTMLInputElement>(null);
  const oneRef = useRef<HTMLInputElement>(null);
  const oneFor = useRef<LibItem | null>(null);

  const refreshLocal = useCallback(async () => {
    setLocal(new Set((await audio.all()).map((a) => a.trackId).filter((t): t is string => !!t)));
    setSpace(await storageEstimate());
  }, []);
  useEffect(() => { void refreshLocal(); }, [refreshLocal, version]);
  useEffect(() => setShown(PAGE), [filter, q]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const onDevice = items.filter((i) => local.has(i.id));
  const missing = items.filter((i) => !local.has(i.id));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((i) => (filter === 'device' ? local.has(i.id) : filter === 'missing' ? !local.has(i.id) : true) && (!needle || `${i.title} ${i.artistNames}`.toLowerCase().includes(needle)));
  }, [items, local, filter, q]);

  const toPlayer = (i: LibItem): PlayerTrack => ({ key: i.id, trackId: i.id, title: i.title, artist: i.artistNames, imageUrl: i.imageUrl, spotifyId: i.spotifyId });
  const playFrom = (i: LibItem) => {
    const queue = onDevice.map(toPlayer);
    player.playTracks(queue, Math.max(0, queue.findIndex((t) => t.key === i.id)));
    player.setNowPlayingOpen(true);
  };

  async function onBulk(files: FileList | null) {
    if (!files?.length || !data) return;
    const picked = Array.from(files).filter((f) => f.type.startsWith('audio/') || /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(f.name));
    if (!picked.length) { toast('Choose audio files (MP3, M4A, FLAC, WAV…).'); return; }
    setPhase('reading');
    setProgress({ done: 0, total: picked.length });
    const tags: Tags[] = [];
    for (const [i, f] of picked.entries()) { tags.push(await readTags(f)); if (i % 20 === 0) setProgress({ done: i, total: picked.length }); }
    // Only tracks not yet on this device are candidates, so existing files are never silently replaced.
    const candidates = items.filter((t) => !local.has(t.id));
    const results = matchFiles(picked.map((f, i) => ({ key: String(i), title: tags[i]?.title, artist: tags[i]?.artist })), candidates);
    const byId = new Map(candidates.map((t) => [t.id, t]));
    const matched: Plan['matched'] = [];
    const unmatched: Plan['unmatched'] = [];
    results.forEach((r, i) => {
      const file = picked[i]!;
      if (r.status === 'matched') matched.push({ file, item: byId.get(r.trackId)!, confidence: r.confidence });
      else unmatched.push({ file, reason: REASON[r.reason] ?? r.reason });
    });
    setPlan({ files: picked, matched, unmatched, bytes: matched.reduce((n, m) => n + m.file.size, 0) });
    setPhase('review');
    if (bulkRef.current) bulkRef.current.value = '';
  }

  async function confirm() {
    if (!plan) return;
    setPhase('adding');
    setProgress({ done: 0, total: plan.matched.length });
    let ok = 0, failed = 0;
    for (const [i, m] of plan.matched.entries()) {
      try { await importAudioFile(m.file, m.item.id, m.item.title); ok++; } catch { failed++; }
      setProgress({ done: i + 1, total: plan.matched.length });
    }
    await refreshLocal();
    bump();
    setPlan(null);
    setPhase('idle');
    toast(`${ok} ${ok === 1 ? 'song' : 'songs'} added to this device${failed ? `, ${failed} failed (storage full or unsupported)` : ''}`);
  }

  async function onOne(file: File | undefined) {
    const item = oneFor.current;
    if (!file || !item) return;
    try { await importAudioFile(file, item.id, item.title); await refreshLocal(); bump(); toast(`Added “${item.title}”`); }
    catch (e) { toast((e as Error).message); }
    finally { if (oneRef.current) oneRef.current.value = ''; }
  }

  function downloadMissing() {
    const rows = [['Title', 'Artist', 'Album', 'Spotify link'], ...missing.map((i) => [i.title, i.artistNames, i.albumName ?? '', `https://open.spotify.com/track/${i.spotifyId}`])];
    const csv = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads Arabic correctly
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${(data?.playlist.name ?? 'playlist').replace(/[^\p{L}\p{N}]+/gu, '-')}-missing.csv` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  if (loading && !data) return <RowSkeleton n={5} />;
  if (error && !data) return <EmptyState title="Could not load tracks" action={<Button onClick={reload}>Try again</Button>}>Check your connection and try again.</EmptyState>;
  if (!items.length) return <EmptyState title="No tracks yet">Tracks appear here after the playlist is checked or imported.</EmptyState>;

  const pct = Math.round((onDevice.length / items.length) * 100);
  const tight = plan && space ? space.usage + plan.bytes > space.quota * 0.9 : false;

  return (
    <div>
      <div className="pad" style={{ display: 'grid', gap: 10, paddingBottom: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="mono" style={{ fontSize: 13 }}>{onDevice.length} of {items.length} on this device</span>
          <span className="meta mono">{pct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'var(--s3)' }}><div style={{ width: `${pct}%`, height: 4, borderRadius: 2, background: 'var(--accent)' }} /></div>
        <input ref={bulkRef} type="file" multiple accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" hidden onChange={(e) => void onBulk(e.target.files)} />
        <input ref={oneRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" hidden onChange={(e) => void onOne(e.target.files?.[0])} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="primary" loading={phase === 'reading'} onClick={() => bulkRef.current?.click()} style={{ minHeight: 48 }}><IcDownload size={20} /> Add my files</Button>
          <Button variant="secondary" disabled={!onDevice.length} onClick={() => { player.playTracks(onDevice.map(toPlayer)); player.setNowPlayingOpen(true); }}><IcPlay size={20} /> Play all</Button>
        </div>
        {phase === 'reading' && <span className="meta mono">Reading tags… {progress.done} of {progress.total}</span>}
        <p className="meta" style={{ margin: 0, lineHeight: 1.5 }}>Pick audio files you own. LIGHTOO reads each file’s title and artist and links it to the matching track. Files stay on this device.</p>
      </div>

      <div className="pad" style={{ paddingBottom: 6 }}>
        <label className="field"><span className="sr">Search this playlist</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tracks" type="search" enterKeyHint="search" />
        </label>
      </div>
      <div className="chips" role="group" aria-label="Show">
        {([['all', `All ${items.length}`], ['device', `On device ${onDevice.length}`], ['missing', `Missing ${missing.length}`]] as const).map(([f, label]) => (
          <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>
        ))}
        <button className="chip" onClick={downloadMissing} disabled={!missing.length}>Missing list (CSV)</button>
      </div>

      {list.length === 0 ? (
        <EmptyState title={filter === 'device' ? 'Nothing on this device yet' : 'No matches'}>{filter === 'device' ? 'Add your files above and they will show up here, playable offline.' : 'Try a different search or filter.'}</EmptyState>
      ) : (
        list.slice(0, shown).map((i) => {
          const have = local.has(i.id);
          return (
            <div key={i.id} className="row" style={{ paddingRight: 8 }}>
              <Artwork src={i.imageUrl} name={i.title} size={44} />
              <div className="grow">
                <div className="title" style={{ fontSize: 15, fontWeight: have ? 600 : 500, color: have ? 'var(--text)' : 'var(--text-2)' }}>{i.title}</div>
                <div className="sub" style={{ fontSize: 13 }}>{i.artistNames}</div>
                {i.removed && <div className="ctx"><span className="status">Removed from playlist</span></div>}
              </div>
              {have ? (
                <button className="icon-btn accent" onClick={() => playFrom(i)} aria-label={`Play ${i.title}`}><IcPlay /></button>
              ) : (
                <button className="btn text" style={{ minHeight: 44, fontSize: 14 }} onClick={() => { oneFor.current = i; oneRef.current?.click(); }} aria-label={`Add a file for ${i.title}`}>Add file</button>
              )}
            </div>
          );
        })
      )}
      {list.length > shown && <div style={{ padding: 20 }}><Button className="block" onClick={() => setShown((n) => n + PAGE)}>Show more ({list.length - shown} left)</Button></div>}

      <Sheet open={phase === 'review' || phase === 'adding'} onClose={() => phase === 'review' && (setPlan(null), setPhase('idle'))} label="Match files to tracks">
        {plan && (
          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: '8px 0 0', fontSize: 22, letterSpacing: '-0.02em' }}>{plan.matched.length} of {plan.files.length} files matched</h2>
            <p className="meta" style={{ margin: 0, lineHeight: 1.5 }}>
              Matched by title and artist. Anything unclear is left out rather than guessed. {plan.matched.length > 0 && `Adding ${fmtBytes(plan.bytes)} to this device.`}
            </p>
            {tight && <div role="alert" className="banner warn" style={{ margin: 0 }}><div><b>Storage is nearly full</b><span>iPhone limits what a web app can keep. Add fewer files at a time, or some may fail.</span></div></div>}
            {plan.matched.length > 0 && (
              <div className="list-group" style={{ margin: 0 }}>
                {plan.matched.slice(0, 6).map((m) => (
                  <div key={m.item.id} className="row" style={{ minHeight: 48 }}>
                    <div className="grow"><div className="title" style={{ fontSize: 14 }}>{m.item.title}</div><div className="sub mono" style={{ fontSize: 11 }}>{m.file.name}{m.confidence === 'medium' ? ' · title only' : ''}</div></div>
                  </div>
                ))}
                {plan.matched.length > 6 && <div className="row" style={{ minHeight: 40 }}><span className="meta">…and {plan.matched.length - 6} more</span></div>}
              </div>
            )}
            {plan.unmatched.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer', color: 'var(--text-2)' }}>{plan.unmatched.length} not matched</summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
                  {plan.unmatched.slice(0, 30).map((u, i) => <li key={i}><span className="mono">{u.file.name}</span> · {u.reason}</li>)}
                  {plan.unmatched.length > 30 && <li>…and {plan.unmatched.length - 30} more</li>}
                </ul>
                <p className="meta" style={{ margin: '8px 0 0' }}>You can attach any of these by hand with “Add file” on a track.</p>
              </details>
            )}
            <Button variant="primary" loading={phase === 'adding'} disabled={!plan.matched.length} onClick={() => void confirm()}>
              {phase === 'adding' ? `Adding ${progress.done} of ${progress.total}…` : `Add ${plan.matched.length} ${plan.matched.length === 1 ? 'file' : 'files'}`}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
