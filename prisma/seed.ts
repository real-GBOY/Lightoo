// Development seed: a clearly fake owner, playlist and tracks so the UI can be exercised without Spotify.
// Refuses to run against anything but a local database unless ALLOW_SEED=1.
//   npm run db:seed        (reads DATABASE_URL; SEED_PASSWORD_HINT is printed, never stored)
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { encrypt } from '../src/lib/crypto';
import { newId } from '../src/lib/ids';

const url = process.env.DATABASE_URL ?? '';
if (!/(localhost|127\.0\.0\.1)/.test(url) && process.env.ALLOW_SEED !== '1') {
  console.error('Refusing to seed a non-local database. Set ALLOW_SEED=1 if you really mean it.');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed in production.');
  process.exit(1);
}

const db = new PrismaClient();
const email = (process.env.OWNER_EMAIL ?? 'owner@example.com').toLowerCase();
const key = process.env.TOKEN_ENCRYPTION_KEY ?? randomBytes(32).toString('base64');

const artists = ['Halden Ivy', 'Paper Moons', 'Soft Static', 'Marlow Reed', 'The Quiet Hours', 'Nova Lane'];
const titles = ['Late Drives', 'Glass Rooms', 'Static Bloom', 'Harbour Lights', 'Slow Orbit', 'Paper Planes', 'Night Shift', 'Low Tide'];

async function main() {
  const user = await db.user.upsert({
    where: { email },
    create: { id: newId('usr'), email, settings: { syncOnOpen: false, recordPlayback: false } },
    update: { settings: { syncOnOpen: false, recordPlayback: false } },
  });
  // Fake, non-working tokens: enough to show the "connected" UI. Any real sync will mark them expired.
  await db.spotifyConnection.upsert({
    where: { ownerId: user.id },
    create: {
      id: newId('spc'), ownerId: user.id, spotifyUserId: 'demo-user', displayName: 'Demo listener', scopes: ['playlist-read-private'],
      accessTokenEnc: encrypt('demo', key), refreshTokenEnc: encrypt('demo', key), accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    },
    update: {},
  });

  const pls = [];
  for (const [i, name] of ['Demo · Late Drives', 'Demo · Fresh Finds'].entries()) {
    pls.push(
      await db.monitoredPlaylist.upsert({
        where: { ownerId_spotifyPlaylistId: { ownerId: user.id, spotifyPlaylistId: `DEMO${i}`.padEnd(22, '0') } },
        create: { id: newId('pl'), ownerId: user.id, spotifyPlaylistId: `DEMO${i}`.padEnd(22, '0'), name, ownerName: 'demo', baselineDone: true, syncStatus: i === 1 ? 'FAILED' : 'OK', syncError: i === 1 ? 'Demo failure state' : null, lastSyncedAt: new Date(Date.now() - 600_000) },
        update: {},
      }),
    );
  }

  const now = Date.now();
  for (let n = 0; n < 24; n++) {
    const sid = `demo${String(n).padStart(18, '0')}`;
    const track = await db.track.upsert({
      where: { spotifyId: sid },
      create: { id: newId('trk'), spotifyId: sid, title: `${titles[n % titles.length]} ${n >= titles.length ? n : ''}`.trim(), artists: [{ name: artists[n % artists.length]! }], artistNames: artists[n % artists.length]!, albumName: 'Demo Album', durationMs: 180_000 + n * 3000 },
      update: {},
    });
    const pl = pls[n % 2]!;
    await db.discoveryEvent.upsert({
      where: { ownerId_dedupeKey: { ownerId: user.id, dedupeKey: `${pl.id}:${sid}` } },
      create: { id: newId('dsc'), ownerId: user.id, playlistId: pl.id, trackId: track.id, type: 'NEW_TRACK', detectedAt: new Date(now - n * 5 * 3_600_000), dedupeKey: `${pl.id}:${sid}`, playlistName: pl.name },
      update: {},
    });
    await db.playlistTrack.upsert({
      where: { playlistId_trackId: { playlistId: pl.id, trackId: track.id } },
      create: { id: newId('plt'), playlistId: pl.id, trackId: track.id, position: n, firstSeenAt: new Date(now), lastSeenAt: new Date(now), removedAt: n === 5 ? new Date() : null },
      update: {},
    });
  }
  console.log(`Seeded demo data for ${email}.`);
}

main().finally(() => db.$disconnect());
