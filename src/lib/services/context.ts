import { db } from '../db';
import { systemClock } from '../clock';
import { getEnv } from '../env';
import { SpotifyApi } from '../spotify/client';
import { getAccessToken } from './connection';

/** Everything a Spotify-touching service needs, wired for one authenticated owner. */
export function depsFor(ownerId: string) {
  const { SPOTIFY_CLIENT_ID } = getEnv('SPOTIFY_CLIENT_ID');
  const api = new SpotifyApi(() => getAccessToken(db, ownerId, systemClock, SPOTIFY_CLIENT_ID));
  return { db, api, clock: systemClock };
}

export const settingsDefaults = { recordPlayback: false, syncOnOpen: true };
export type Settings = typeof settingsDefaults;
