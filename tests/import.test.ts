import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { listZip } from '@/lib/client/zip';
import { importKey, mergeByName, parseExportDocument, trackIdFrom } from '@/lib/spotify/exportParser';
import { importBody } from '@/lib/services/importer';

const ID = (n: number) => String(n).padStart(22, 'a');
const item = (n: number, extra: Record<string, unknown> = {}) => ({
  track: { trackName: `Song ${n}`, artistName: 'Halden Ivy', albumName: 'Album', trackUri: `spotify:track:${ID(n)}` },
  episode: null,
  localTrack: null,
  addedDate: '2026-10-01',
  ...extra,
});

describe('parseExportDocument', () => {
  it('reads playlists, tracks, artists and added dates', () => {
    const r = parseExportDocument({ playlists: [{ name: 'Late Drives', items: [item(1), item(2)] }] });
    expect(r.problems).toEqual([]);
    expect(r.playlists[0]).toMatchObject({ name: 'Late Drives', skipped: { local: 0, episodes: 0, unreadable: 0 } });
    expect(r.playlists[0]!.tracks[0]).toEqual({ id: ID(1), title: 'Song 1', artists: ['Halden Ivy'], album: 'Album', addedAt: '2026-10-01T00:00:00.000Z' });
  });

  it('skips local files, episodes and unreadable entries, and counts them', () => {
    const r = parseExportDocument({
      playlists: [{ name: 'Mixed', items: [item(1), { track: null, localTrack: { uri: 'spotify:local:x' } }, { track: null, episode: { x: 1 } }, { track: { trackName: 'No uri' } }, item(2)] }],
    });
    expect(r.playlists[0]!.tracks).toHaveLength(2);
    expect(r.playlists[0]!.skipped).toEqual({ local: 1, episodes: 1, unreadable: 1 });
  });

  it('accepts a bare array or a single playlist and reports unrecognised files', () => {
    expect(parseExportDocument([{ name: 'A', items: [item(1)] }]).playlists).toHaveLength(1);
    expect(parseExportDocument({ name: 'Solo', items: [item(1)] }).playlists[0]!.name).toBe('Solo');
    const bad = parseExportDocument({ streams: [] }, 'StreamingHistory.json');
    expect(bad.playlists).toEqual([]);
    expect(bad.problems[0]).toMatch(/no playlists found/);
  });

  it('extracts track ids only from valid Spotify URIs and URLs', () => {
    expect(trackIdFrom(`spotify:track:${ID(5)}`)).toBe(ID(5));
    expect(trackIdFrom(`https://open.spotify.com/track/${ID(5)}?si=x`)).toBe(ID(5));
    expect(trackIdFrom('spotify:episode:abc')).toBeNull();
    expect(trackIdFrom(null)).toBeNull();
  });

  it('merges split files by name without duplicating tracks, and keys playlists stably by name', () => {
    const a = parseExportDocument({ playlists: [{ name: 'Big', items: [item(1), item(2)] }] }).playlists;
    const b = parseExportDocument({ playlists: [{ name: 'Big', items: [item(2), item(3)] }] }).playlists;
    expect(mergeByName([...a, ...b])[0]!.tracks.map((t) => t.id)).toEqual([ID(1), ID(2), ID(3)]);
    expect(importKey('  Late   Drives ')).toBe(importKey('late drives'));
    expect(importKey('Late Drives')).not.toBe(importKey('Late Drive'));
  });
});

describe('importBody validation', () => {
  it('rejects malformed ids, blank names and oversize payloads', () => {
    const ok = { name: 'P', tracks: [{ id: ID(1), title: 't', artists: ['a'], album: null, addedAt: null }] };
    expect(importBody.safeParse(ok).success).toBe(true);
    expect(importBody.safeParse({ ...ok, tracks: [{ ...ok.tracks[0], id: 'short' }] }).success).toBe(false);
    expect(importBody.safeParse({ ...ok, name: '   ' }).success).toBe(false);
    expect(importBody.safeParse({ ...ok, tracks: Array.from({ length: 10_001 }, () => ok.tracks[0]) }).success).toBe(false);
  });
});

/** Builds a real zip (one deflated entry, one stored) so the reader is tested against the actual format. */
function makeZip(files: { name: string; data: Buffer; deflate: boolean }[]): ArrayBuffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const comp = f.deflate ? deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(f.deflate ? 8 : 0, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(f.deflate ? 8 : 0, 10);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(f.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  const all = Buffer.concat([...chunks, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.length) as ArrayBuffer;
}

describe('zip reader', () => {
  it('lists and extracts deflated and stored entries, including folders in names', async () => {
    const json = Buffer.from(JSON.stringify({ playlists: [{ name: 'Zipped', items: [item(1)] }] }));
    const zip = makeZip([
      { name: 'Spotify Account Data/Playlist1.json', data: json, deflate: true },
      { name: 'Spotify Account Data/ReadMe.txt', data: Buffer.from('hello'), deflate: false },
    ]);
    const entries = listZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['Spotify Account Data/Playlist1.json', 'Spotify Account Data/ReadMe.txt']);
    const body = await entries[0]!.read();
    expect(parseExportDocument(JSON.parse(new TextDecoder().decode(body))).playlists[0]!.name).toBe('Zipped');
    expect(new TextDecoder().decode(await entries[1]!.read())).toBe('hello');
  });

  it('rejects non-zip input', () => {
    const junk = new TextEncoder().encode('this is plain text and certainly not a zip archive at all');
    expect(() => listZip(junk.buffer as ArrayBuffer)).toThrow(/zip/i);
  });
});
