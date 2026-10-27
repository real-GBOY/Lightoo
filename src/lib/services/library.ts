import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Db } from '../db';
import type { Clock } from '../clock';
import { AppError, Conflict, NotFound, ValidationError } from '../errors';
import { newId } from '../ids';
import { parsePlaylistInput } from '../spotify/parse';
import type { SpotifyApi } from '../spotify/client';
import { syncPlaylist, type SyncSummary } from './sync';

export const NEW_MUSIC_DAYS = 7;

// ───────────────────────── playlists ─────────────────────────

export async function addPlaylist(
  deps: { db: Db; api: SpotifyApi; clock: Clock },
  ownerId: string,
  input: string,
  seedRecent: boolean,
): Promise<{ playlist: { id: string }; sync: SyncSummary }> {
  const parsed = parsePlaylistInput(input);
  if (!parsed.ok) {
    throw ValidationError(
      parsed.reason === 'wrong_type' ? 'playlist.wrong_type' : 'playlist.invalid_link',
      parsed.reason === 'wrong_type' ? `That is a Spotify ${parsed.kind} link. LIGHTOO monitors playlists.` : 'That does not look like a Spotify playlist link.',
      { kind: parsed.kind },
    );
  }
  const existing = await deps.db.monitoredPlaylist.findUnique({
    where: { ownerId_spotifyPlaylistId: { ownerId, spotifyPlaylistId: parsed.id } },
    select: { id: true },
  });
  if (existing) throw new AppError('conflict', 'playlist.duplicate', 'Already monitored.', { playlistId: existing.id });

  const meta = await deps.api.playlistMeta(parsed.id); // unreadable → SpotifyAccessError (403), surfaced as-is
  let pl;
  try {
    pl = await deps.db.monitoredPlaylist.create({
      data: {
        id: newId('pl'),
        ownerId,
        spotifyPlaylistId: parsed.id,
        name: meta.name,
        ownerName: meta.ownerName,
        imageUrl: meta.imageUrl,
        trackCount: meta.trackCount,
        seedRecent,
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') throw Conflict('playlist.duplicate', 'Already monitored.'); // lost a race
    throw e;
  }
  const sync = await syncPlaylist(deps, ownerId, pl.id, { force: true });
  return { playlist: { id: pl.id }, sync };
}

export async function listPlaylists(db: Db, ownerId: string, clock: Clock) {
  const since = new Date(clock.now().getTime() - NEW_MUSIC_DAYS * 86_400_000);
  const [lists, unheard] = await Promise.all([
    db.monitoredPlaylist.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } }),
    db.discoveryEvent.groupBy({
      by: ['playlistId'],
      where: { ownerId, detectedAt: { gte: since }, track: { states: { none: { ownerId, heard: true } } } },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(unheard.map((u) => [u.playlistId, u._count._all]));
  return lists.map((p) => ({
    id: p.id,
    spotifyPlaylistId: p.spotifyPlaylistId,
    name: p.name,
    ownerName: p.ownerName,
    imageUrl: p.imageUrl,
    trackCount: p.trackCount,
    monitoring: p.monitoring,
    syncStatus: p.syncStatus,
    syncError: p.syncError,
    lastSyncedAt: p.lastSyncedAt,
    newCount: counts.get(p.id) ?? 0,
  }));
}

export const playlistPatch = z.object({ monitoring: z.boolean() }).strict();

export async function setMonitoring(db: Db, ownerId: string, id: string, monitoring: boolean) {
  const r = await db.monitoredPlaylist.updateMany({ where: { id, ownerId }, data: { monitoring } });
  if (!r.count) throw NotFound('playlist.not_found', 'Playlist not found.');
}

/** Stop monitoring: the playlist row goes, discoveries stay (playlistId → null, name snapshot kept). */
export async function removePlaylist(db: Db, ownerId: string, id: string) {
  const r = await db.monitoredPlaylist.deleteMany({ where: { id, ownerId } });
  if (!r.count) throw NotFound('playlist.not_found', 'Playlist not found.');
}

// ───────────────────────── discoveries ─────────────────────────

export const feedQuery = z.object({
  filter: z.enum(['all', 'unheard', 'saved']).default('all'),
  scope: z.enum(['new', 'history']).default('new'),
  playlistId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type FeedQuery = z.infer<typeof feedQuery>;

const enc = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString('base64url');
function dec(c: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime())) throw ValidationError('cursor.invalid', 'Invalid cursor.');
  return { at, id };
}

export async function listDiscoveries(db: Db, ownerId: string, clock: Clock, q: FeedQuery) {
  const and: Prisma.DiscoveryEventWhereInput[] = [];
  if (q.scope === 'new') and.push({ detectedAt: { gte: new Date(clock.now().getTime() - NEW_MUSIC_DAYS * 86_400_000) } });
  if (q.playlistId) and.push({ playlistId: q.playlistId });
  if (q.filter === 'unheard') and.push({ track: { states: { none: { ownerId, heard: true } } } });
  if (q.filter === 'saved') and.push({ track: { states: { some: { ownerId, saved: true } } } });
  if (q.q) {
    and.push({
      OR: [
        { track: { title: { contains: q.q, mode: 'insensitive' } } },
        { track: { artistNames: { contains: q.q, mode: 'insensitive' } } },
        { playlistName: { contains: q.q, mode: 'insensitive' } },
      ],
    });
  }
  if (q.cursor) {
    const c = dec(q.cursor);
    and.push({ OR: [{ detectedAt: { lt: c.at } }, { detectedAt: c.at, id: { lt: c.id } }] });
  }

  // One query joins track + this owner's state: no N+1.
  const rows = await db.discoveryEvent.findMany({
    where: { ownerId, AND: and },
    orderBy: [{ detectedAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    include: { track: { include: { states: { where: { ownerId }, take: 1 }, audioAssets: { where: { ownerId }, select: { id: true }, take: 1 } } } },
  });
  const page = rows.slice(0, q.limit);

  // Removed-from-playlist tags, one extra query for the whole page.
  const pairs = page.filter((r) => r.playlistId).map((r) => ({ playlistId: r.playlistId!, trackId: r.trackId }));
  const removed = pairs.length
    ? await db.playlistTrack.findMany({ where: { removedAt: { not: null }, OR: pairs }, select: { playlistId: true, trackId: true } })
    : [];
  const removedSet = new Set(removed.map((r) => `${r.playlistId}:${r.trackId}`));

  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const st = r.track.states[0];
      return {
        id: r.id,
        type: r.type,
        detectedAt: r.detectedAt,
        playlist: r.playlistId ? { id: r.playlistId, name: r.playlistName } : { id: null, name: r.playlistName },
        removedFromPlaylist: r.playlistId ? removedSet.has(`${r.playlistId}:${r.trackId}`) : false,
        track: {
          id: r.track.id,
          spotifyId: r.track.spotifyId,
          title: r.track.title,
          artists: r.track.artists as { id?: string; name: string }[],
          albumName: r.track.albumName,
          imageUrl: r.track.imageUrl,
          durationMs: r.track.durationMs,
        },
        heard: st?.heard ?? false,
        saved: st?.saved ?? false,
        audioAssetId: r.track.audioAssets[0]?.id ?? null,
      };
    }),
    nextCursor: rows.length > q.limit && last ? enc(last.detectedAt, last.id) : null,
  };
}

// ───────────────────────── track state ─────────────────────────

export const stateOp = z.object({
  trackId: z.string().min(1),
  heard: z.boolean().optional(),
  saved: z.boolean().optional(),
  /** When the user made the change on their device (ISO). Enables last-writer-wins reconciliation. */
  at: z.string().datetime().optional(),
});
export type StateOp = z.infer<typeof stateOp>;
type StatePatch = { heard?: boolean; heardAt?: Date | null; heardUpdatedAt?: Date; saved?: boolean; savedAt?: Date | null; savedUpdatedAt?: Date };

/**
 * Per-field last-writer-wins. A queued offline change only applies if it is newer than the
 * server's last change to that field, so reconnecting never overwrites newer state.
 * Replaying the same op is a no-op (equal timestamp is not newer), so retries are safe.
 */
export async function applyStateOps(db: Db, ownerId: string, clock: Clock, ops: StateOp[]) {
  const ids = [...new Set(ops.map((o) => o.trackId))];
  // Ownership: a track is the owner's only if LIGHTOO recorded it as one of their discoveries.
  const owned = new Set(
    (await db.discoveryEvent.findMany({ where: { ownerId, trackId: { in: ids } }, select: { trackId: true }, distinct: ['trackId'] })).map((d) => d.trackId),
  );
  const current = new Map((await db.userTrackState.findMany({ where: { ownerId, trackId: { in: ids } } })).map((s) => [s.trackId, s]));
  const now = clock.now();
  const results: { trackId: string; applied: boolean; reason?: 'not_found' | 'stale' }[] = [];

  await db.$transaction(async (tx) => {
    for (const op of ops) {
      if (!owned.has(op.trackId)) {
        results.push({ trackId: op.trackId, applied: false, reason: 'not_found' });
        continue;
      }
      const at = op.at ? new Date(op.at) : now;
      const cur = current.get(op.trackId);
      const data: StatePatch = {};
      if (op.heard !== undefined && (!cur?.heardUpdatedAt || at > cur.heardUpdatedAt)) {
        Object.assign(data, { heard: op.heard, heardAt: op.heard ? at : null, heardUpdatedAt: at });
      }
      if (op.saved !== undefined && (!cur?.savedUpdatedAt || at > cur.savedUpdatedAt)) {
        Object.assign(data, { saved: op.saved, savedAt: op.saved ? at : null, savedUpdatedAt: at });
      }
      if (!Object.keys(data).length) {
        results.push({ trackId: op.trackId, applied: false, reason: 'stale' });
        continue;
      }
      const row = await tx.userTrackState.upsert({
        where: { ownerId_trackId: { ownerId, trackId: op.trackId } },
        create: { ...data, id: newId('uts'), ownerId, trackId: op.trackId },
        update: data,
      });
      current.set(op.trackId, row);
      results.push({ trackId: op.trackId, applied: true });
    }
  });
  return results;
}

// ───────────────────────── search / counts ─────────────────────────

/** Searches recorded tracks only, never Spotify. Grouped as the design shows: artists, playlists, tracks. */
export async function search(db: Db, ownerId: string, term: string) {
  const q = term.trim();
  if (!q) return { artists: [], playlists: [], tracks: [] };
  const [playlists, tracks] = await Promise.all([
    db.monitoredPlaylist.findMany({ where: { ownerId, name: { contains: q, mode: 'insensitive' } }, take: 10, select: { id: true, name: true, imageUrl: true } }),
    db.track.findMany({
      where: {
        discoveries: { some: { ownerId } },
        OR: [{ title: { contains: q, mode: 'insensitive' } }, { artistNames: { contains: q, mode: 'insensitive' } }],
      },
      take: 30,
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, artistNames: true, imageUrl: true },
    }),
  ]);
  const needle = q.toLowerCase();
  const artists = [...new Set(tracks.flatMap((t) => t.artistNames.split(', ')).filter((a) => a.toLowerCase().includes(needle)))].slice(0, 10);
  return { artists, playlists, tracks };
}

/** Data counts for the Delete-all-data confirmation. */
export async function dataCounts(db: Db, ownerId: string) {
  const [playlists, discoveries, saved] = await Promise.all([
    db.monitoredPlaylist.count({ where: { ownerId } }),
    db.discoveryEvent.count({ where: { ownerId } }),
    db.userTrackState.count({ where: { ownerId, saved: true } }),
  ]);
  return { playlists, discoveries, saved };
}

/** Destructive: removes everything the owner has recorded. Tracks are shared metadata and are garbage-collected if orphaned. */
export async function deleteAllData(db: Db, ownerId: string) {
  await db.$transaction([
    db.discoveryEvent.deleteMany({ where: { ownerId } }),
    db.userTrackState.deleteMany({ where: { ownerId } }),
    db.playbackHistory.deleteMany({ where: { ownerId } }),
    db.audioAsset.deleteMany({ where: { ownerId } }),
    db.monitoredPlaylist.deleteMany({ where: { ownerId } }),
    db.spotifyConnection.deleteMany({ where: { ownerId } }),
    db.track.deleteMany({ where: { discoveries: { none: {} }, playlistTracks: { none: {} }, audioAssets: { none: {} } } }),
  ]);
}
