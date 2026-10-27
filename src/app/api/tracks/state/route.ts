import { z } from 'zod';
import { systemClock } from '@/lib/clock';
import { db } from '@/lib/db';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { applyStateOps, stateOp } from '@/lib/services/library';

const schema = z.object({ ops: z.array(stateOp).min(1).max(200) });

// One endpoint for live toggles (one op) and offline reconciliation (the queued batch).
export const POST = route(async (req) => {
  const owner = await requireOwner();
  const { ops } = await body(req, schema);
  return ok({ results: await applyStateOps(db, owner, systemClock, ops) });
});
