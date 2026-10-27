import { z } from 'zod';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { dataCounts, deleteAllData } from '@/lib/services/library';

export const GET = route(async () => ok(await dataCounts(db, await requireOwner())));

// Explicit confirmation token so a stray request can never wipe the library.
export const DELETE = route(async (req) => {
  const owner = await requireOwner();
  const { confirm } = await body(req, z.object({ confirm: z.string() }));
  if (confirm !== 'DELETE') throw ValidationError('data.confirm', 'Type DELETE to confirm.');
  await deleteAllData(db, owner);
  return ok({ ok: true });
});
