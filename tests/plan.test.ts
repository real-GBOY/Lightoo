import { describe, expect, it } from 'vitest';
import type { SpotifyTrack } from '@/lib/spotify/client';
import { SEED_COUNT, dedupeKey, planSync } from '@/lib/services/plan';

const t = (id: string, position: number, addedAt?: string): SpotifyTrack => ({
  spotifyId: id, title: id, artists: [{ name: 'A' }], albumName: null, imageUrl: null, durationMs: null,
  isrc: null, isPlayable: true, addedAt: addedAt ? new Date(addedAt) : null, position,
});

describe('planSync', () => {
  it('baseline: announces nothing when seeding is off', () => {
    const p = planSync({ baselineDone: false, seedRecent: false, existing: [], fetched: [t('a', 0), t('b', 1)] });
    expect(p.add).toHaveLength(2);
    expect(p.add.every((a) => a.event === null)).toBe(true);
  });

  it('baseline with seeding: only the most recent SEED_COUNT become discoveries', () => {
    const fetched = Array.from({ length: 25 }, (_, i) => t(`t${i}`, i));
    const p = planSync({ baselineDone: false, seedRecent: true, existing: [], fetched });
    const seeded = p.add.filter((a) => a.event === 'SEEDED').map((a) => a.track.spotifyId);
    expect(seeded).toHaveLength(SEED_COUNT);
    expect(seeded).toContain('t24'); // appended last = newest
    expect(seeded).not.toContain('t0');
  });

  it('seed ranking prefers added_at over position', () => {
    const fetched = [t('old', 5, '2020-01-01T00:00:00Z'), t('new', 0, '2026-10-01T00:00:00Z')];
    const p = planSync({ baselineDone: false, seedRecent: true, existing: [], fetched });
    expect(p.add.map((a) => a.track.spotifyId).sort()).toEqual(['new', 'old']); // both fit under the cap
    const many = Array.from({ length: 12 }, (_, i) => t(`x${i}`, i, `2020-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
    many.push(t('latest', 0, '2026-10-01T00:00:00Z'));
    const seeded = planSync({ baselineDone: false, seedRecent: true, existing: [], fetched: many }).add.filter((a) => a.event).map((a) => a.track.spotifyId);
    expect(seeded).toContain('latest');
  });

  it('after baseline: unseen tracks are NEW_TRACK, known ones are kept', () => {
    const p = planSync({ baselineDone: true, seedRecent: true, existing: [{ spotifyId: 'a', removedAt: null }], fetched: [t('a', 0), t('b', 1)] });
    expect(p.add).toEqual([{ track: expect.objectContaining({ spotifyId: 'b' }), event: 'NEW_TRACK' }]);
    expect(p.keep).toEqual(['a']);
  });

  it('is idempotent: re-planning against its own result is empty', () => {
    const fetched = [t('a', 0), t('b', 1)];
    const first = planSync({ baselineDone: true, seedRecent: false, existing: [], fetched });
    const existing = first.add.map((a) => ({ spotifyId: a.track.spotifyId, removedAt: null }));
    const second = planSync({ baselineDone: true, seedRecent: false, existing, fetched });
    expect(second.add).toEqual([]);
    expect(second.remove).toEqual([]);
    expect(second.restore).toEqual([]);
  });

  it('removal is a tag, not a deletion; return restores without a new discovery', () => {
    const gone = planSync({ baselineDone: true, seedRecent: false, existing: [{ spotifyId: 'a', removedAt: null }], fetched: [] });
    expect(gone.remove).toEqual(['a']);
    const back = planSync({ baselineDone: true, seedRecent: false, existing: [{ spotifyId: 'a', removedAt: new Date() }], fetched: [t('a', 0)] });
    expect(back.restore).toEqual(['a']);
    expect(back.add).toEqual([]); // no duplicate announcement
  });

  it('an already-removed track that stays absent is not removed again', () => {
    const p = planSync({ baselineDone: true, seedRecent: false, existing: [{ spotifyId: 'a', removedAt: new Date() }], fetched: [] });
    expect(p.remove).toEqual([]);
  });

  it('collapses duplicate entries within one playlist', () => {
    const p = planSync({ baselineDone: true, seedRecent: false, existing: [], fetched: [t('a', 0), t('a', 3), t('b', 4)] });
    expect(p.add.map((a) => a.track.spotifyId)).toEqual(['a', 'b']);
  });
});

describe('dedupeKey', () => {
  it('is stable per playlist + track', () => {
    expect(dedupeKey('pl_1', 'abc')).toBe('pl_1:abc');
  });
});
