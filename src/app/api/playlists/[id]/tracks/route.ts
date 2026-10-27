import { db } from '@/lib/db';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { listPlaylistTracks } from '@/lib/services/library';

export const GET = route<{ id: string }>(async (_req, ctx) => {
  const owner = await requireOwner();
  return ok(await listPlaylistTracks(db, owner, (await ctx.params).id));
});
