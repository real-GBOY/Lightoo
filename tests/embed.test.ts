import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db';
import { embedIdOf, playlistPatch, updatePlaylist } from '@/lib/services/library';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('embedIdOf', () => {
  it('live playlists use their own id; imported ones only when linked', () => {
    expect(embedIdOf({ source: 'SPOTIFY_API', spotifyPlaylistId: ID, embedId: null })).toBe(ID);
    expect(embedIdOf({ source: 'IMPORT', spotifyPlaylistId: 'import:abc', embedId: null })).toBeNull();
    expect(embedIdOf({ source: 'IMPORT', spotifyPlaylistId: 'import:abc', embedId: ID })).toBe(ID);
  });
});

describe('playlistPatch + updatePlaylist', () => {
  it('requires something to update and rejects unknown fields', () => {
    expect(playlistPatch.safeParse({}).success).toBe(false);
    expect(playlistPatch.safeParse({ ownerId: 'x', monitoring: true }).success).toBe(false);
    expect(playlistPatch.safeParse({ monitoring: false }).success).toBe(true);
  });

  const fake = (count = 1) => {
    const updateMany = vi.fn(async () => ({ count }));
    return { db: { monitoredPlaylist: { updateMany } } as unknown as Db, updateMany };
  };

  it('stores the id parsed from a Spotify playlist link, scoped to the owner', async () => {
    const { db, updateMany } = fake();
    await updatePlaylist(db, 'usr_1', 'pl_1', { spotifyLink: `https://open.spotify.com/playlist/${ID}?si=zzz` });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'pl_1', ownerId: 'usr_1' }, data: { embedId: ID } });
  });

  it('clears the link with an empty string', async () => {
    const { db, updateMany } = fake();
    await updatePlaylist(db, 'usr_1', 'pl_1', { spotifyLink: '' });
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'pl_1', ownerId: 'usr_1' }, data: { embedId: null } });
  });

  it('rejects album/track links and junk, and another owner’s playlist', async () => {
    const { db } = fake();
    await expect(updatePlaylist(db, 'usr_1', 'pl_1', { spotifyLink: `https://open.spotify.com/album/${ID}` })).rejects.toMatchObject({ code: 'playlist.invalid_link' });
    await expect(updatePlaylist(db, 'usr_1', 'pl_1', { spotifyLink: 'nope' })).rejects.toMatchObject({ code: 'playlist.invalid_link' });
    const none = fake(0);
    await expect(updatePlaylist(none.db, 'usr_other', 'pl_1', { monitoring: true })).rejects.toMatchObject({ code: 'playlist.not_found' });
  });
});
