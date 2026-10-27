import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { depsFor } from '@/lib/services/context';
import { syncPlaylist } from '@/lib/services/sync';

export const maxDuration = 60;

export const POST = route<{ id: string }>(async (_req, ctx) => {
  const owner = await requireOwner();
  return ok(await syncPlaylist(depsFor(owner), owner, (await ctx.params).id));
});
