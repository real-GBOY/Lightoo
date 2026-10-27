import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { OAUTH_COOKIE, OAUTH_TTL_SEC, buildAuthorizeUrl, makePkce, makeState, sealOAuthCookie } from '@/lib/spotify/oauth';

// Navigation endpoint (GET): starts Authorization Code + PKCE. State and verifier ride in a
// signed, HttpOnly, short-lived cookie bound to this owner; nothing secret reaches the browser JS.
export const GET = route(async () => {
  const owner = await requireOwner();
  const env = getEnv('SPOTIFY_CLIENT_ID', 'SESSION_SECRET', 'APP_URL');
  const { verifier, challenge } = makePkce();
  const state = makeState();
  (await cookies()).set(OAUTH_COOKIE, await sealOAuthCookie(env.SESSION_SECRET, { state, verifier, owner }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/spotify',
    maxAge: OAUTH_TTL_SEC,
  });
  return NextResponse.redirect(buildAuthorizeUrl({ clientId: env.SPOTIFY_CLIENT_ID, redirectUri: env.redirectUri, state, challenge }));
});
