// Runs against a real Postgres. Skipped unless TEST_DATABASE_URL is set (migrations applied). Truncates tables.
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { importPlaylist } from '@/lib/services/importer';
import { syncAll, syncPlaylist } from '@/lib/services/sync';

const url = process.env.TEST_DATABASE_URL;
const ID = (n: number) => String(n).padStart(22, 'a');
const tr = (n: number) => ({
  id: ID(n),
  title: `Song ${n}`,
  artists: ['Halden Ivy'],
  album: 'Album',
  addedAt: `2026-10-${String((n % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
});

describe.skipIf(!url)('import from a data export against Postgres', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const t0 = new Date('2026-10-27T12:00:00Z');
  let owner = '';

  beforeEach(async () => {
    await db.discoveryEvent.deleteMany();
    await db.monitoredPlaylist.deleteMany();
    await db.track.deleteMany();
    await db.user.deleteMany();
    owner = (await db.user.create({ data: { id: newId('usr'), email: `${newId('i')}@example.com` } })).id;
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  const imp = (name: string, ns: number[], seed = true, at = t0) =>
    importPlaylist({ db, clock: fixedClock(at) }, owner, { name, seedRecent: seed, tracks: ns.map(tr) });

  it('first import sets the baseline and seeds the 10 most recent; the same file again changes nothing', async () => {
    const all = Array.from({ length: 25 }, (_, i) => i + 1);
    expect(await imp('Late Drives', all)).toMatchObject({ created: true, outcome: 'SUCCESS', newTracks: 10 });
    const pl = await db.monitoredPlaylist.findFirstOrThrow({ where: { ownerId: owner } });
    expect(pl).toMatchObject({ source: 'IMPORT', baselineDone: true, trackCount: 25 });
    expect(await db.playlistTrack.count({ where: { playlistId: pl.id } })).toBe(25);
    expect(await imp('Late Drives', all)).toMatchObject({ created: false, outcome: 'NO_CHANGES', newTracks: 0 });
    expect(await db.discoveryEvent.count()).toBe(10);
  });

  it('a newer export announces only new tracks, tags removed ones and keeps history', async () => {
    await imp('P', [1, 2, 3], false);
    expect(await db.discoveryEvent.count()).toBe(0);
    const later = new Date('2026-10-28T08:00:00Z');
    expect(await imp('P', [2, 3, 4, 5], false, later)).toMatchObject({ created: false, outcome: 'SUCCESS', newTracks: 2, removedTracks: 1 });
    const ev = await db.discoveryEvent.findMany({ where: { ownerId: owner } });
    expect(ev.map((e) => e.detectedAt.toISOString())).toEqual([later.toISOString(), later.toISOString()]);
    const removed = await db.playlistTrack.findMany({ where: { removedAt: { not: null } }, include: { track: true } });
    expect(removed.map((x) => x.track.spotifyId)).toEqual([ID(1)]);
    await imp('P', [2, 3, 4, 5], false, later); // idempotent
    expect(await db.discoveryEvent.count()).toBe(2);
  });

  it('refuses an empty file over a populated playlist, and live sync never touches imports', async () => {
    await imp('P', [1, 2], false);
    await expect(imp('P', [], false)).rejects.toMatchObject({ code: 'import.empty' });
    expect(await db.playlistTrack.count({ where: { removedAt: { not: null } } })).toBe(0);
    const pl = await db.monitoredPlaylist.findFirstOrThrow({ where: { ownerId: owner } });
    const deps = { db, api: {} as never, clock: fixedClock(t0) };
    await expect(syncPlaylist(deps, owner, pl.id)).rejects.toMatchObject({ code: 'playlist.import_source' });
    expect(await syncAll(deps, owner)).toEqual([]);
  });

  it('lists every playlist track in order (not just discoveries) and treats them all as the owner’s', async () => {
    const { listPlaylistTracks, ownsTrack } = await import('@/lib/services/library');
    const all = Array.from({ length: 30 }, (_, i) => i + 1);
    const { playlistId } = await imp('Big', all, true); // only 10 become discoveries
    const lib = await listPlaylistTracks(db, owner, playlistId);
    expect(lib.total).toBe(30);
    expect(lib.items.map((i) => i.title)).toEqual(all.map((n) => `Song ${n}`));
    expect(lib.items.every((i) => i.audioOnServer === false)).toBe(true);
    const undiscovered = await db.track.findFirstOrThrow({ where: { spotifyId: ID(1) } }); // oldest, not seeded
    expect(await db.discoveryEvent.count({ where: { trackId: undiscovered.id } })).toBe(0);
    expect(await ownsTrack(db, owner, undiscovered.id)).toBe(true);
    const stranger = (await db.user.create({ data: { id: newId('usr'), email: `${newId('s')}@example.com` } })).id;
    expect(await ownsTrack(db, stranger, undiscovered.id)).toBe(false);
    await expect(listPlaylistTracks(db, stranger, playlistId)).rejects.toMatchObject({ code: 'playlist.not_found' });
    await db.audioAsset.create({ data: { id: newId('aud'), ownerId: owner, trackId: undiscovered.id, sourceType: 'LOCAL_FILE', mimeType: 'audio/mpeg', sizeBytes: 10 } });
    expect((await listPlaylistTracks(db, owner, playlistId)).items.filter((i) => i.audioOnServer)).toHaveLength(1);
  });

  it('keeps richer metadata from an earlier Spotify sync when the same track is imported', async () => {
    await db.track.create({
      data: { id: newId('trk'), spotifyId: ID(1), title: 'Song 1', artists: [{ name: 'Halden Ivy' }], artistNames: 'Halden Ivy', imageUrl: 'https://img.example/c.jpg', durationMs: 200000 },
    });
    await imp('P', [1], true);
    expect((await db.track.findUniqueOrThrow({ where: { spotifyId: ID(1) } })).imageUrl).toBe('https://img.example/c.jpg');
  });
});
