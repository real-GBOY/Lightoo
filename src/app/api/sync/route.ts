import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { depsFor } from '@/lib/services/context';
import { syncAll } from '@/lib/services/sync';

export const maxDuration = 60;

// Manual refresh and sync-on-open both land here.
export const POST = route(async () => {
  const owner = await requireOwner();
  const results = await syncAll(depsFor(owner), owner);
  return ok({
    results,
    newTracks: results.reduce((n, r) => n + r.newTracks, 0),
    failed: results.filter((r) => r.outcome === 'FAILED' || r.outcome === 'UNREADABLE' || r.outcome === 'RATE_LIMITED').map((r) => r.playlistId),
    needsReconnect: results.some((r) => r.needsReconnect),
    at: new Date().toISOString(),
  });
});
