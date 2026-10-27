import { z } from 'zod';
import { db } from '@/lib/db';
import { ValidationError } from '@/lib/errors';
import { ok, route } from '@/lib/http';
import { requireOwner } from '@/lib/session';
import { depsFor } from '@/lib/services/context';
import { parsePlaylistInput } from '@/lib/spotify/parse';

const q = z.object({ url: z.string().min(1).max(300) });

/** Read-only check used by the Add playlist flow: validates the link, then asks Spotify what it can see. Stores nothing. */
export const GET = route(async (req) => {
  const owner = await requireOwner();
  const { url } = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const parsed = parsePlaylistInput(url);
  if (!parsed.ok) {
    throw ValidationError(
      parsed.reason === 'wrong_type' ? 'playlist.wrong_type' : 'playlist.invalid_link',
      parsed.reason === 'wrong_type' ? `That is a Spotify ${parsed.kind} link. LIGHTOO monitors playlists.` : 'That does not look like a Spotify playlist link.',
      { kind: parsed.kind },
    );
  }
  const existing = await db.monitoredPlaylist.findUnique({
    where: { ownerId_spotifyPlaylistId: { ownerId: owner, spotifyPlaylistId: parsed.id } },
    select: { id: true },
  });
  if (existing) return ok({ duplicate: true, playlistId: existing.id });
  const meta = await depsFor(owner).api.playlistMeta(parsed.id);
  return ok({
    duplicate: false,
    name: meta.name,
    ownerName: meta.ownerName,
    imageUrl: meta.imageUrl,
    trackCount: meta.trackCount,
  });
});
