import { db } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { embedIdOf, playlistPatch, removePlaylist, updatePlaylist } from '@/lib/services/library';

export const GET = route<{ id: string }>(async (_req, ctx) => {
  const owner = await requireOwner();
  const { id } = await ctx.params;
  const p = await db.monitoredPlaylist.findFirst({
    where: { id, ownerId: owner }, // ownership enforced in the query itself
    include: { syncRuns: { orderBy: { startedAt: 'desc' }, take: 5 } },
  });
  if (!p) throw NotFound('playlist.not_found', 'Playlist not found.');
  return ok({ ...Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'ownerId')), embedId: embedIdOf(p) }); // never echo ownerId
});

export const PATCH = route<{ id: string }>(async (req, ctx) => {
  const owner = await requireOwner();
  const { id } = await ctx.params;
  await updatePlaylist(db, owner, id, await body(req, playlistPatch));
  return ok({ ok: true });
});

export const DELETE = route<{ id: string }>(async (_req, ctx) => {
  const owner = await requireOwner();
  await removePlaylist(db, owner, (await ctx.params).id);
  return ok({ ok: true });
});
