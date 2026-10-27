import { z } from 'zod';
import { db } from '@/lib/db';
import { NotFound } from '@/lib/errors';
import { newId } from '@/lib/ids';
import { body, ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { ownsTrack } from '@/lib/services/library';

// Metadata only. For user-imported files the bytes stay in the device's IndexedDB (storageKey "idb:<id>");
// Postgres never holds audio. Nothing here fetches or stores Spotify audio.
const create = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/).optional(),
  trackId: z.string().min(1).optional(),
  title: z.string().max(200).optional(),
  mimeType: z.string().regex(/^audio\/[\w.+-]+$/),
  sizeBytes: z.number().int().positive().max(500_000_000),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});

const select = { id: true, trackId: true, title: true, mimeType: true, sizeBytes: true, sourceType: true, availability: true, createdAt: true } as const;

export const GET = route(async () => {
  const owner = await requireOwner();
  return ok({ items: await db.audioAsset.findMany({ where: { ownerId: owner }, orderBy: { createdAt: 'desc' }, select }) });
});

export const POST = route(async (req) => {
  const owner = await requireOwner();
  const b = await body(req, create);
  if (b.trackId) {
    if (!(await ownsTrack(db, owner, b.trackId))) throw NotFound('track.not_found', 'Track not found.');
  }
  const id = b.id ?? newId('aud');
  const row = await db.audioAsset.create({
    data: {
      id,
      ownerId: owner,
      trackId: b.trackId,
      title: b.title,
      mimeType: b.mimeType,
      sizeBytes: b.sizeBytes,
      sha256: b.sha256,
      sourceType: 'LOCAL_FILE',
      storageKey: `idb:${id}`,
      availability: 'AVAILABLE',
    },
    select,
  });
  return ok(row, 201);
});
