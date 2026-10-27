export type SpotifyLinkKind = 'playlist' | 'album' | 'track' | 'artist' | 'show' | 'episode' | 'user';

export type ParsedSpotifyLink = { kind: SpotifyLinkKind; id: string };

const ID = /^[A-Za-z0-9]{22}$/;
const KINDS = new Set<SpotifyLinkKind>(['playlist', 'album', 'track', 'artist', 'show', 'episode', 'user']);

/**
 * Accepts open.spotify.com URLs (with or without intl-xx/ prefix and query string),
 * spotify:<kind>:<id> URIs, and bare 22-character playlist ids. Returns null when
 * the input is not recognisable as Spotify at all, so the UI can say "invalid link"
 * versus "that's an album link".
 */
export function parseSpotifyLink(input: string): ParsedSpotifyLink | null {
  const s = input.trim();
  if (!s) return null;

  const uri = /^spotify:(?:user:[^:]+:)?([a-z]+):([A-Za-z0-9]+)$/.exec(s);
  if (uri) return build(uri[1], uri[2]);

  if (/^https?:\/\//i.test(s)) {
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.hostname !== 'open.spotify.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('intl-')) parts.shift();
    // Legacy: /user/<name>/playlist/<id>
    if (parts[0] === 'user' && parts[2] === 'playlist') return build('playlist', parts[3]);
    return build(parts[0], parts[1]);
  }

  if (ID.test(s)) return { kind: 'playlist', id: s };
  return null;
}

function build(kind?: string, id?: string): ParsedSpotifyLink | null {
  if (!kind || !id || !KINDS.has(kind as SpotifyLinkKind) || !ID.test(id)) return null;
  return { kind: kind as SpotifyLinkKind, id };
}

/** Convenience for the add-playlist flow: the id, or a typed reason it can't be used. */
export function parsePlaylistInput(input: string): { ok: true; id: string } | { ok: false; reason: 'invalid' | 'wrong_type'; kind?: SpotifyLinkKind } {
  const p = parseSpotifyLink(input);
  if (!p) return { ok: false, reason: 'invalid' };
  if (p.kind !== 'playlist') return { ok: false, reason: 'wrong_type', kind: p.kind };
  return { ok: true, id: p.id };
}
