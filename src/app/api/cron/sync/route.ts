import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { systemClock } from '@/lib/clock';
import { getEnv } from '@/lib/env';
import { toResponse } from '@/lib/http';
import { depsFor } from '@/lib/services/context';
import { syncAll } from '@/lib/services/sync';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function authorised(req: Request, secret: string): boolean {
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET". Without a valid secret: 401, no work.
export async function GET(req: Request) {
  try {
    const { CRON_SECRET } = getEnv('CRON_SECRET');
    if (!authorised(req, CRON_SECRET)) return NextResponse.json({ error: { code: 'auth.cron', message: 'Unauthorized.' } }, { status: 401 });

    const owners = await db.spotifyConnection.findMany({ where: { status: 'ACTIVE' }, select: { ownerId: true } });
    const summary = [];
    for (const { ownerId } of owners) {
      const r = await syncAll(depsFor(ownerId), ownerId, { budgetMs: 45_000 });
      summary.push({ synced: r.length, newTracks: r.reduce((n, x) => n + x.newTracks, 0) });
    }
    return NextResponse.json({ at: systemClock.now().toISOString(), owners: summary });
  } catch (e) {
    return toResponse(e);
  }
}
