import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db';
import type { Clock } from '../clock';
import { ValidationError } from '../errors';
import { newId } from '../ids';
import { importKey } from '../spotify/exportParser';
import type { SpotifyTrack } from '../spotify/client';
import { applySnapshot } from './sync';

export const importBody = z.object({
  name: z.string().trim().min(1).max(200),
  seedRecent: z.boolean().default(true),
  tracks: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9]{22}$/),
        title: z.string().min(1).max(500),
        artists: z.array(z.string().min(1).max(200)).max(20),
        album: z.string().max(500).nullable(),
        addedAt: z.string().datetime().nullable(),
      }),
    )
    .max(10_000),
});
export type ImportBody = z.infer<typeof importBody>;

export type ImportSummary = {
  playlistId: string;
  created: boolean;
  outcome: 'SUCCESS' | 'NO_CHANGES';
  newTracks: number;
  removedTracks: number;
};

/**
 * Loads one playlist from a Spotify data-export file. Uses the same diff/transaction as live sync
 * (applySnapshot), so a first import sets the baseline (optionally seeding the 10 most recent), and a
 * later import of a newer export announces only what is new and tags what disappeared. The export has
 * no playlist id, so a playlist is identified by its name (see importKey).
 * Identical content is a no-op (snapshot hash), so re-importing the same file never duplicates anything.
 */
export async function importPlaylist(deps: { db: Db; clock: Clock }, ownerId: string, input: ImportBody): Promise<ImportSummary> {
  const { db, clock } = deps;
  const key = importKey(input.name);
  const where = { ownerId_spotifyPlaylistId: { ownerId, spotifyPlaylistId: key } };

  const existing = await db.monitoredPlaylist.findUnique({ where });
  if (input.tracks.length === 0 && existing && existing.trackCount > 0) {
    // An empty file over a populated playlist would tag every track as removed. Almost certainly a mistake.
    throw ValidationError('import.empty', `The file has no tracks for “${input.name}”. Nothing was changed.`);
  }

  const pl =
    existing ??
    (await db.monitoredPlaylist.create({
      data: { id: newId('pl'), ownerId, spotifyPlaylistId: key, name: input.name, source: 'IMPORT', seedRecent: input.seedRecent },
    }));

  const snapshotId = `import:${createHash('sha1').update(input.tracks.map((t) => t.id).join(',')).digest('hex')}`;
  const started = clock.now();
  const run = await db.syncRun.create({ data: { id: newId('syn'), playlistId: pl.id, startedAt: started } });

  try {
    if (existing?.baselineDone && existing.snapshotId === snapshotId) {
      await db.$transaction([
        db.syncRun.update({ where: { id: run.id }, data: { finishedAt: clock.now(), outcome: 'NO_CHANGES' } }),
        db.monitoredPlaylist.update({ where: { id: pl.id }, data: { lastSyncedAt: clock.now(), syncStatus: 'OK', syncError: null } }),
      ]);
      return { playlistId: pl.id, created: false, outcome: 'NO_CHANGES', newTracks: 0, removedTracks: 0 };
    }

    const tracks: SpotifyTrack[] = input.tracks.map((t, position) => ({
      spotifyId: t.id,
      title: t.title,
      artists: (t.artists.length ? t.artists : ['Unknown artist']).map((name) => ({ name })),
      albumName: t.album,
      imageUrl: null,
      durationMs: null,
      isrc: null,
      isPlayable: true,
      addedAt: t.addedAt ? new Date(t.addedAt) : null,
      position,
    }));
    const { announced, removed } = await applySnapshot(
      deps,
      ownerId,
      pl,
      { name: input.name, ownerName: null, imageUrl: pl.imageUrl, snapshotId },
      tracks,
    );
    const outcome = announced || removed ? 'SUCCESS' : 'NO_CHANGES';
    await db.$transaction([
      db.syncRun.update({ where: { id: run.id }, data: { finishedAt: clock.now(), outcome, newTracks: announced, removedTracks: removed } }),
      db.monitoredPlaylist.update({ where: { id: pl.id }, data: { lastSyncedAt: clock.now(), syncStatus: 'OK', syncError: null } }),
    ]);
    return { playlistId: pl.id, created: !existing, outcome, newTracks: announced, removedTracks: removed };
  } catch (e) {
    await db.$transaction([
      db.syncRun.update({ where: { id: run.id }, data: { finishedAt: clock.now(), outcome: 'FAILED', errorMessage: 'Import failed.' } }),
      db.monitoredPlaylist.update({ where: { id: pl.id }, data: { syncStatus: 'FAILED', syncError: 'Import failed.' } }),
    ]);
    throw e;
  }
}
