import type { SpotifyTrack } from '../spotify/client';

export const SEED_COUNT = 10;

export type ExistingMembership = { spotifyId: string; removedAt: Date | null };

export type SyncPlan = {
  /** Newly observed tracks. `event` is null for the silent baseline. */
  add: { track: SpotifyTrack; event: 'NEW_TRACK' | 'SEEDED' | null }[];
  /** Previously removed tracks that are back. They keep their original discovery. */
  restore: string[];
  /** Tracks that vanished from the playlist. Rows and discoveries are kept, only tagged. */
  remove: string[];
  /** Still present; only lastSeenAt is bumped. */
  keep: string[];
};

/** Spotify allows duplicates inside a playlist; membership is per track, so keep the first. */
export function dedupeTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.spotifyId) ? false : (seen.add(t.spotifyId), true)));
}

/**
 * Pure diff between what we last stored and what Spotify returns now.
 * No I/O, no clock: easy to test, and idempotent by construction. Running it twice
 * against its own output yields an empty plan.
 *
 * Baseline: on a playlist's first successful sync nothing is announced, except (optionally)
 * the SEED_COUNT most recently added tracks so the inbox is not empty on first run.
 */
export function planSync(p: { baselineDone: boolean; seedRecent: boolean; existing: ExistingMembership[]; fetched: SpotifyTrack[] }): SyncPlan {
  const fetched = dedupeTracks(p.fetched);
  const known = new Map(p.existing.map((e) => [e.spotifyId, e]));
  const present = new Set(fetched.map((t) => t.spotifyId));

  const fresh = fetched.filter((t) => !known.has(t.spotifyId));

  let seedIds = new Set<string>();
  if (!p.baselineDone && p.seedRecent) {
    // Newest first: prefer Spotify's added_at when present, otherwise playlist position (appends go last).
    const ranked = [...fresh].sort((a, b) => {
      const at = (a.addedAt?.getTime() ?? 0) - (b.addedAt?.getTime() ?? 0);
      return -(at !== 0 ? at : a.position - b.position);
    });
    seedIds = new Set(ranked.slice(0, SEED_COUNT).map((t) => t.spotifyId));
  }

  return {
    add: fresh.map((track) => ({
      track,
      event: p.baselineDone ? 'NEW_TRACK' : seedIds.has(track.spotifyId) ? 'SEEDED' : null,
    })),
    restore: fetched.filter((t) => known.get(t.spotifyId)?.removedAt).map((t) => t.spotifyId),
    remove: p.existing.filter((e) => !e.removedAt && !present.has(e.spotifyId)).map((e) => e.spotifyId),
    keep: fetched.filter((t) => known.has(t.spotifyId) && !known.get(t.spotifyId)!.removedAt).map((t) => t.spotifyId),
  };
}

export const dedupeKey = (playlistId: string, spotifyTrackId: string) => `${playlistId}:${spotifyTrackId}`;
