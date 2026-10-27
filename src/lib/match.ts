// Matches audio files you own to the tracks of a playlist by title and artist.
// Conservative on purpose: a wrong match would attach the wrong song to a track, so anything ambiguous is
// reported as unmatched for the owner to resolve instead of being guessed.

export type MatchTrack = { id: string; title: string; artistNames: string };
export type MatchFile = { key: string; title?: string; artist?: string };

export type MatchResult =
  | { key: string; status: 'matched'; trackId: string; confidence: 'high' | 'medium' }
  | { key: string; status: 'unmatched'; reason: 'no_title' | 'no_candidate' | 'artist_mismatch' | 'ambiguous' | 'duplicate' };

// Parenthetical/bracketed noise that does not identify a different recording.
const NOISE = /\b(feat|ft|featuring|with|prod|remaster(ed)?|official|lyrics?|video|audio|explicit|clean|hd|hq)\b/i;

export function norm(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin diacritics only; Arabic base letters are unaffected
    .replace(/[ً-ٰٟ]/g, '') // Arabic harakat
    .replace(/[\(\[][^\)\]]*[\)\]]/g, (m) => (NOISE.test(m) ? ' ' : m))
    .toLowerCase()
    .replace(/\s+(feat|ft|featuring)\.?\s+.*$/, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function artistSet(names: string): string[] {
  return names
    .split(/\s*(?:,|;|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b)\s*/i)
    .map(norm)
    .filter(Boolean);
}

const artistOverlap = (a: string[], b: string[]) => a.some((x) => b.some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))));

export function matchFiles(files: MatchFile[], tracks: MatchTrack[]): MatchResult[] {
  const prepared = tracks.map((t) => ({ id: t.id, title: norm(t.title), artists: artistSet(t.artistNames) }));
  const byTitle = new Map<string, typeof prepared>();
  for (const t of prepared) byTitle.set(t.title, [...(byTitle.get(t.title) ?? []), t]);

  const taken = new Set<string>();
  return files.map((f): MatchResult => {
    const title = f.title ? norm(f.title) : '';
    if (!title) return { key: f.key, status: 'unmatched', reason: 'no_title' };
    const fileArtists = f.artist ? artistSet(f.artist) : [];

    let cands = (byTitle.get(title) ?? []).map((t) => ({ t, exact: true }));
    if (!cands.length && title.length >= 6) {
      cands = prepared.filter((t) => t.title.length >= 6 && (t.title.includes(title) || title.includes(t.title))).map((t) => ({ t, exact: false }));
    }
    if (!cands.length) return { key: f.key, status: 'unmatched', reason: 'no_candidate' };

    // With a known artist, the artist must agree; without one, only an exact, unique title is accepted.
    const scored = cands
      .map(({ t, exact }) => ({ t, exact, artistOk: fileArtists.length ? artistOverlap(fileArtists, t.artists) : null }))
      .filter((c) => c.artistOk !== false);
    if (!scored.length) return { key: f.key, status: 'unmatched', reason: 'artist_mismatch' };

    const best = scored.filter((c) => c.exact && c.artistOk === true);
    const pool = best.length ? best : scored.filter((c) => c.exact || c.artistOk === true);
    const unique = new Set(pool.map((c) => c.t.id));
    if (unique.size !== 1) return { key: f.key, status: 'unmatched', reason: pool.length ? 'ambiguous' : 'no_candidate' };
    const hit = pool[0]!;
    if (!hit.exact && hit.artistOk !== true) return { key: f.key, status: 'unmatched', reason: 'ambiguous' };
    if (taken.has(hit.t.id)) return { key: f.key, status: 'unmatched', reason: 'duplicate' };
    taken.add(hit.t.id);
    return { key: f.key, status: 'matched', trackId: hit.t.id, confidence: hit.exact && hit.artistOk === true ? 'high' : 'medium' };
  });
}
