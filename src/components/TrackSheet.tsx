'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, NetworkError, api } from '@/lib/client/api';
import { audio, requestPersistence } from '@/lib/client/idb';
import { hasLocalAudio, type PlayerTrack } from '@/lib/client/providers';
import { artistLine, spotifyTrackUrl, type DiscoveryDTO } from '@/lib/client/types';
import { useApp } from './AppProvider';
import { IcBookmark, IcDownload, IcExternal, IcPlay } from './Icons';
import { SpotifyEmbed } from './SpotifyEmbed';
import { usePlayer } from './PlayerProvider';
import { Artwork, Button, Sheet, clock, fmtBytes, fmtTime } from './ui';

export const toPlayerTrack = (d: DiscoveryDTO): PlayerTrack => ({
  key: d.track.id, trackId: d.track.id, title: d.track.title, artist: artistLine(d.track), imageUrl: d.track.imageUrl, spotifyId: d.track.spotifyId,
});

const EXT_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg' };

async function sha256Hex(blob: Blob): Promise<string | undefined> {
  try {
    if (!crypto.subtle) return undefined;
    const buf = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

/** Stores a user-supplied audio file on this device and records its metadata server-side. */
export async function importAudioFile(file: File, trackId: string | null, title: string): Promise<{ id: string; synced: boolean }> {
  const type = file.type.startsWith('audio/') ? file.type : (EXT_MIME[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '');
  if (!type) throw new Error('Choose an audio file.');
  const probe = document.createElement('audio');
  if (probe.canPlayType(type) === '') throw new Error(`This device cannot play ${type}.`);
  const id = `aud_${crypto.randomUUID().replace(/-/g, '')}`;
  await requestPersistence();
  const stored = await audio.put({ id, trackId, title, mimeType: type, sizeBytes: file.size, blob: file.type === type ? file : new Blob([file], { type }), addedAt: new Date().toISOString() });
  if (stored === null) throw new Error('Could not store the file. The device may be out of space.');
  try {
    await api('/api/audio-assets', { method: 'POST', json: { id, trackId: trackId ?? undefined, title, mimeType: type, sizeBytes: file.size, sha256: await sha256Hex(file) } });
    return { id, synced: true };
  } catch (e) {
    if (e instanceof NetworkError || e instanceof ApiError) return { id, synced: false }; // file is usable locally either way
    throw e;
  }
}

export function TrackSheet({ item, onClose }: { item: DiscoveryDTO | null; onClose: () => void }) {
  const { online, setTrackState, toast, overrides } = useApp();
  const player = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [embed, setEmbed] = useState(false);
  const trackId = item?.track.id;

  useEffect(() => {
    setEmbed(false);
    setLocal(null);
    if (trackId) void hasLocalAudio(trackId).then(setLocal);
  }, [trackId]);

  const onFile = useCallback(async (f: File | undefined) => {
    if (!f || !item) return;
    setBusy(true);
    try {
      const r = await importAudioFile(f, item.track.id, item.track.title);
      setLocal(true);
      toast(r.synced ? 'Audio added. It plays offline on this device.' : 'Audio added on this device.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [item, toast]);

  if (!item) return null;
  const t = item.track;
  const o = overrides[t.id];
  const heard = o?.heard ?? item.heard;
  const saved = o?.saved ?? item.saved;

  return (
    <Sheet open onClose={onClose} label={`${t.title} details`}>
      <div style={{ display: 'grid', placeItems: 'center', padding: '20px 0 16px' }}>
        <Artwork src={t.imageUrl} name={t.title} size={176} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {heard ? <span className="status">Listened</span> : <span className="status new">New</span>}
        {saved && <span className="status"><IcBookmark size={14} filled /> Saved</span>}
        {item.removedFromPlaylist && <span className="status">Removed from playlist</span>}
      </div>
      <h2 style={{ margin: 0, fontSize: 24, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{t.title}</h2>
      <div style={{ color: 'var(--text-2)', fontSize: 17, marginTop: 4 }}>{artistLine(t)}</div>
      {t.albumName && <div className="meta" style={{ marginTop: 2 }}>{t.albumName}{t.durationMs ? ` · ${fmtTime(t.durationMs / 1000)}` : ''}</div>}

      <dl style={{ margin: '16px 0', display: 'grid', gap: 10 }}>
        <div><dt className="section-label">Source playlist</dt><dd style={{ margin: '2px 0 0' }}>{item.playlist.name}</dd></div>
        <div>
          <dt className="section-label">First detected by LIGHTOO</dt>
          <dd className="mono" style={{ margin: '2px 0 0', fontSize: 14 }}>{new Date(item.detectedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}, {clock(item.detectedAt)}</dd>
        </div>
      </dl>

      <div style={{ display: 'grid', gap: 10 }}>
        {local ? (
          <Button variant="primary" onClick={() => { player.playTracks([toPlayerTrack(item)]); onClose(); player.setNowPlayingOpen(true); }}>
            <IcPlay size={20} /> Play on this device
          </Button>
        ) : (
          <p className="meta" style={{ margin: 0, lineHeight: 1.45 }}>
            {local === null ? ' ' : 'Offline playback needs an audio file you own. Without one, play it through Spotify’s player below.'}
          </p>
        )}
        {embed ? (
          <SpotifyEmbed kind="track" id={t.spotifyId} title={t.title} />
        ) : (
          <Button variant={local ? 'secondary' : 'primary'} onClick={() => setEmbed(true)}>
            <IcPlay size={20} /> Play with Spotify
          </Button>
        )}
        <a
          className="btn secondary block"
          href={spotifyTrackUrl(t.spotifyId)} target="_blank" rel="noopener noreferrer"
          aria-disabled={!online} style={{ color: 'var(--text)', ...(online ? {} : { opacity: 0.4, pointerEvents: 'none' }) }}
          onClick={() => !heard && setTimeout(() => toast('Back from Spotify?', { label: 'Mark listened', run: () => void setTrackState(t.id, { heard: true }) }), 600)}
        >
          Open in Spotify <IcExternal size={20} />
        </a>
        {!online && <p className="meta" style={{ margin: 0 }}>Offline. Spotify opens when you are back online.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="secondary" onClick={() => void setTrackState(t.id, { heard: !heard }, { toast: heard ? 'Marked as new' : 'Marked as listened' })}>
            {heard ? 'Mark as new' : 'Mark listened'}
          </Button>
          <Button variant="secondary" onClick={() => void setTrackState(t.id, { saved: !saved }, { toast: saved ? 'Removed from Saved' : 'Saved for later' })}>
            <IcBookmark size={20} filled={saved} /> {saved ? 'Unsave' : 'Save'}
          </Button>
        </div>
        <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        <Button variant="text" loading={busy} onClick={() => fileRef.current?.click()} style={{ justifyContent: 'center' }}>
          <IcDownload size={20} /> {local ? 'Replace audio file' : 'Add audio file I own'}
        </Button>
        {local && <span className="meta" style={{ textAlign: 'center' }}>Stored on this device only. Plays offline.</span>}
      </div>
    </Sheet>
  );
}

export { fmtBytes };
