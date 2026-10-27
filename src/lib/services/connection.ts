import type { Db } from '../db';
import type { Clock } from '../clock';
import { decrypt, encrypt } from '../crypto';
import { NotFound } from '../errors';
import { newId } from '../ids';
import { SpotifyAccessError, refreshAccessToken, type FetchLike, type TokenResponse } from '../spotify/client';

const SKEW_MS = 60_000;

/**
 * Returns a valid access token, refreshing and persisting it when it is about to expire.
 * Tokens exist in plaintext only inside this call; at rest they are AES-256-GCM encrypted.
 * A failed refresh marks the connection EXPIRED so the UI asks for Reconnect, not Retry.
 */
export async function getAccessToken(
  db: Db,
  ownerId: string,
  clock: Clock,
  clientId: string,
  f?: FetchLike,
): Promise<string> {
  const c = await db.spotifyConnection.findUnique({ where: { ownerId } });
  if (!c || c.status === 'DISCONNECTED') throw NotFound('spotify.not_connected', 'Spotify is not connected.');
  if (c.status === 'EXPIRED') throw new SpotifyAccessError('revoked', 'Spotify sign-in expired.');

  if (c.accessTokenExpiresAt.getTime() - SKEW_MS > clock.now().getTime()) return decrypt(c.accessTokenEnc);

  try {
    const t = await refreshAccessToken({ clientId, refreshToken: decrypt(c.refreshTokenEnc) }, f);
    await db.spotifyConnection.update({
      where: { ownerId },
      data: {
        accessTokenEnc: encrypt(t.access_token),
        // Spotify may rotate the refresh token; keep the old one when it doesn't.
        refreshTokenEnc: t.refresh_token ? encrypt(t.refresh_token) : c.refreshTokenEnc,
        accessTokenExpiresAt: new Date(clock.now().getTime() + t.expires_in * 1000),
        lastError: null,
      },
    });
    return t.access_token;
  } catch (e) {
    if (e instanceof SpotifyAccessError) {
      await db.spotifyConnection.update({ where: { ownerId }, data: { status: 'EXPIRED', lastError: 'Sign-in expired or revoked.' } });
    }
    throw e;
  }
}

export async function saveConnection(
  db: Db,
  ownerId: string,
  clock: Clock,
  p: { spotifyUserId: string; displayName: string | null; token: TokenResponse },
) {
  if (!p.token.refresh_token) throw new SpotifyAccessError('revoked', 'Spotify did not return a refresh token.');
  const data = {
    spotifyUserId: p.spotifyUserId,
    displayName: p.displayName,
    scopes: (p.token.scope ?? '').split(' ').filter(Boolean),
    status: 'ACTIVE' as const,
    accessTokenEnc: encrypt(p.token.access_token),
    refreshTokenEnc: encrypt(p.token.refresh_token),
    accessTokenExpiresAt: new Date(clock.now().getTime() + p.token.expires_in * 1000),
    lastError: null,
  };
  await db.spotifyConnection.upsert({ where: { ownerId }, create: { id: newId('spc'), ownerId, ...data }, update: data });
}

/** Status for the client. Never includes tokens. */
export async function connectionStatus(db: Db, ownerId: string) {
  const c = await db.spotifyConnection.findUnique({ where: { ownerId } });
  if (!c) return { status: 'NOT_CONNECTED' as const };
  return { status: c.status, displayName: c.displayName, spotifyUserId: c.spotifyUserId, scopes: c.scopes, lastError: c.lastError };
}
