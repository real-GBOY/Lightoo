import { AppError, RateLimited, Upstream } from '../errors';
import { TOKEN_URL } from './oauth';

const API = 'https://api.spotify.com/v1';

export type SpotifyTrack = {
  spotifyId: string;
  title: string;
  artists: { id?: string; name: string }[];
  albumName: string | null;
  imageUrl: string | null;
  durationMs: number | null;
  isrc: string | null;
  isPlayable: boolean;
  addedAt: Date | null;
  position: number;
};

export type SpotifyPlaylistMeta = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerId: string | null;
  imageUrl: string | null;
  snapshotId: string | null;
  trackCount: number;
};

export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Distinguishes failures the sync layer reports differently. */
export class SpotifyAccessError extends AppError {
  constructor(readonly reason: 'unreadable' | 'revoked', message: string) {
    super(reason === 'revoked' ? 'unauthenticated' : 'forbidden', `spotify.${reason}`, message);
  }
}

export class SpotifyApi {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly f: FetchLike = fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const res = await this.f(`${API}${path}`, { headers: { Authorization: `Bearer ${await this.token()}` }, cache: 'no-store' });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429) throw RateLimited('Spotify is rate limiting requests.', Number(res.headers.get('retry-after')) || undefined);
    if (res.status === 401) throw new SpotifyAccessError('revoked', 'Spotify rejected the saved sign-in.');
    // 403/404 on a playlist: private, Spotify-owned/algorithmic, or (Dev Mode) not owned/collaborated.
    if (res.status === 403 || res.status === 404) throw new SpotifyAccessError('unreadable', 'Spotify will not return this playlist.');
    throw Upstream('spotify.upstream', `Spotify responded ${res.status}.`);
  }

  me() {
    return this.get<{ id: string; display_name: string | null }>('/me');
  }

  async playlistMeta(id: string): Promise<SpotifyPlaylistMeta> {
    const p = await this.get<RawPlaylist>(`/playlists/${id}?fields=id,name,owner(id,display_name),images,snapshot_id,tracks.total,items.total`);
    return {
      id: p.id,
      name: p.name,
      ownerName: p.owner?.display_name ?? p.owner?.id ?? null,
      ownerId: p.owner?.id ?? null,
      imageUrl: p.images?.[0]?.url ?? null,
      snapshotId: p.snapshot_id ?? null,
      trackCount: p.items?.total ?? p.tracks?.total ?? 0,
    };
  }

  /**
   * All tracks, following pagination. NOTE: Spotify renamed the playlist tracks
   * endpoint to /items in 2026 and wrapper field `track` to `item`; both shapes are
   * accepted so a mixed rollout cannot corrupt a sync. Verify against current docs.
   */
  async playlistTracks(id: string): Promise<SpotifyTrack[]> {
    const out: SpotifyTrack[] = [];
    let offset = 0;
    for (;;) {
      const page = await this.get<{ items: RawItem[]; next: string | null }>(`/playlists/${id}/items?limit=100&offset=${offset}&additional_types=track`);
      page.items.forEach((it, i) => {
        const t = it.item ?? it.track;
        // Skip removed/null entries, podcast episodes and local files: no stable Spotify id.
        if (!t || !t.id || t.type === 'episode' || t.is_local) return;
        out.push({
          spotifyId: t.id,
          title: t.name,
          artists: (t.artists ?? []).map((a) => ({ id: a.id ?? undefined, name: a.name })),
          albumName: t.album?.name ?? null,
          imageUrl: t.album?.images?.[0]?.url ?? null,
          durationMs: t.duration_ms ?? null,
          isrc: t.external_ids?.isrc ?? null,
          isPlayable: t.is_playable !== false,
          addedAt: it.added_at ? new Date(it.added_at) : null,
          position: offset + i,
        });
      });
      if (!page.next || page.items.length === 0) break;
      offset += page.items.length;
    }
    return out;
  }
}

type RawPlaylist = {
  id: string;
  name: string;
  owner?: { id: string; display_name?: string | null };
  images?: { url: string }[];
  snapshot_id?: string;
  tracks?: { total: number };
  items?: { total: number };
};
type RawTrack = {
  id: string | null;
  type?: string;
  is_local?: boolean;
  name: string;
  artists?: { id?: string | null; name: string }[];
  album?: { name?: string; images?: { url: string }[] };
  duration_ms?: number;
  external_ids?: { isrc?: string };
  is_playable?: boolean;
};
type RawItem = { added_at?: string; track?: RawTrack | null; item?: RawTrack | null };

async function tokenRequest(body: URLSearchParams, f: FetchLike): Promise<TokenResponse> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (res.status === 400 || res.status === 401) {
    // invalid_grant on refresh = revoked or expired grant; body is deliberately not surfaced.
    throw new SpotifyAccessError('revoked', 'Spotify sign-in is no longer valid.');
  }
  if (!res.ok) throw Upstream('spotify.token_failed', `Spotify token endpoint responded ${res.status}.`);
  return (await res.json()) as TokenResponse;
}

export function exchangeCode(p: { clientId: string; code: string; verifier: string; redirectUri: string }, f: FetchLike = fetch) {
  return tokenRequest(
    new URLSearchParams({ grant_type: 'authorization_code', code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier }),
    f,
  );
}

export function refreshAccessToken(p: { clientId: string; refreshToken: string }, f: FetchLike = fetch) {
  return tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: p.refreshToken, client_id: p.clientId }), f);
}
