import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { ConfigError, Unauthenticated } from './errors';

export const SESSION_COOKIE = 'lightoo_session';
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw ConfigError('SESSION_SECRET must be at least 32 characters.');
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret());
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] });
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // lax, not strict: the redirect back from Spotify must still carry the session.
  sameSite: 'lax' as const,
  path: '/',
  maxAge: MAX_AGE,
});

/** The only way a route learns who the owner is. Never trust ids from the browser. */
export async function requireOwner(): Promise<string> {
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) throw Unauthenticated();
  return id;
}
