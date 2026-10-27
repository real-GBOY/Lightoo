import { db } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';

export const DELETE = route<{ id: string }>(async (_req, ctx) => {
  const owner = await requireOwner();
  const r = await db.audioAsset.deleteMany({ where: { id: (await ctx.params).id, ownerId: owner } });
  if (!r.count) throw NotFound('audio.not_found', 'Audio file not found.');
  return ok({ ok: true });
});
