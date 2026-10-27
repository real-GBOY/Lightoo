// Parses the playlist files from Spotify's "Download your data" export (Playlist1.json, Playlist2.json, ...).
// Pure and dependency-free so it runs in the browser (big files never leave the device unparsed) and in tests.
//
// Documented shape, as far as known (Spotify does not publish a schema, so everything is read defensively):
//   { playlists: [ { name, lastModifiedDate, items: [ { track: { trackName, artistName, albumName, trackUri },
//                                                       episode, localTrack, addedDate } ] } ] }
// Unknown shapes are skipped with a reason rather than guessed at.

export type ImportTrack = { id: string; title: string; artists: string[]; album: string | null; addedAt: string | null };
export type ImportPlaylist = { name: string; tracks: ImportTrack[]; skipped: { local: number; episodes: number; unreadable: number } };
export type ParseResult = { playlists: ImportPlaylist[]; problems: string[] };

const TRACK_URI = /^spotify:track:([A-Za-z0-9]{22})$/;
const TRACK_URL = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})/;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function trackIdFrom(uriOrUrl: string | null): string | null {
  if (!uriOrUrl) return null;
  return TRACK_URI.exec(uriOrUrl)?.[1] ?? TRACK_URL.exec(uriOrUrl)?.[1] ?? null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parsePlaylist(raw: unknown, fallbackName: string): ImportPlaylist | null {
  const p = rec(raw);
  if (!p || !Array.isArray(p.items)) return null;
  const out: ImportPlaylist = { name: str(p.name) ?? fallbackName, tracks: [], skipped: { local: 0, episodes: 0, unreadable: 0 } };
  for (const itemRaw of p.items) {
    const item = rec(itemRaw);
    if (!item) { out.skipped.unreadable++; continue; }
    if (rec(item.localTrack)) { out.skipped.local++; continue; }
    if (rec(item.episode)) { out.skipped.episodes++; continue; }
    const t = rec(item.track);
    const id = trackIdFrom(str(t?.trackUri) ?? str(t?.uri) ?? str(t?.url));
    const title = str(t?.trackName) ?? str(t?.name);
    if (!t || !id || !title) { out.skipped.unreadable++; continue; }
    out.tracks.push({
      id,
      title,
      artists: (str(t.artistName) ?? str(t.artist) ?? 'Unknown artist').split(/\s*;\s*/).filter(Boolean),
      album: str(t.albumName) ?? str(t.album),
      addedAt: isoDate(item.addedDate),
    });
  }
  return out;
}

/** Accepts one parsed JSON document (an export file) and returns every playlist found in it. */
export function parseExportDocument(doc: unknown, fileName = 'playlist'): ParseResult {
  const root = rec(doc);
  const list: unknown[] = Array.isArray(root?.playlists) ? (root!.playlists as unknown[]) : Array.isArray(doc) ? (doc as unknown[]) : root?.items ? [doc] : [];
  const playlists: ImportPlaylist[] = [];
  const problems: string[] = [];
  list.forEach((raw, i) => {
    const pl = parsePlaylist(raw, `${fileName} ${i + 1}`);
    if (pl) playlists.push(pl);
    else problems.push(`${fileName}: entry ${i + 1} is not a playlist.`);
  });
  if (!playlists.length && !problems.length) problems.push(`${fileName}: no playlists found. Pick the Playlist1.json file (or the whole .zip) from your Spotify data export.`);
  return { playlists, problems };
}

/** Same playlist name across several files (large exports split) is merged; tracks de-duplicated by id. */
export function mergeByName(parts: ImportPlaylist[]): ImportPlaylist[] {
  const byName = new Map<string, ImportPlaylist>();
  for (const p of parts) {
    const cur = byName.get(p.name);
    if (!cur) { byName.set(p.name, { ...p, tracks: [...p.tracks] }); continue; }
    const seen = new Set(cur.tracks.map((t) => t.id));
    for (const t of p.tracks) if (!seen.has(t.id)) { cur.tracks.push(t); seen.add(t.id); }
    cur.skipped = { local: cur.skipped.local + p.skipped.local, episodes: cur.skipped.episodes + p.skipped.episodes, unreadable: cur.skipped.unreadable + p.skipped.unreadable };
  }
  return [...byName.values()];
}

/** Stable key for an imported playlist: the export carries no playlist id, so identity is the name. */
export function importKey(name: string): string {
  const slug = name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) + h + slug.charCodeAt(i)) | 0;
  return `import:${(h >>> 0).toString(36)}:${encodeURIComponent(slug).slice(0, 60)}`;
}
