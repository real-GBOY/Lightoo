import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Conflict, NotFound, ValidationError } from '@/lib/errors';
import { assertSameOrigin, body, toResponse } from '@/lib/http';
import { feedQuery, stateOp } from '@/lib/services/library';

const json = async (r: Response) => ({ status: r.status, body: await r.json() });

describe('error mapping', () => {
  it('maps AppError kinds to status codes with machine-readable codes', async () => {
    expect(await json(toResponse(NotFound('x.nf', 'nope')))).toMatchObject({ status: 404, body: { error: { code: 'x.nf' } } });
    expect((await json(toResponse(Conflict('c', 'm')))).status).toBe(409);
    expect((await json(toResponse(ValidationError('v', 'm')))).status).toBe(400);
  });
  it('hides unexpected error details', async () => {
    const r = await json(toResponse(new Error('connection string postgres://user:pw@host')));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('postgres://');
  });
  it('turns zod failures into 400 with field details', async () => {
    const r = await json(toResponse(z.object({ a: z.string() }).safeParse({}).error));
    expect(r).toMatchObject({ status: 400, body: { error: { code: 'request.invalid' } } });
  });
});

describe('request validation', () => {
  it('rejects malformed JSON bodies', async () => {
    const req = new Request('http://x/api', { method: 'POST', body: '{nope' });
    await expect(body(req, z.object({}))).rejects.toMatchObject({ code: 'request.bad_json' });
  });
  it('validates track-state ops and feed queries', () => {
    expect(stateOp.safeParse({ trackId: 't', heard: true, at: 'not-a-date' }).success).toBe(false);
    expect(stateOp.safeParse({ trackId: 't', heard: true, at: '2026-10-27T10:00:00Z' }).success).toBe(true);
    expect(feedQuery.safeParse({ limit: '9999' }).success).toBe(false);
    expect(feedQuery.parse({}).limit).toBe(50);
  });
});

describe('CSRF origin check', () => {
  const req = (origin?: string, method = 'POST') => new Request('https://lightoo.app/api/x', { method, headers: origin ? { origin } : {} });
  it('blocks cross-origin writes, allows same-origin and reads', () => {
    expect(() => assertSameOrigin(req('https://evil.example'))).toThrow();
    expect(() => assertSameOrigin(req('https://lightoo.app'))).not.toThrow();
    expect(() => assertSameOrigin(req('https://evil.example', 'GET'))).not.toThrow();
  });
  it('trusts the Host the client addressed even if req.url was normalised', () => {
    const r = new Request('http://localhost:3000/api/x', { method: 'POST', headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000' } });
    expect(() => assertSameOrigin(r)).not.toThrow();
    const proxied = new Request('http://internal/api/x', { method: 'POST', headers: { origin: 'https://lightoo.app', 'x-forwarded-host': 'lightoo.app' } });
    expect(() => assertSameOrigin(proxied)).not.toThrow();
    const forged = new Request('http://localhost:3000/api/x', { method: 'POST', headers: { origin: 'https://evil.example', host: 'localhost:3000' } });
    expect(() => assertSameOrigin(forged)).toThrow();
  });
});
