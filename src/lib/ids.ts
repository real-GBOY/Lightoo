import { randomBytes } from 'node:crypto';

// Prefixed random ids (usr_, pl_, ...), as in Project 404's newId(prefix).
export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}
