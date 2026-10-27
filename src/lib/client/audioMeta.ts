// Reads title / artist / album from audio files you own, so they can be matched to playlist tracks.
// Supports ID3v2 and ID3v1 (MP3), MP4/M4A atoms (iTunes purchases, AAC), and FLAC Vorbis comments, with a
// filename fallback ("Artist - Title.mp3"). Pure functions over bytes; readTags() only slices the head/tail of a
// file, so thousands of files can be scanned without loading them whole.

export type Tags = { title?: string; artist?: string; album?: string };

const clean = (s: string | undefined) => {
  const v = s?.replace(/\u0000+/g, '').replace(/^﻿/, '').trim();
  return v ? v : undefined;
};

/** "03 - Artist - Title.mp3", "Artist - Title.m4a", "Title.flac". */
export function parseFilename(name: string): Tags {
  const base = name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{2,5}$/, '').replace(/_/g, ' ').trim();
  const noNum = base.replace(/^\(?\d{1,3}\)?[\s.\-–]+(?=\D)/, '');
  const parts = noNum.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { artist: clean(parts[0]), title: clean(parts.slice(1).join(' - ')) };
  return { title: clean(noNum) };
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

function decodeText(enc: number, b: Uint8Array): string {
  if (enc === 1 || enc === 2) {
    let le = enc === 1 ? true : false;
    let start = 0;
    if (enc === 1 && b.length >= 2) {
      if (b[0] === 0xff && b[1] === 0xfe) { le = true; start = 2; }
      else if (b[0] === 0xfe && b[1] === 0xff) { le = false; start = 2; }
    }
    return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(b.subarray(start));
  }
  if (enc === 3) return new TextDecoder('utf-8').decode(b);
  return latin1(b);
}

const syncsafe = (b: Uint8Array, o: number) => ((b[o]! & 0x7f) << 21) | ((b[o + 1]! & 0x7f) << 14) | ((b[o + 2]! & 0x7f) << 7) | (b[o + 3]! & 0x7f);

export function parseID3v2(b: Uint8Array): Tags {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {};
  const major = b[3]!;
  const end = Math.min(b.length, 10 + syncsafe(b, 6));
  const idLen = major === 2 ? 3 : 4;
  const hdr = major === 2 ? 6 : 10;
  const out: Tags = {};
  let p = 10;
  while (p + hdr <= end) {
    const id = latin1(b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding reached
    const size = major === 2 ? (b[p + 3]! << 16) | (b[p + 4]! << 8) | b[p + 5]! : major === 4 ? syncsafe(b, p + 4) : ((b[p + 4]! << 24) | (b[p + 5]! << 16) | (b[p + 6]! << 8) | b[p + 7]!) >>> 0;
    const body = b.subarray(p + hdr, p + hdr + size);
    p += hdr + size;
    if (size <= 1 || body.length < 2) continue;
    const text = clean(decodeText(body[0]!, body.subarray(1)).split('\u0000')[0]);
    if ((id === 'TIT2' || id === 'TT2') && !out.title) out.title = text;
    else if ((id === 'TPE1' || id === 'TP1') && !out.artist) out.artist = text;
    else if ((id === 'TALB' || id === 'TAL') && !out.album) out.album = text;
    if (out.title && out.artist && out.album) break;
  }
  return out;
}

export function parseID3v1(b: Uint8Array): Tags {
  if (b.length < 128) return {};
  const t = b.subarray(b.length - 128);
  if (t[0] !== 0x54 || t[1] !== 0x41 || t[2] !== 0x47) return {};
  return { title: clean(latin1(t.subarray(3, 33))), artist: clean(latin1(t.subarray(33, 63))), album: clean(latin1(t.subarray(63, 93))) };
}

function indexOfBytes(b: Uint8Array, pat: number[], from = 0): number {
  outer: for (let i = from; i <= b.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

function mp4Text(b: Uint8Array, key: number[]): string | undefined {
  const i = indexOfBytes(b, key);
  if (i < 0 || i + 20 > b.length) return undefined;
  const dataType = latin1(b.subarray(i + 8, i + 12));
  if (dataType !== 'data') return undefined;
  const size = ((b[i + 4]! << 24) | (b[i + 5]! << 16) | (b[i + 6]! << 8) | b[i + 7]!) >>> 0;
  if (size < 17 || i + 4 + size > b.length) return undefined;
  return clean(new TextDecoder('utf-8').decode(b.subarray(i + 20, i + 4 + size)));
}

/** iTunes-style atoms: (c)nam, (c)ART, (c)alb, each holding a 'data' child. */
export function parseMp4(b: Uint8Array): Tags {
  return { title: mp4Text(b, [0xa9, 0x6e, 0x61, 0x6d]), artist: mp4Text(b, [0xa9, 0x41, 0x52, 0x54]), album: mp4Text(b, [0xa9, 0x61, 0x6c, 0x62]) };
}

export function parseFlac(b: Uint8Array): Tags {
  if (b.length < 8 || latin1(b.subarray(0, 4)) !== 'fLaC') return {};
  const out: Tags = {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 4;
  while (p + 4 <= b.length) {
    const head = b[p]!;
    const type = head & 0x7f;
    const len = (b[p + 1]! << 16) | (b[p + 2]! << 8) | b[p + 3]!;
    p += 4;
    if (type === 4 && p + len <= b.length) {
      let q = p + 4 + dv.getUint32(p, true); // skip vendor string
      const count = dv.getUint32(q, true);
      q += 4;
      for (let n = 0; n < count && q + 4 <= p + len; n++) {
        const l = dv.getUint32(q, true);
        const entry = new TextDecoder('utf-8').decode(b.subarray(q + 4, q + 4 + l));
        q += 4 + l;
        const eq = entry.indexOf('=');
        const k = entry.slice(0, eq).toUpperCase();
        const v = clean(entry.slice(eq + 1));
        if (k === 'TITLE' && !out.title) out.title = v;
        else if (k === 'ARTIST' && !out.artist) out.artist = v;
        else if (k === 'ALBUM' && !out.album) out.album = v;
      }
      break;
    }
    p += len;
    if (head & 0x80) break;
  }
  return out;
}

/** Tags from the file's own metadata, with the filename filling any gaps. */
export function mergeTags(file: Tags, fromName: Tags): Tags {
  return { title: file.title ?? fromName.title, artist: file.artist ?? fromName.artist, album: file.album };
}

export function parseBytes(head: Uint8Array, tail: Uint8Array, name: string): Tags {
  const sig4 = latin1(head.subarray(0, 4));
  let found: Tags = {};
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) found = parseID3v2(head);
  else if (sig4 === 'fLaC') found = parseFlac(head);
  else if (latin1(head.subarray(4, 8)) === 'ftyp') {
    found = parseMp4(head);
    if (!found.title) found = parseMp4(tail);
  }
  if (!found.title) found = { ...found, ...parseID3v1(tail) };
  return mergeTags(found, parseFilename(name));
}

export async function readTags(file: File): Promise<Tags> {
  try {
    const head = new Uint8Array(await file.slice(0, 2 * 1024 * 1024).arrayBuffer());
    const tail = file.size > head.length ? new Uint8Array(await file.slice(Math.max(0, file.size - 1024 * 1024)).arrayBuffer()) : head;
    return parseBytes(head, tail, file.name);
  } catch {
    return parseFilename(file.name);
  }
}
