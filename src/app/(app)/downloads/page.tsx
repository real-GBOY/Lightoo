'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { IcBack, IcDownload, IcPlay, IcTrash } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { importAudioFile } from '@/components/TrackSheet';
import { Artwork, Button, EmptyState, fmtBytes } from '@/components/ui';
import { api } from '@/lib/client/api';
import { audio, requestPersistence, storageEstimate, type StoredAudio } from '@/lib/client/idb';
import type { PlayerTrack } from '@/lib/client/providers';

// "Downloads" here means audio the owner supplied. Nothing is fetched from Spotify, and there is no
// third-party download source: the bytes come from a file picked on this device.
export default function DownloadsPage() {
  const { toast } = useApp();
  const player = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<StoredAudio[] | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setFiles((await audio.all()).sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
    setUsage(await storageEstimate());
  }, []);
  useEffect(() => {
    void load();
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
  }, [load]);

  const toTrack = (f: StoredAudio): PlayerTrack => ({ key: f.trackId ?? `asset:${f.id}`, trackId: f.trackId, assetId: f.id, title: f.title, artist: f.trackId ? 'Linked to a discovery' : 'Imported file', imageUrl: null });

  async function onPick(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(list)) {
      try { await importAudioFile(f, null, f.name.replace(/\.[^.]+$/, '')); ok++; } catch (e) { toast(`${f.name}: ${(e as Error).message}`); }
    }
    if (ok) toast(`${ok} ${ok === 1 ? 'file' : 'files'} added to this device`);
    setPersisted(await requestPersistence());
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    void load();
  }

  async function remove(f: StoredAudio) {
    await audio.remove(f.id);
    await api(`/api/audio-assets/${f.id}`, { method: 'DELETE' }).catch(() => {}); // metadata row; fine if offline
    toast('Removed from this device');
    void load();
  }

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header" style={{ paddingBottom: 0 }}><Link href="/settings" className="back"><IcBack /> Settings</Link></div>
      <div className="header">
        <div><h1 className="page-title">Downloads</h1><div className="meta" style={{ marginTop: 4 }}>Audio files you own, stored on this device. They play offline.</div></div>
      </div>
      <div className="pad" style={{ display: 'grid', gap: 10, paddingBottom: 12 }}>
        <input ref={fileRef} type="file" accept="audio/*" multiple hidden onChange={(e) => void onPick(e.target.files)} />
        <Button variant="primary" loading={busy} onClick={() => fileRef.current?.click()}><IcDownload size={20} /> Add audio files</Button>
        {files && files.length > 0 && <Button variant="secondary" onClick={() => player.playTracks(files.map(toTrack))}><IcPlay size={20} /> Play all</Button>}
        <p className="meta mono" style={{ margin: 0 }}>
          {usage ? `${fmtBytes(usage.usage)} of ${fmtBytes(usage.quota)} used on this device` : 'Storage usage unavailable'}
          {persisted === false ? ' · may be cleared by iOS when space is low. Add LIGHTOO to the Home Screen to improve this.' : ''}
        </p>
      </div>
      {files === null ? null : files.length === 0 ? (
        <EmptyState icon={<IcDownload size={40} />} title="No audio on this device">
          Spotify tracks can’t be downloaded here. Add files you own, or attach one to a track from its details, to play them in LIGHTOO.
        </EmptyState>
      ) : (
        files.map((f, i) => (
          <div key={f.id} className="row">
            <button className="row" style={{ padding: 0, minHeight: 54, flex: 1 }} onClick={() => player.playTracks(files.map(toTrack), i)} aria-label={`Play ${f.title}`}>
              <Artwork name={f.title} size={54} />
              <div className="grow"><div className="title">{f.title}</div><div className="sub mono" style={{ fontSize: 12 }}>{fmtBytes(f.sizeBytes)} · {f.mimeType.replace('audio/', '')}{f.trackId ? ' · linked' : ''}</div></div>
            </button>
            <button className="icon-btn" onClick={() => void remove(f)} aria-label={`Remove ${f.title}`}><IcTrash /></button>
          </div>
        ))
      )}
    </main>
  );
}
