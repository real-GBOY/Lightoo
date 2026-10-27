# LIGHTOO

A personal inbox for new music in your Spotify playlists, as an installable iPhone PWA.
LIGHTOO watches playlists you choose, records every new track it detects, and keeps that history. It also plays audio files **you own** in its own player.

> Single user, single owner. No registration, billing or social features.

## What it is, and what it is not

| | |
|---|---|
| Discovery inbox | Syncs monitored playlists, detects new tracks, keeps history even after tracks leave a playlist |
| Listening | **Opens tracks in Spotify.** LIGHTOO cannot and does not stream, download or extract Spotify audio |
| Player | Plays user-imported audio files (stored in the device's IndexedDB, playable offline): Now Playing, mini-player, queue, shuffle, repeat, lock-screen controls |
| Offline | Browse cached inbox/history, queue listened/saved changes, play imported files |
| Not possible | Background sync on iOS (checks run on launch, manual refresh, and a Vercel cron); push notifications (need a separate service) |

### Spotify access limit (read first)

Per the design handoff, since February 2026 Spotify's Development Mode returns a playlist's **tracks only if you own or collaborate on it** (followed playlists owned by others expose metadata only), requires the app owner to have Premium, and caps the app at 5 users. LIGHTOO reports such playlists as "Can't read tracks". The `/items` endpoint and `item` field used in `src/lib/spotify/client.ts` follow that change; the client accepts both old and new shapes, but **verify against the current Spotify reference** before relying on it.

### Using LIGHTOO without Spotify Premium: data-export import

Spotify blocks Web API access for Development Mode apps whose owner has no active Premium subscription, so live sync needs Premium. As a free alternative, **Import** (`/import`, also under Playlists and Settings) loads playlists from Spotify's own "Download your data" export (Account → Privacy settings → Account data; Spotify emails it, which can take days). Pick the `.zip` or the `Playlist*.json` files.

- Parsed in the browser (`src/lib/spotify/exportParser.ts`, `src/lib/client/zip.ts`); one playlist per request to `/api/import/playlist`, which shares the same diff/transaction as live sync (`applySnapshot`).
- First import of a playlist sets its baseline (optionally seeding the 10 most recent); a later, newer export announces only new tracks and tags removed ones. Importing the same file twice changes nothing.
- The export has **no playlist id**, so an imported playlist is identified by its **name** (rename it in Spotify and the next import creates a new playlist). Imported tracks have no artwork or duration, and "Open in Spotify" works per track but not per playlist.
- This is a manual refresh, not live monitoring. The export's file format is not documented by Spotify; the parser reads it defensively and reports what it could not read. It was tested against a synthetic file in the documented shape, **not a real export**. Please try a real one.

### Listening: three free ways, none of them touch Spotify's audio

1. **Your own files (offline, ad-free).** Open a playlist → *All tracks* → **Add my files**. Pick audio you own (MP3, M4A, FLAC, WAV…). LIGHTOO reads each file's tags (ID3, MP4, FLAC, or the filename) and links it to the matching track by title and artist. Anything unclear is left out, never guessed. **Play all** queues everything on the device; **Missing list (CSV)** exports what you still lack, with Spotify links, to find in whichever store you use. Files live in the browser's IndexedDB, so on iPhone expect a few GB at most, and installing to the Home Screen makes storage less likely to be evicted.
2. **Spotify's official embedded player** (track sheet and playlist page). Free, online only. Ads or previews depend on the Spotify account logged in to the browser. Imported playlists need their Spotify link pasted once.
3. **Open in Spotify.**

LIGHTOO does not download, rip or extract Spotify audio, and will not.

## Architecture

Reference project: `E:\Clients\Project 404` (NestJS 11 + Fastify, PostgreSQL via Kysely with Prisma-defined schema, multi-tenant RLS, JWT, VPS/Docker deploys). It is a multi-tenant, always-on-server foundation, so it was **not** adopted wholesale: LIGHTOO is single-user and must run on Vercel functions. What was reused:

| From 404 | In LIGHTOO |
|---|---|
| `AppError` kinds with namespaced codes (`identity.email_taken`), mapped to HTTP in one place | `src/lib/errors.ts`, `src/lib/http.ts` |
| Prefixed random ids (`usr_…`) | `src/lib/ids.ts` |
| Injected `Clock`, no `Date.now()` in logic | `src/lib/clock.ts` |
| Prisma-defined schema, repositories/services own all table access | `prisma/schema.prisma`, `src/lib/services/*` |
| Strict TS, Vitest, ESLint flat config | same |
| Env validated lazily, never echoed | `src/lib/env.ts` |

Left behind: NestJS/DI, RLS and tenancy (the single owner is enforced by `ownerId` in every query), JWT refresh tokens, outbox worker.

```
Vercel (Next.js 15, App Router)  ── route handlers = backend ──►  Neon Postgres (Vercel Marketplace)
   PWA: service worker + IndexedDB                  ▲                 Prisma + migrations
   Vercel Cron (6-hourly) ─► /api/cron/sync ────────┘
   Spotify Web API (OAuth Authorization Code + PKCE)
```

- **Auth:** owner email + scrypt password hash from env → signed HttpOnly, SameSite=Lax session cookie (30 days). Middleware gates pages; every API route calls `requireOwner()`; same-origin check on all writes.
- **Spotify tokens:** AES-256-GCM encrypted at rest, decrypted only inside the server call that needs them, never logged or returned.
- **Sync:** read Spotify → pure `planSync` diff → **one transaction** writes tracks, memberships, events and snapshot → only then is the run recorded successful. Idempotent: `DiscoveryEvent` is unique on `(ownerId, dedupeKey)`. Removed tracks are tagged, never deleted. Times are "first detected by LIGHTOO", never "added".
- **Playback:** `PlaybackProvider` interface. `local-file` is real. `spotify-handoff` is registered but reports it cannot play.

## Data model

`User`, `SpotifyConnection`, `MonitoredPlaylist`, `Track`, `PlaylistTrack`, `DiscoveryEvent`, `UserTrackState`, `PlaybackHistory`, `AudioAsset`, `SyncRun`. See `prisma/schema.prisma`; initial migration in `prisma/migrations/20261027000000_init`. Audio bytes are never stored in Postgres.

## Local development

```bash
npm install
cp .env.example .env.local        # fill in values
npx tsx scripts/hash-password.ts "your password"   # paste into OWNER_PASSWORD_HASH
npm run db:migrate                # applies migrations to DIRECT_URL
npm run db:seed                   # optional demo data, local DB only
npm run dev
```

Spotify requires `https` or a loopback IP for redirect URIs: use `http://127.0.0.1:3000/api/spotify/callback` locally and open the app at `127.0.0.1:3000`.

Checks: `npm run typecheck && npm run lint && npm test && npm run build`.
DB integration tests: `TEST_DATABASE_URL=postgresql://… npx vitest run tests/sync.integration.test.ts` (skipped when unset; they truncate tables, so use a scratch database).

## Environment variables

See `.env.example`. Required: `APP_URL`, `DATABASE_URL`, `DIRECT_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD_HASH`, `SESSION_SECRET`, `SPOTIFY_CLIENT_ID`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`. Optional: `SPOTIFY_REDIRECT_URI` (defaults to `APP_URL/api/spotify/callback`).

## Deploy (Vercel + Neon)

1. Push to a Git repo and import it in Vercel (framework: Next.js).
2. Vercel → Storage / Marketplace → add **Neon Postgres**. Set `DATABASE_URL` to the **pooled** URL and `DIRECT_URL` to the **direct** URL.
3. Create a Spotify app at developer.spotify.com. Add redirect URI `https://<your-domain>/api/spotify/callback`. Copy the Client ID. Add yourself under User Management (Development Mode).
4. In Vercel → Settings → Environment Variables set everything in `.env.example`. Generate: `SESSION_SECRET` (`openssl rand -base64 48`), `TOKEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CRON_SECRET` (≥16 random chars; Vercel sends it as a Bearer token to cron).
5. Deploy. `vercel.json` runs `prisma migrate deploy` before `next build`, registers a daily cron (the free Hobby plan allows at most one run per day), and allows 60 s functions (check your plan's limit; on Hobby the schedule is already daily).
6. Open the site → sign in → Connect Spotify → add a playlist. On iPhone: Safari → Share → Add to Home Screen.
7. Verify: `GET /api/health` returns `{"status":"ok"}`.

### Checklist
- [ ] `.env*` not committed (`.gitignore` covers it) · [ ] redirect URI matches exactly · [ ] pooled vs direct URLs not swapped · [ ] cron secret set · [ ] first sync run from Settings → Check now.

## Status of this build

Verified in this repo (see the final report in the conversation for results): typecheck, lint, unit tests, DB integration tests against a real Postgres, migration drift check, production build, and a browser run of login, inbox, track state, import and playback.
**Not verified:** a live Spotify OAuth round trip and sync (needs your Spotify app credentials), an actual Vercel deployment, push notifications (not built), iOS Safari behaviour (tested in desktop Chrome only).
