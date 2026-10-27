import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, STATUS, ValidationError } from './errors';

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

/** Single error to HTTP mapping. Unknown errors are logged server-side and returned opaque. */
export function toResponse(e: unknown) {
  if (e instanceof ZodError) {
    e = ValidationError('request.invalid', 'Request validation failed.', e.flatten().fieldErrors);
  }
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: STATUS[e.kind] });
  }
  console.error('[api] unhandled', e instanceof Error ? e.message : 'unknown');
  return NextResponse.json({ error: { code: 'internal', message: 'Something went wrong.' } }, { status: 500 });
}

export type RouteCtx<P = Record<string, never>> = { params: Promise<P> };

/** Wraps a handler: same-origin check on mutations, uniform error mapping. */
export function route<P = Record<string, never>>(fn: (req: Request, ctx: RouteCtx<P>) => Promise<Response>) {
  return async (req: Request, ctx: RouteCtx<P>) => {
    try {
      assertSameOrigin(req);
      return await fn(req, ctx);
    } catch (e) {
      return toResponse(e);
    }
  };
}

export async function body<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw ValidationError('request.bad_json', 'Body must be valid JSON.');
  }
  return schema.parse(json);
}

/**
 * CSRF defence for cookie-authenticated mutations: browsers attach Origin to cross-site writes.
 * The origin must match the host the client actually addressed (Host, or X-Forwarded-Host behind
 * Vercel's proxy), not req.url, whose host a framework may normalise.
 */
export function assertSameOrigin(req: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return;
  const allowed = [req.headers.get('x-forwarded-host'), req.headers.get('host'), new URL(req.url).host]
    .filter((h): h is string => !!h)
    .map((h) => h.split(',')[0]!.trim());
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new AppError('forbidden', 'csrf.origin', 'Cross-origin request blocked.');
  }
  if (!allowed.includes(host)) throw new AppError('forbidden', 'csrf.origin', 'Cross-origin request blocked.');
}
