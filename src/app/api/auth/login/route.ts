import { timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { getEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/ids';
import { body, ok, route } from '@/lib/http';
import { SESSION_COOKIE, sessionCookieOptions, signSession } from '@/lib/session';

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

const sameEmail = (a: string, b: string) => {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
};

// Single-owner sign-in against OWNER_EMAIL / OWNER_PASSWORD_HASH. There is no registration.
export const POST = route(async (req) => {
  const { email, password } = await body(req, schema);
  const env = getEnv('OWNER_EMAIL', 'OWNER_PASSWORD_HASH', 'SESSION_SECRET');
  // Always run the hash so a wrong email and a wrong password take the same time.
  const passOk = await verifyPassword(password, env.OWNER_PASSWORD_HASH);
  if (!passOk || !sameEmail(email, env.OWNER_EMAIL)) {
    await new Promise((r) => setTimeout(r, 400));
    throw new AppError('unauthenticated', 'auth.invalid', 'Email or password is incorrect.');
  }
  const owner = await db.user.upsert({
    where: { email: env.OWNER_EMAIL.toLowerCase() },
    create: { id: newId('usr'), email: env.OWNER_EMAIL.toLowerCase() },
    update: {},
  });
  (await cookies()).set(SESSION_COOKIE, await signSession(owner.id), sessionCookieOptions());
  return ok({ ok: true });
});
