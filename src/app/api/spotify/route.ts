import { db } from '@/lib/db';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { connectionStatus } from '@/lib/services/connection';

export const GET = route(async () => ok(await connectionStatus(db, await requireOwner())));

/** Disconnect: tokens are deleted; playlists and history stay, syncing stops until reconnect. */
export const DELETE = route(async () => {
  const owner = await requireOwner();
  await db.spotifyConnection.deleteMany({ where: { ownerId: owner } });
  return ok({ ok: true });
});
