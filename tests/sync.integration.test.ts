// Runs against a real Postgres. Skipped unless TEST_DATABASE_URL is set (migrations must already be applied):
//   TEST_DATABASE_URL=postgresql://... npx vitest run tests/sync.integration.test.ts
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '@/lib/clock';
import { newId } from '@/lib/ids';
import { addPlaylist, applyStateOps, listDiscoveries, listPlaylists, feedQuery, removePlaylist, deleteAllData } from '@/lib/services/library';
import { syncPlaylist } from '@/lib/services/sync';
import { SpotifyAccessError, type SpotifyApi, type SpotifyTrack } from '@/lib/spotify/client';

const url = process.env.TEST_DATABASE_URL;
const PLAYLIST = '37i9dQZF1DXcBWIGoYBM5M';

const track = (id: string, position: number): SpotifyTrack => ({
  spotifyId: id, title: `Title ${id}`, artists: [{ name: `Artist ${id}` }], albumName: 'Album', imageUrl: null,
  durationMs: 1000, isrc: null, isPlayable: true, addedAt: null, position,
});

class FakeApi {
  tracks: SpotifyTrack[] = [];
  snapshot = 's1';
  fail: Error | null = null;
  async playlistMeta() {
    if (this.fail) throw this.fail;
    return { id: PLAYLIST, name: 'Late Drives', ownerName: 'me', ownerId: 'me', imageUrl: null, snapshotId: this.snapshot, trackCount: this.tracks.length };
  }
  async playlistTracks() { return this.tracks; }
}

describe.skipIf(!url)('sync against Postgres', () => {
  const db = new PrismaClient({ datasourceUrl: url });
  const api = new FakeApi();
  const t0 = new Date('2026-10-27T12:00:00Z');
  let owner = '';
  const deps = (at = t0) => ({ db, api: api as unknown as SpotifyApi, clock: fixedClock(at) });

  beforeEach(async () => {
    await db.discoveryEvent.deleteMany();
    await db.monitoredPlaylist.deleteMany();
    await db.track.deleteMany();
    await db.user.deleteMany();
    owner = (await db.user.create({ data: { id: newId('usr'), email: `${newId('t')}@example.com` } })).id;
    api.tracks = []; api.snapshot = 's1'; api.fail = null;
  });
  afterAll(async () => { await db.$disconnect(); });

  const add = (seed = true) => addPlaylist(deps(), owner, `https://open.spotify.com/playlist/${PLAYLIST}`, seed);
  const events = () => db.discoveryEvent.findMany({ where: { ownerId: owner }, orderBy: { detectedAt: 'asc' } });

  it('baseline seeds only the 10 most recent tracks and stores all memberships', async () => {
    api.tracks = Array.from({ length: 25 }, (_, i) => track(`t${i}`, i));
    const { sync, playlist } = await add();
    expect(sync.outcome).toBe('SUCCESS');
    expect(await events()).toHaveLength(10);
    expect(await db.playlistTrack.count({ where: { playlistId: playlist.id } })).toBe(25);
    expect((await db.monitoredPlaylist.findUniqueOrThrow({ where: { id: playlist.id } })).baselineDone).toBe(true);
  });

  it('is idempotent: re-syncing (even forced) creates no duplicate events', async () => {
    api.tracks = [track('a', 0), track('b', 1)];
    const { playlist } = await add();
    const before = (await events()).length;
    for (let i = 0; i < 3; i++) await syncPlaylist(deps(), owner, playlist.id, { force: true });
    expect(await events()).toHaveLength(before);
  });

  it('detects a new track once, with LIGHTOO’s detection time', async () => {
    api.tracks = [track('a', 0)];
    const { playlist } = await add(false);
    expect(await events()).toHaveLength(0);
    api.tracks = [track('a', 0), track('b', 1)]; api.snapshot = 's2';
    const later = new Date('2026-10-28T09:30:00Z');
    const r = await syncPlaylist(deps(later), owner, playlist.id);
    expect(r).toMatchObject({ outcome: 'SUCCESS', newTracks: 1 });
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'NEW_TRACK', detectedAt: later, playlistName: 'Late Drives' });
    await syncPlaylist(deps(later), owner, playlist.id, { force: true });
    expect(await events()).toHaveLength(1);
  });

  it('two racing syncs still yield exactly one event per track', async () => {
    api.tracks = [track('a', 0)];
    const { playlist } = await add(false);
    api.tracks = [track('a', 0), track('b', 1), track('c', 2)]; api.snapshot = 's2';
    await Promise.all([syncPlaylist(deps(), owner, playlist.id), syncPlaylist(deps(), owner, playlist.id, { force: true })]);
    expect(await events()).toHaveLength(2);
  });

  it('keeps discoveries and tags removal; a returning track is not announced again', async () => {
    api.tracks = [track('a', 0), track('b', 1)];
    const { playlist } = await add(true);
    api.tracks = [track('a', 0)]; api.snapshot = 's2';
    const r = await syncPlaylist(deps(), owner, playlist.id);
    expect(r.removedTracks).toBe(1);
    expect(await events()).toHaveLength(2); // history intact
    const page = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history' }));
    expect(page.items.find((i) => i.track.spotifyId === 'b')?.removedFromPlaylist).toBe(true);

    api.tracks = [track('a', 0), track('b', 1)]; api.snapshot = 's3';
    await syncPlaylist(deps(), owner, playlist.id);
    expect(await events()).toHaveLength(2);
    const again = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history' }));
    expect(again.items.find((i) => i.track.spotifyId === 'b')?.removedFromPlaylist).toBe(false);
  });

  it('a failed check leaves the snapshot untouched and records the run', async () => {
    api.tracks = [track('a', 0)];
    const { playlist } = await add(false);
    api.fail = new SpotifyAccessError('unreadable', 'x'); api.snapshot = 's9';
    const r = await syncPlaylist(deps(), owner, playlist.id, { force: true });
    expect(r.outcome).toBe('UNREADABLE');
    const pl = await db.monitoredPlaylist.findUniqueOrThrow({ where: { id: playlist.id } });
    expect(pl).toMatchObject({ snapshotId: 's1', syncStatus: 'UNREADABLE' });
    expect((await db.syncRun.findMany({ where: { playlistId: playlist.id } })).map((s) => s.outcome)).toContain('UNREADABLE');
  });

  it('rejects a duplicate playlist at the application and database level', async () => {
    api.tracks = [track('a', 0)];
    await add();
    await expect(add()).rejects.toMatchObject({ code: 'playlist.duplicate' });
    await expect(
      db.monitoredPlaylist.create({ data: { id: newId('pl'), ownerId: owner, spotifyPlaylistId: PLAYLIST, name: 'dup' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('never lets another owner read or sync someone else’s playlist', async () => {
    api.tracks = [track('a', 0)];
    const { playlist } = await add();
    const other = (await db.user.create({ data: { id: newId('usr'), email: `${newId('o')}@example.com` } })).id;
    await expect(syncPlaylist(deps(), other, playlist.id)).rejects.toMatchObject({ code: 'playlist.not_found' });
    expect(await listPlaylists(db, other, fixedClock(t0))).toEqual([]);
    expect((await listDiscoveries(db, other, fixedClock(t0), feedQuery.parse({ scope: 'history' }))).items).toEqual([]);
    const tid = (await db.track.findFirstOrThrow()).id;
    expect((await applyStateOps(db, other, fixedClock(t0), [{ trackId: tid, heard: true }]))[0]).toMatchObject({ applied: false, reason: 'not_found' });
    await expect(removePlaylist(db, other, playlist.id)).rejects.toMatchObject({ code: 'playlist.not_found' });
  });

  it('paginates the feed with a stable cursor and honours heard/saved filters', async () => {
    api.tracks = Array.from({ length: 7 }, (_, i) => track(`t${i}`, i));
    await add(true);
    const p1 = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history', limit: 3 }));
    const p2 = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history', limit: 3, cursor: p1.nextCursor! }));
    const p3 = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history', limit: 3, cursor: p2.nextCursor! }));
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(p3.nextCursor).toBeNull();

    const first = p1.items[0]!.track.id;
    await applyStateOps(db, owner, fixedClock(t0), [{ trackId: first, heard: true, saved: true, at: t0.toISOString() }]);
    const unheard = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history', filter: 'unheard' }));
    expect(unheard.items).toHaveLength(6);
    const saved = await listDiscoveries(db, owner, fixedClock(t0), feedQuery.parse({ scope: 'history', filter: 'saved' }));
    expect(saved.items.map((i) => i.track.id)).toEqual([first]);
  });

  it('deleteAllData wipes the owner’s records and orphaned tracks', async () => {
    api.tracks = [track('a', 0)];
    await add();
    await deleteAllData(db, owner);
    expect(await db.discoveryEvent.count()).toBe(0);
    expect(await db.monitoredPlaylist.count()).toBe(0);
    expect(await db.track.count()).toBe(0);
  });
});
