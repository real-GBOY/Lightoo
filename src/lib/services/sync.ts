import type { Db } from '../db';
import type { Clock } from '../clock';
import { AppError } from '../errors';
import { newId } from '../ids';
import { SpotifyAccessError, type SpotifyApi, type SpotifyTrack } from '../spotify/client';
import { dedupeKey, dedupeTracks, planSync } from './plan';

export type SyncSummary = {
  playlistId: string;
  outcome: 'SUCCESS' | 'NO_CHANGES' | 'FAILED' | 'RATE_LIMITED' | 'UNREADABLE';
  newTracks: number;
  removedTracks: number;
  error?: string;
  /** Sign-in expired or revoked: the UI offers Reconnect rather than Retry. */
  needsReconnect?: boolean;
};

const MAX_ERR = 200;

export type SnapshotMeta = { name: string; ownerName: string | null; imageUrl: string | null; snapshotId: string | null };

/**
 * Diff a playlist's current tracks against what is stored and apply the result in ONE transaction.
 * Shared by live Spotify sync and file import, so both get the same baseline, dedupe and
 * history-preservation behaviour. Throws if the transaction fails; nothing is half-written.
 */
export async function applySnapshot(
  deps: { db: Db; clock: Clock },
  ownerId: string,
  pl: { id: string; baselineDone: boolean; seedRecent: boolean },
  meta: SnapshotMeta,
  tracks: SpotifyTrack[],
): Promise<{ announced: number; removed: number }> {
  const { db, clock } = deps;
  const fetched = dedupeTracks(tracks);
  const existing = await db.playlistTrack.findMany({
    where: { playlistId: pl.id },
    select: { removedAt: true, track: { select: { spotifyId: true } } },
  });
  const plan = planSync({
    baselineDone: pl.baselineDone,
    seedRecent: pl.seedRecent,
    existing: existing.map((e) => ({ spotifyId: e.track.spotifyId, removedAt: e.removedAt })),
    fetched,
  });

  const now = clock.now();
  await db.$transaction(
    async (tx) => {
      const needed = [...new Set(plan.add.map((a) => a.track.spotifyId))];
      if (needed.length) {
        await tx.track.createMany({
          skipDuplicates: true,
          data: plan.add.map(({ track: t }) => ({
            id: newId('trk'),
            spotifyId: t.spotifyId,
            title: t.title,
            artists: t.artists,
            artistNames: t.artists.map((a) => a.name).join(', '),
            albumName: t.albumName,
            imageUrl: t.imageUrl,
            durationMs: t.durationMs,
            isrc: t.isrc,
            isPlayable: t.isPlayable,
          })),
        });
        const rows = await tx.track.findMany({ where: { spotifyId: { in: needed } }, select: { id: true, spotifyId: true } });
        const idBySpotify = new Map(rows.map((r) => [r.spotifyId, r.id]));

        await tx.playlistTrack.createMany({
          skipDuplicates: true,
          data: plan.add.map(({ track: t }) => ({
            id: newId('plt'),
            playlistId: pl.id,
            trackId: idBySpotify.get(t.spotifyId)!,
            position: t.position,
            addedAtSource: t.addedAt,
            firstSeenAt: now,
            lastSeenAt: now,
          })),
        });

        const events = plan.add.filter((a) => a.event);
        if (events.length) {
          await tx.discoveryEvent.createMany({
            skipDuplicates: true, // unique(ownerId, dedupeKey)
            data: events.map(({ track: t, event }) => ({
              id: newId('dsc'),
              ownerId,
              playlistId: pl.id,
              trackId: idBySpotify.get(t.spotifyId)!,
              type: event!,
              detectedAt: now,
              dedupeKey: dedupeKey(pl.id, t.spotifyId),
              playlistName: meta.name,
              snapshotId: meta.snapshotId,
            })),
          });
        }
      }
      if (plan.restore.length) {
        await tx.playlistTrack.updateMany({
          where: { playlistId: pl.id, track: { spotifyId: { in: plan.restore } } },
          data: { removedAt: null, lastSeenAt: now },
        });
      }
      if (plan.keep.length) {
        await tx.playlistTrack.updateMany({ where: { playlistId: pl.id, track: { spotifyId: { in: plan.keep } } }, data: { lastSeenAt: now } });
      }
      if (plan.remove.length) {
        // Never delete: discoveries and rows stay so History can show "removed from playlist".
        await tx.playlistTrack.updateMany({
          where: { playlistId: pl.id, track: { spotifyId: { in: plan.remove } } },
          data: { removedAt: now },
        });
      }
      await tx.monitoredPlaylist.update({
        where: { id: pl.id },
        data: { baselineDone: true, snapshotId: meta.snapshotId, name: meta.name, imageUrl: meta.imageUrl, ownerName: meta.ownerName, trackCount: fetched.length },
      });
    },
    { timeout: 25_000 },
  );
  return { announced: plan.add.filter((a) => a.event).length, removed: plan.remove.length };
}

/**
 * Sync one playlist. Order matters for correctness:
 *  1. read Spotify (network, outside any transaction)
 *  2. apply every database change in ONE transaction
 *  3. only then record success. A failure anywhere leaves the stored snapshot untouched,
 *     so the next run re-diffs against the last good state.
 * Idempotent: DiscoveryEvent has a unique (ownerId, dedupeKey), so a retry or a racing
 * second run cannot create duplicates.
 */
export async function syncPlaylist(
  deps: { db: Db; api: SpotifyApi; clock: Clock },
  ownerId: string,
  playlistId: string,
  opts: { force?: boolean } = {},
): Promise<SyncSummary> {
  const { db, api, clock } = deps;
  const pl = await db.monitoredPlaylist.findFirst({ where: { id: playlistId, ownerId } });
  if (!pl) throw new AppError('not_found', 'playlist.not_found', 'Playlist not found.');
  if (pl.source === 'IMPORT') throw new AppError('validation', 'playlist.import_source', 'Imported playlists are refreshed by importing a newer export.');

  const started = clock.now();
  const run = await db.syncRun.create({ data: { id: newId('syn'), playlistId: pl.id, startedAt: started } });

  const finish = async (s: Omit<SyncSummary, 'playlistId'>, data: Record<string, unknown> = {}) => {
    const now = clock.now();
    await db.$transaction([
      db.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: now, outcome: s.outcome, newTracks: s.newTracks, removedTracks: s.removedTracks, errorMessage: s.error ?? null },
      }),
      db.monitoredPlaylist.update({ where: { id: pl.id }, data }),
    ]);
    return { playlistId: pl.id, ...s };
  };

  try {
    const meta = await api.playlistMeta(pl.spotifyPlaylistId);

    if (!opts.force && pl.baselineDone && meta.snapshotId && meta.snapshotId === pl.snapshotId) {
      return await finish(
        { outcome: 'NO_CHANGES', newTracks: 0, removedTracks: 0 },
        { lastSyncedAt: clock.now(), syncStatus: 'OK', syncError: null, name: meta.name, imageUrl: meta.imageUrl },
      );
    }

    const { announced, removed } = await applySnapshot(deps, ownerId, pl, meta, await api.playlistTracks(pl.spotifyPlaylistId));

    return await finish(
      { outcome: announced || removed ? 'SUCCESS' : 'NO_CHANGES', newTracks: announced, removedTracks: removed },
      { lastSyncedAt: clock.now(), syncStatus: 'OK', syncError: null },
    );
  } catch (e) {
    return finish(...failure(e));
  }
}

function failure(e: unknown): [Omit<SyncSummary, 'playlistId'>, Record<string, unknown>] {
  const base = { newTracks: 0, removedTracks: 0 };
  if (e instanceof AppError && e.kind === 'rate_limited') {
    return [{ ...base, outcome: 'RATE_LIMITED', error: 'Spotify is rate limiting requests. Try again in a few minutes.' }, { syncStatus: 'RATE_LIMITED', syncError: 'Rate limited' }];
  }
  if (e instanceof SpotifyAccessError && e.reason === 'revoked') {
    return [{ ...base, outcome: 'FAILED', error: 'Spotify sign-in expired. Reconnect to continue.', needsReconnect: true }, { syncStatus: 'FAILED', syncError: 'Sign-in expired' }];
  }
  if (e instanceof SpotifyAccessError && e.reason === 'unreadable') {
    return [{ ...base, outcome: 'UNREADABLE', error: 'Spotify will not return this playlist.' }, { syncStatus: 'UNREADABLE', syncError: 'Spotify will not return this playlist.' }];
  }
  // Messages are authored by this codebase and never contain tokens; truncate defensively anyway.
  const msg = (e instanceof AppError ? e.message : 'Unexpected sync error.').slice(0, MAX_ERR);
  return [{ ...base, outcome: 'FAILED', error: msg }, { syncStatus: 'FAILED', syncError: msg }];
}

/**
 * Sync every monitored playlist, least recently synced first, within a time budget so a
 * serverless invocation never overruns. Playlists are independent: one failure never hides
 * another, and a revoked sign-in or rate limit stops the loop (every remaining call would fail identically).
 */
export async function syncAll(
  deps: { db: Db; api: SpotifyApi; clock: Clock },
  ownerId: string,
  opts: { budgetMs?: number; force?: boolean } = {},
): Promise<SyncSummary[]> {
  const { budgetMs = 45_000 } = opts;
  const t0 = deps.clock.now().getTime();
  const lists = await deps.db.monitoredPlaylist.findMany({
    where: { ownerId, monitoring: true, source: 'SPOTIFY_API' },
    orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }],
    select: { id: true },
  });
  const out: SyncSummary[] = [];
  for (const l of lists) {
    if (deps.clock.now().getTime() - t0 > budgetMs) break;
    const s = await syncPlaylist(deps, ownerId, l.id, { force: opts.force });
    out.push(s);
    if (s.outcome === 'RATE_LIMITED' || s.needsReconnect) break;
  }
  return out;
}
