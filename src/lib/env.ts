import { z } from 'zod';
import { ConfigError } from './errors';

const schema = z.object({
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  OWNER_EMAIL: z.string().email(),
  OWNER_PASSWORD_HASH: z.string().min(1),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SPOTIFY_CLIENT_ID: z.string().min(1),
  SPOTIFY_REDIRECT_URI: z.string().url().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16, 'must be at least 16 characters'),
});

type Keys = keyof z.infer<typeof schema>;

/**
 * Validated lazily, per operation, so `next build` works without secrets.
 * Errors name the offending variables and never echo their values.
 */
export function getEnv<K extends Keys>(...keys: K[]): Pick<z.infer<typeof schema>, K> & { redirectUri: string } {
  const mask = Object.fromEntries(keys.map((k) => [k, true])) as Record<K, true>;
  const parsed = schema.pick(mask as never).safeParse(process.env);
  if (!parsed.success) {
    const bad = parsed.error.issues.map((i) => `${i.path.join('.')} (${i.message})`).join(', ');
    throw ConfigError(`Missing or invalid environment configuration: ${bad}`);
  }
  const base = (process.env.APP_URL ?? '').replace(/\/$/, '');
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? `${base}/api/spotify/callback`;
  return { ...(parsed.data as Pick<z.infer<typeof schema>, K>), redirectUri };
}
