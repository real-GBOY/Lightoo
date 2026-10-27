import { z } from 'zod';
import { systemClock } from '@/lib/clock';
import { db } from '@/lib/db';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { depsFor } from '@/lib/services/context';
import { addPlaylist, listPlaylists } from '@/lib/services/library';

export const GET = route(async () => ok({ items: await listPlaylists(db, await requireOwner(), systemClock) }));

const add = z.object({ url: z.string().min(1).max(300), seedRecent: z.boolean().default(true) });

export const POST = route(async (req) => {
  const owner = await requireOwner();
  const { url, seedRecent } = await body(req, add);
  return ok(await addPlaylist(depsFor(owner), owner, url, seedRecent), 201);
});
