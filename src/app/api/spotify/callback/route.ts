import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { systemClock } from '@/lib/clock';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { toResponse } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { SpotifyApi, exchangeCode } from '@/lib/spotify/client';
import { OAUTH_COOKIE, openOAuthCookie } from '@/lib/spotify/oauth';
import { saveConnection } from '@/lib/services/connection';

// Outcomes are reported to the UI as /?spotify=<result>; no provider error text is echoed back.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (result: string) => NextResponse.redirect(new URL(`/?spotify=${result}`, getEnv('APP_URL').APP_URL));
  const jar = await cookies();
  try {
    const owner = await requireOwner();
    const env = getEnv('SPOTIFY_CLIENT_ID', 'SESSION_SECRET', 'APP_URL');
    const sealed = jar.get(OAUTH_COOKIE)?.value;
    jar.delete({ name: OAUTH_COOKIE, path: '/api/spotify' }); // single use, whatever happens next

    // User pressed "Cancel" on Spotify's consent screen: neutral outcome, nothing stored.
    if (url.searchParams.get('error') === 'access_denied') return back('cancelled');

    const { verifier } = await openOAuthCookie(env.SESSION_SECRET, sealed, url.searchParams.get('state'), owner);
    const code = url.searchParams.get('code');
    if (!code) return back('failed');

    const token = await exchangeCode({ clientId: env.SPOTIFY_CLIENT_ID, code, verifier, redirectUri: env.redirectUri });
    const me = await new SpotifyApi(async () => token.access_token).me();
    await saveConnection(db, owner, systemClock, { spotifyUserId: me.id, displayName: me.display_name, token });
    return back('connected');
  } catch (e) {
    if (e instanceof AppError && e.kind === 'unauthenticated' && e.code === 'auth.required') return toResponse(e);
    console.error('[spotify.callback]', e instanceof AppError ? e.code : 'error');
    return back('failed');
  }
}
