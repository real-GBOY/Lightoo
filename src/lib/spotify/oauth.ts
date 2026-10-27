import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '../errors';

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Least privilege: read the user's own and collaborative playlists. Nothing else.
export const SCOPES = ['playlist-read-private', 'playlist-read-collaborative'] as const;

export const OAUTH_COOKIE = 'lightoo_oauth';
export const OAUTH_TTL_SEC = 600;

export type PkcePair = { verifier: string; challenge: string };

export function makePkce(): PkcePair {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function makeState(): string {
  return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.search = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: SCOPES.join(' '),
    state: p.state,
    code_challenge_method: 'S256',
    code_challenge: p.challenge,
    show_dialog: 'false',
  }).toString();
  return u.toString();
}

type Secret = Uint8Array;
const key = (s: string): Secret => new TextEncoder().encode(s);

/** State + verifier travel in a short-lived signed HttpOnly cookie, bound to the owner's session. */
export async function sealOAuthCookie(secret: string, data: { state: string; verifier: string; owner: string }): Promise<string> {
  return new SignJWT(data).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${OAUTH_TTL_SEC}s`).sign(key(secret));
}

/**
 * Validates the callback: cookie present and unexpired, state matches, and the
 * authenticated owner is the one who started the flow. Any mismatch is a CSRF signal.
 */
export async function openOAuthCookie(
  secret: string,
  cookie: string | undefined,
  returnedState: string | null,
  owner: string,
): Promise<{ verifier: string }> {
  const fail = (code: string, msg: string) => new AppError('validation', code, msg);
  if (!cookie) throw fail('spotify.state_missing', 'The sign-in attempt expired. Start again.');
  let payload: { state?: unknown; verifier?: unknown; owner?: unknown };
  try {
    payload = (await jwtVerify(cookie, key(secret), { algorithms: ['HS256'] })).payload as typeof payload;
  } catch {
    throw fail('spotify.state_expired', 'The sign-in attempt expired. Start again.');
  }
  if (typeof payload.state !== 'string' || typeof payload.verifier !== 'string' || !returnedState || payload.state !== returnedState) {
    throw fail('spotify.state_mismatch', 'Sign-in could not be verified. Start again.');
  }
  if (payload.owner !== owner) throw fail('spotify.state_owner', 'Sign-in could not be verified. Start again.');
  return { verifier: payload.verifier };
}
