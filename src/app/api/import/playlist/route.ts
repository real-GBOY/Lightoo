import { db } from '@/lib/db';
import { systemClock } from '@/lib/clock';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { importBody, importPlaylist } from '@/lib/services/importer';

// One playlist per request keeps each body well under Vercel's 4.5 MB function limit (the browser parses the
// export and sends only the fields needed). Needs no Spotify connection and makes no Spotify calls.
export const POST = route(async (req) => {
  const owner = await requireOwner();
  return ok(await importPlaylist({ db, clock: systemClock }, owner, await body(req, importBody)));
});
