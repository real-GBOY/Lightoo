import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db';
import { fixedClock } from '@/lib/clock';
import { RateLimited } from '@/lib/errors';
import { applyStateOps } from '@/lib/services/library';
import { syncPlaylist } from '@/lib/services/sync';
import { SpotifyAccessError, SpotifyApi } from '@/lib/spotify/client';

const clock = fixedClock(new Date('2026-10-27T12:00:00Z'));

/** Stub exposing only what syncPlaylist touches before it reaches the transaction. */
function syncDb(playlist: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const db = {
    monitoredPlaylist: {
      findFirst: vi.fn(async () => playlist),
      update: vi.fn((a: unknown) => (updates.push(a), a)),
    },
    syncRun: { create: vi.fn(async () => ({ id: 'syn_1' })), update: vi.fn((a: unknown) => a) },
    playlistTrack: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? Promise.reject(new Error('boom')) : arg)),
  };
  return { db: db as unknown as Db, raw: db, updates };
}

const pl = { id: 'pl_1', ownerId: 'usr_1', spotifyPlaylistId: 'sp', baselineDone: true, seedRecent: false, snapshotId: 'snap1' };

describe('syncPlaylist', () => {
  it('rejects a playlist owned by someone else (ownership enforced in the query)', async () => {
    const { db, raw } = syncDb(null);
    await expect(syncPlaylist({ db, api: {} as SpotifyApi, clock }, 'usr_other', 'pl_1')).rejects.toMatchObject({ code: 'playlist.not_found' });
    expect(raw.monitoredPlaylist.findFirst).toHaveBeenCalledWith({ where: { id: 'pl_1', ownerId: 'usr_other' } });
  });

  it('skips the track download when the snapshot is unchanged', async () => {
    const { db } = syncDb(pl);
    const api = { playlistMeta: vi.fn(async () => ({ name: 'N', imageUrl: null, snapshotId: 'snap1' })), playlistTracks: vi.fn() };
    const r = await syncPlaylist({ db, api: api as unknown as SpotifyApi, clock }, 'usr_1', 'pl_1');
    expect(r.outcome).toBe('NO_CHANGES');
    expect(api.playlistTracks).not.toHaveBeenCalled();
  });

  it('a database failure mid-sync reports FAILED and never advances the snapshot', async () => {
    const { db, raw } = syncDb(pl);
    const api = {
      playlistMeta: vi.fn(async () => ({ name: 'N', ownerName: null, imageUrl: null, snapshotId: 'snap2' })),
      playlistTracks: vi.fn(async () => []),
    };
    const r = await syncPlaylist({ db, api: api as unknown as SpotifyApi, clock }, 'usr_1', 'pl_1');
    expect(r.outcome).toBe('FAILED');
    expect(r.error).not.toMatch(/boom/); // internal error text is not leaked
    const playlistWrites = raw.monitoredPlaylist.update.mock.calls.map((c) => JSON.stringify(c[0]));
    expect(playlistWrites.join()).not.toContain('snap2'); // snapshot untouched
    expect(JSON.stringify(raw.monitoredPlaylist.update.mock.calls)).toContain('FAILED');
  });

  it('maps rate limits, unreadable playlists and revoked sign-in to distinct outcomes', async () => {
    const run = async (err: unknown) => {
      const { db } = syncDb(pl);
      const api = { playlistMeta: vi.fn(async () => { throw err; }) };
      return syncPlaylist({ db, api: api as unknown as SpotifyApi, clock }, 'usr_1', 'pl_1');
    };
    expect((await run(RateLimited('slow', 30))).outcome).toBe('RATE_LIMITED');
    expect((await run(new SpotifyAccessError('unreadable', 'x'))).outcome).toBe('UNREADABLE');
    const revoked = await run(new SpotifyAccessError('revoked', 'x'));
    expect(revoked).toMatchObject({ outcome: 'FAILED', needsReconnect: true });
  });
});

describe('applyStateOps reconciliation', () => {
  function stateDb(initial: Record<string, unknown>[] = []) {
    const rows = new Map(initial.map((r) => [r.trackId as string, r]));
    const upsert = vi.fn(async ({ where, create, update }: { where: { ownerId_trackId: { trackId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const k = where.ownerId_trackId.trackId;
      const next = rows.has(k) ? { ...rows.get(k), ...update } : { ...create };
      rows.set(k, next);
      return next;
    });
    const db = {
      discoveryEvent: { findMany: vi.fn(async () => [{ trackId: 't1' }]) },
      userTrackState: { findMany: vi.fn(async () => [...rows.values()]), upsert },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn({ userTrackState: { upsert } })),
    };
    return { db: db as unknown as Db, rows };
  }

  it('applies a first change and records the heard time', async () => {
    const { db, rows } = stateDb();
    const r = await applyStateOps(db, 'usr_1', clock, [{ trackId: 't1', heard: true, at: '2026-10-27T10:00:00Z' }]);
    expect(r[0]).toEqual({ trackId: 't1', applied: true });
    expect(rows.get('t1')).toMatchObject({ heard: true });
  });

  it('drops an offline change that is older than the server state (no overwrite of newer data)', async () => {
    const { db, rows } = stateDb([{ trackId: 't1', heard: true, heardUpdatedAt: new Date('2026-10-27T11:00:00Z') }]);
    const r = await applyStateOps(db, 'usr_1', clock, [{ trackId: 't1', heard: false, at: '2026-10-27T09:00:00Z' }]);
    expect(r[0]).toMatchObject({ applied: false, reason: 'stale' });
    expect(rows.get('t1')).toMatchObject({ heard: true });
  });

  it('replaying the same queued op is a no-op', async () => {
    const { db } = stateDb();
    const op = { trackId: 't1', saved: true, at: '2026-10-27T10:00:00Z' };
    expect((await applyStateOps(db, 'usr_1', clock, [op]))[0]?.applied).toBe(true);
    expect((await applyStateOps(db, 'usr_1', clock, [op]))[0]).toMatchObject({ applied: false, reason: 'stale' });
  });

  it('heard and saved reconcile independently', async () => {
    const { db, rows } = stateDb([{ trackId: 't1', heard: true, heardUpdatedAt: new Date('2026-10-27T11:00:00Z') }]);
    await applyStateOps(db, 'usr_1', clock, [{ trackId: 't1', heard: false, saved: true, at: '2026-10-27T10:00:00Z' }]);
    expect(rows.get('t1')).toMatchObject({ heard: true, saved: true });
  });

  it("refuses tracks that aren't the owner's discoveries", async () => {
    const { db } = stateDb();
    const r = await applyStateOps(db, 'usr_1', clock, [{ trackId: 'someone-elses', heard: true }]);
    expect(r[0]).toMatchObject({ applied: false, reason: 'not_found' });
  });
});
