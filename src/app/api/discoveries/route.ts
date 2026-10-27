import { systemClock } from '@/lib/clock';
import { db } from '@/lib/db';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { feedQuery, listDiscoveries } from '@/lib/services/library';

// scope=new → last 7 days (New Music). scope=history → everything ever recorded.
export const GET = route(async (req) => {
  const owner = await requireOwner();
  const q = feedQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  return ok(await listDiscoveries(db, owner, systemClock, q));
});
