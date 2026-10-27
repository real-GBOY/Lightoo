import { z } from 'zod';
import { db } from '@/lib/db';
import { newId } from '@/lib/ids';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { settingsDefaults } from '@/lib/services/context';

const schema = z.object({
  trackId: z.string().min(1),
  startedAt: z.string().datetime(),
  playedMs: z.number().int().min(0).max(86_400_000),
  completed: z.boolean(),
});

// Records only audio played inside LIGHTOO, and only when the owner has switched history on.
export const POST = route(async (req) => {
  const owner = await requireOwner();
  const b = await body(req, schema);
  const u = await db.user.findUniqueOrThrow({ where: { id: owner }, select: { settings: true } });
  if (!({ ...settingsDefaults, ...(u.settings as object) }).recordPlayback) return ok({ recorded: false });
  const owned = await db.discoveryEvent.findFirst({ where: { ownerId: owner, trackId: b.trackId }, select: { id: true } });
  if (!owned) return ok({ recorded: false });
  await db.playbackHistory.create({
    data: { id: newId('pbh'), ownerId: owner, trackId: b.trackId, startedAt: new Date(b.startedAt), playedMs: b.playedMs, completed: b.completed },
  });
  return ok({ recorded: true }, 201);
});
