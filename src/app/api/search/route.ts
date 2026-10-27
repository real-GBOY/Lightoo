import { db } from '@/lib/db';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { search } from '@/lib/services/library';

export const GET = route(async (req) => {
  const owner = await requireOwner();
  return ok(await search(db, owner, new URL(req.url).searchParams.get('q')?.slice(0, 100) ?? ''));
});
