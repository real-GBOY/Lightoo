import { describe, expect, it } from 'vitest';
import { parseBytes, parseFilename, parseFlac, parseID3v1, parseID3v2, parseMp4 } from '@/lib/client/audioMeta';
import { artistSet, matchFiles, norm } from '@/lib/match';

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => Array.from(x)));
const be32 = (n: number) => Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => Uint8Array.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const syncsafe = (n: number) => Uint8Array.from([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);

function id3Frame(id: string, text: string, utf16 = false): Uint8Array {
  const body = utf16
    ? cat(Uint8Array.of(1), Uint8Array.of(0xff, 0xfe), ...Array.from(text).map((c) => Uint8Array.of(c.charCodeAt(0) & 255, c.charCodeAt(0) >> 8)))
    : cat(Uint8Array.of(3), enc(text));
  return cat(enc(id), be32(body.length), Uint8Array.of(0, 0), body);
}
const id3Tag = (...frames: Uint8Array[]) => {
  const body = cat(...frames, new Uint8Array(20));
  return cat(enc('ID3'), Uint8Array.of(3, 0, 0), syncsafe(body.length), body);
};

describe('audio tag readers', () => {
  it('reads ID3v2.3 frames in UTF-8 and UTF-16, including Arabic', () => {
    const t = parseID3v2(id3Tag(id3Frame('TIT2', 'نهاية العالم', true), id3Frame('TPE1', 'Marwan Moussa'), id3Frame('TALB', 'Album')));
    expect(t).toEqual({ title: 'نهاية العالم', artist: 'Marwan Moussa', album: 'Album' });
  });
  it('reads ID3v1 from the tail', () => {
    const tag = new Uint8Array(128);
    tag.set(enc('TAG'), 0); tag.set(enc('Old Song'), 3); tag.set(enc('Old Artist'), 33);
    expect(parseID3v1(cat(new Uint8Array(500), tag))).toMatchObject({ title: 'Old Song', artist: 'Old Artist' });
    expect(parseID3v1(new Uint8Array(200))).toEqual({});
  });
  it('reads MP4/M4A atoms', () => {
    const atom = (key: number[], text: string) => cat(be32(24 + text.length), Uint8Array.from(key), be32(16 + text.length), enc('data'), be32(1), be32(0), enc(text));
    const t = parseMp4(cat(new Uint8Array(4), enc('ftyp'), atom([0xa9, 0x6e, 0x61, 0x6d], 'Kolo Fil Saleem'), atom([0xa9, 0x41, 0x52, 0x54], 'Marwan Moussa')));
    expect(t).toMatchObject({ title: 'Kolo Fil Saleem', artist: 'Marwan Moussa' });
  });
  it('reads FLAC Vorbis comments', () => {
    const entry = (s: string) => cat(le32(s.length), enc(s));
    const vc = cat(le32(4), enc('lib0'), le32(2), entry('TITLE=Free'), entry('artist=Marwan Pablo'));
    const flac = cat(enc('fLaC'), Uint8Array.of(0x84, (vc.length >> 16) & 255, (vc.length >> 8) & 255, vc.length & 255), vc);
    expect(parseFlac(flac)).toMatchObject({ title: 'Free', artist: 'Marwan Pablo' });
  });
  it('falls back to the filename, dropping track numbers', () => {
    expect(parseFilename('01 - Marwan Pablo - Free.mp3')).toEqual({ artist: 'Marwan Pablo', title: 'Free' });
    expect(parseFilename('Smooth_Operator.m4a')).toEqual({ title: 'Smooth Operator' });
    expect(parseFilename('C:\\music\\Sade – Smooth Operator.flac')).toEqual({ artist: 'Sade', title: 'Smooth Operator' });
    expect(parseBytes(new Uint8Array(32), new Uint8Array(32), 'Sade - Smooth Operator.mp3')).toMatchObject({ artist: 'Sade', title: 'Smooth Operator' });
  });
});

describe('normalisation', () => {
  it('ignores case, punctuation, diacritics, feat-credits and Arabic marks', () => {
    expect(norm('Smooth Operator (Remastered 2009)')).toBe('smooth operator');
    expect(norm('Café — Del Mar')).toBe('cafe del mar');
    expect(norm('Song Name (feat. Someone)')).toBe('song name');
    expect(norm('Song Name feat. Someone')).toBe('song name');
    expect(norm('نِهَايَةُ العالم')).toBe(norm('نهايةُ العالم'));
    expect(norm('Track (Live)')).toBe('track live'); // a different recording is kept distinct
    expect(artistSet('Molotof, Marwan Moussa & Afroto')).toEqual(['molotof', 'marwan moussa', 'afroto']);
  });
});

describe('matchFiles', () => {
  const tracks = [
    { id: 't1', title: 'Free', artistNames: 'Marwan Pablo, Molotof' },
    { id: 't2', title: 'Smooth Operator', artistNames: 'Sade' },
    { id: 't3', title: 'Love Me Again', artistNames: 'John Newman' },
    { id: 't4', title: 'Intro', artistNames: 'Artist A' },
    { id: 't5', title: 'Intro', artistNames: 'Artist B' },
    { id: 't6', title: 'نهاية العالم', artistNames: 'Marwan Moussa' },
  ];

  it('matches on title and artist, high confidence', () => {
    const r = matchFiles([{ key: 'a', title: 'Smooth Operator (Remastered)', artist: 'Sade' }, { key: 'b', title: 'FREE', artist: 'molotof' }], tracks);
    expect(r).toEqual([
      { key: 'a', status: 'matched', trackId: 't2', confidence: 'high' },
      { key: 'b', status: 'matched', trackId: 't1', confidence: 'high' },
    ]);
  });
  it('matches Arabic titles', () => {
    expect(matchFiles([{ key: 'a', title: 'نهاية العالم', artist: 'Marwan Moussa' }], tracks)[0]).toMatchObject({ status: 'matched', trackId: 't6' });
  });
  it('never guesses: wrong artist, ambiguous title, unknown title and missing title are left unmatched', () => {
    const r = matchFiles(
      [
        { key: 'wrong', title: 'Smooth Operator', artist: 'Someone Else' },
        { key: 'amb', title: 'Intro' },
        { key: 'none', title: 'Not In Playlist', artist: 'Sade' },
        { key: 'blank' },
      ],
      tracks,
    );
    expect(r.map((x) => (x.status === 'unmatched' ? x.reason : 'matched'))).toEqual(['artist_mismatch', 'ambiguous', 'no_candidate', 'no_title']);
  });
  it('uses the artist to resolve same-titled tracks', () => {
    expect(matchFiles([{ key: 'a', title: 'Intro', artist: 'Artist B' }], tracks)[0]).toMatchObject({ status: 'matched', trackId: 't5' });
  });
  it('accepts an exact unique title with no artist, as medium confidence only when not artist-confirmed', () => {
    expect(matchFiles([{ key: 'a', title: 'Love Me Again' }], tracks)[0]).toMatchObject({ status: 'matched', trackId: 't3', confidence: 'medium' });
  });
  it('does not attach two files to one track', () => {
    const r = matchFiles([{ key: 'a', title: 'Free', artist: 'Marwan Pablo' }, { key: 'b', title: 'Free', artist: 'Marwan Pablo' }], tracks);
    expect(r[0]).toMatchObject({ status: 'matched' });
    expect(r[1]).toEqual({ key: 'b', status: 'unmatched', reason: 'duplicate' });
  });
});
