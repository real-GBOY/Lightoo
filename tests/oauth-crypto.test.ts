import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, hashPassword, verifyPassword } from '@/lib/crypto';
import { SCOPES, buildAuthorizeUrl, makePkce, makeState, openOAuthCookie, sealOAuthCookie } from '@/lib/spotify/oauth';

const SECRET = 'x'.repeat(40);
const KEY = randomBytes(32).toString('base64');

describe('OAuth state', () => {
  it('accepts a matching state for the same owner', async () => {
    const state = makeState();
    const c = await sealOAuthCookie(SECRET, { state, verifier: 'v', owner: 'usr_1' });
    await expect(openOAuthCookie(SECRET, c, state, 'usr_1')).resolves.toEqual({ verifier: 'v' });
  });
  it('rejects a mismatched, missing or foreign state', async () => {
    const c = await sealOAuthCookie(SECRET, { state: 's1', verifier: 'v', owner: 'usr_1' });
    await expect(openOAuthCookie(SECRET, c, 's2', 'usr_1')).rejects.toMatchObject({ code: 'spotify.state_mismatch' });
    await expect(openOAuthCookie(SECRET, c, null, 'usr_1')).rejects.toMatchObject({ code: 'spotify.state_mismatch' });
    await expect(openOAuthCookie(SECRET, c, 's1', 'usr_other')).rejects.toMatchObject({ code: 'spotify.state_owner' });
    await expect(openOAuthCookie(SECRET, undefined, 's1', 'usr_1')).rejects.toMatchObject({ code: 'spotify.state_missing' });
  });
  it('rejects a cookie signed with another secret or tampered with', async () => {
    const c = await sealOAuthCookie('y'.repeat(40), { state: 's', verifier: 'v', owner: 'usr_1' });
    await expect(openOAuthCookie(SECRET, c, 's', 'usr_1')).rejects.toMatchObject({ code: 'spotify.state_expired' });
    await expect(openOAuthCookie(SECRET, c.slice(0, -2) + 'AA', 's', 'usr_1')).rejects.toBeTruthy();
  });
  it('builds a PKCE S256 authorize URL with least-privilege scopes', () => {
    const { challenge } = makePkce();
    const u = new URL(buildAuthorizeUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:3000/api/spotify/callback', state: 's', challenge }));
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('scope')).toBe(SCOPES.join(' '));
    expect(u.searchParams.get('scope')).not.toMatch(/modify|streaming|user-library/);
  });
});

describe('token encryption', () => {
  it('round-trips and never contains the plaintext', () => {
    const blob = encrypt('refresh-token-123', KEY);
    expect(blob).not.toContain('refresh-token-123');
    expect(decrypt(blob, KEY)).toBe('refresh-token-123');
  });
  it('uses a fresh IV each time and fails on tamper or wrong key', () => {
    expect(encrypt('a', KEY)).not.toBe(encrypt('a', KEY));
    const blob = encrypt('secret', KEY);
    const bad = blob.slice(0, -3) + (blob.endsWith('AAA') ? 'BBB' : 'AAA');
    expect(() => decrypt(bad, KEY)).toThrow();
    expect(() => decrypt(blob, randomBytes(32).toString('base64'))).toThrow();
  });
  it('refuses a key that is not 32 bytes', () => {
    expect(() => encrypt('a', 'short')).toThrow(/32 bytes/);
  });
});

describe('owner password', () => {
  it('verifies the right password only', async () => {
    const h = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});
