import { z } from 'zod';
import { db } from '@/lib/db';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { settingsDefaults } from '@/lib/services/context';

const patch = z.object({ recordPlayback: z.boolean().optional(), syncOnOpen: z.boolean().optional() }).strict();

async function read(owner: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: owner }, select: { settings: true } });
  return { ...settingsDefaults, ...(u.settings as object) };
}

export const GET = route(async () => ok(await read(await requireOwner())));

export const PUT = route(async (req) => {
  const owner = await requireOwner();
  const next = { ...(await read(owner)), ...(await body(req, patch)) };
  await db.user.update({ where: { id: owner }, data: { settings: next } });
  return ok(next);
});
