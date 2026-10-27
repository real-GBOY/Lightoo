import { kv } from './idb';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
  get unauthenticated() { return this.status === 401; }
}

/** A thrown fetch (no response at all) means the network is down, as opposed to the server refusing. */
export class NetworkError extends Error {}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...rest.headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkError('Network unavailable');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`, e?.details);
  }
  return data as T;
}

/** Network first, falling back to the last good copy. `stale` tells the UI it is showing cached data. */
export async function cachedGet<T>(path: string): Promise<{ data: T; stale: boolean }> {
  const key = `GET ${path}`;
  try {
    const data = await api<T>(path);
    void kv.set(key, data);
    return { data, stale: false };
  } catch (e) {
    if (e instanceof NetworkError) {
      const cached = await kv.get<T>(key);
      if (cached) return { data: cached, stale: true };
    }
    throw e;
  }
}
