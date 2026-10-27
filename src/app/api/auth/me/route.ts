import { db } from '@/lib/db';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { connectionStatus } from '@/lib/services/connection';

export const GET = route(async () => {
  const ownerId = await requireOwner();
  const [user, spotify] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { email: true } }), connectionStatus(db, ownerId)]);
  return ok({ email: user.email, spotify });
});
