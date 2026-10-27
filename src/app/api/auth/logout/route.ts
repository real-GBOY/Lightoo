import { cookies } from 'next/headers';
import { ok, route } from '@/lib/http';
import { SESSION_COOKIE } from '@/lib/session';

export const POST = route(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return ok({ ok: true });
});
