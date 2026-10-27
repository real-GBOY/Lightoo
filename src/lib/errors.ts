// Same shape as Project 404's AppError: machine-readable namespaced codes,
// mapped to HTTP status in exactly one place (http.ts).
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream'
  | 'config'
  | 'internal';

export class AppError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ValidationError = (code: string, m: string, d?: unknown) => new AppError('validation', code, m, d);
export const Unauthenticated = (m = 'Sign in required.') => new AppError('unauthenticated', 'auth.required', m);
export const Forbidden = (code: string, m: string) => new AppError('forbidden', code, m);
export const NotFound = (code: string, m: string) => new AppError('not_found', code, m);
export const Conflict = (code: string, m: string) => new AppError('conflict', code, m);
export const Upstream = (code: string, m: string) => new AppError('upstream', code, m);
export const RateLimited = (m: string, retryAfterSec?: number) => new AppError('rate_limited', 'spotify.rate_limited', m, { retryAfterSec });
export const ConfigError = (m: string) => new AppError('config', 'config.invalid', m);

export const STATUS: Record<ErrorKind, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream: 502,
  config: 500,
  internal: 500,
};
