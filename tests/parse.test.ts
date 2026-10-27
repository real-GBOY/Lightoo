import { describe, expect, it } from 'vitest';
import { parsePlaylistInput, parseSpotifyLink } from '@/lib/spotify/parse';

const ID = '37i9dQZF1DXcBWIGoYBM5M';

describe('parseSpotifyLink', () => {
  it('parses open.spotify.com URLs with query strings and intl prefixes', () => {
    expect(parseSpotifyLink(`https://open.spotify.com/playlist/${ID}?si=abc123`)).toEqual({ kind: 'playlist', id: ID });
    expect(parseSpotifyLink(`https://open.spotify.com/intl-de/playlist/${ID}`)).toEqual({ kind: 'playlist', id: ID });
    expect(parseSpotifyLink(`https://open.spotify.com/user/someone/playlist/${ID}`)).toEqual({ kind: 'playlist', id: ID });
  });
  it('parses URIs and bare ids', () => {
    expect(parseSpotifyLink(`spotify:playlist:${ID}`)).toEqual({ kind: 'playlist', id: ID });
    expect(parseSpotifyLink(`spotify:user:bob:playlist:${ID}`)).toEqual({ kind: 'playlist', id: ID });
    expect(parseSpotifyLink(ID)).toEqual({ kind: 'playlist', id: ID });
  });
  it('rejects non-Spotify hosts, look-alike hosts and malformed ids', () => {
    expect(parseSpotifyLink(`https://evil.example/playlist/${ID}`)).toBeNull();
    expect(parseSpotifyLink(`https://open.spotify.com.evil.example/playlist/${ID}`)).toBeNull();
    expect(parseSpotifyLink('https://open.spotify.com/playlist/short')).toBeNull();
    expect(parseSpotifyLink('')).toBeNull();
    expect(parseSpotifyLink('hello')).toBeNull();
  });
});

describe('parsePlaylistInput', () => {
  it('flags album/track/artist links as the wrong type rather than invalid', () => {
    expect(parsePlaylistInput(`https://open.spotify.com/album/${ID}`)).toEqual({ ok: false, reason: 'wrong_type', kind: 'album' });
    expect(parsePlaylistInput(`spotify:track:${ID}`)).toEqual({ ok: false, reason: 'wrong_type', kind: 'track' });
  });
  it('returns the id for a playlist and invalid otherwise', () => {
    expect(parsePlaylistInput(`spotify:playlist:${ID}`)).toEqual({ ok: true, id: ID });
    expect(parsePlaylistInput('nope')).toEqual({ ok: false, reason: 'invalid' });
  });
});
