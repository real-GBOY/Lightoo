import { audio } from './idb';

/**
 * Playback sources are independent of Spotify sync. A provider says what it can really do and
 * either hands back a playable URL or a reason it can't. Only providers whose behaviour is
 * verified are registered: nothing here streams, downloads or extracts Spotify audio.
 */
export type PlayerTrack = {
  /** Server track id, or `asset:<id>` for an imported file with no linked Spotify track. */
  key: string;
  trackId: string | null;
  assetId?: string | null;
  title: string;
  artist: string;
  imageUrl: string | null;
  spotifyId?: string;
};

export type Capabilities = { canPlay: boolean; canSeek: boolean; canDownload: boolean; offline: boolean };

export type Resolved =
  | { ok: true; url: string; release: () => void; providerId: string }
  | { ok: false; reason: 'no_audio' | 'external' | 'error'; message: string };

export interface PlaybackProvider {
  id: string;
  label: string;
  capabilities: Capabilities;
  resolve(t: PlayerTrack): Promise<Resolved>;
}

/** User-imported audio kept in this device's IndexedDB. Works fully offline. */
export const localFileProvider: PlaybackProvider = {
  id: 'local-file',
  label: 'Imported file',
  capabilities: { canPlay: true, canSeek: true, canDownload: false /* already local */, offline: true },
  async resolve(t) {
    const rec = t.assetId ? await audio.get(t.assetId) : t.trackId ? await audio.byTrack(t.trackId) : null;
    if (!rec) return { ok: false, reason: 'no_audio', message: 'No audio file for this track on this device.' };
    const url = URL.createObjectURL(rec.blob);
    return { ok: true, url, release: () => URL.revokeObjectURL(url), providerId: 'local-file' };
  },
};

/**
 * Spotify's Web API returns metadata, not audio; the Web Playback SDK needs Premium, a supported
 * browser and a Spotify-controlled player, and does not support offline use. Not implemented here,
 * so this provider truthfully reports it cannot play and points to the Spotify app.
 */
export const spotifyHandoffProvider: PlaybackProvider = {
  id: 'spotify-handoff',
  label: 'Spotify',
  capabilities: { canPlay: false, canSeek: false, canDownload: false, offline: false },
  async resolve() {
    return { ok: false, reason: 'external', message: 'Spotify tracks play in the Spotify app.' };
  },
};

export const providers: PlaybackProvider[] = [localFileProvider, spotifyHandoffProvider];

export async function resolveTrack(t: PlayerTrack): Promise<Resolved> {
  for (const p of providers) {
    if (!p.capabilities.canPlay) continue;
    const r = await p.resolve(t);
    if (r.ok) return r;
    if (r.reason === 'error') return r;
  }
  return { ok: false, reason: 'no_audio', message: 'No playable audio for this track. LIGHTOO has its metadata only.' };
}

/** Metadata-only vs actually playable on this device. */
export async function hasLocalAudio(trackId: string): Promise<boolean> {
  return (await audio.byTrack(trackId)) !== null;
}
