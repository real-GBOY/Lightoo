-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('IDLE', 'OK', 'FAILED', 'RATE_LIMITED', 'UNREADABLE');

-- CreateEnum
CREATE TYPE "DiscoveryType" AS ENUM ('NEW_TRACK', 'SEEDED');

-- CreateEnum
CREATE TYPE "SyncOutcome" AS ENUM ('RUNNING', 'SUCCESS', 'NO_CHANGES', 'FAILED', 'RATE_LIMITED', 'UNREADABLE');

-- CreateEnum
CREATE TYPE "AudioSourceType" AS ENUM ('LOCAL_FILE', 'REMOTE_URL');

-- CreateEnum
CREATE TYPE "AudioAvailability" AS ENUM ('METADATA_ONLY', 'AVAILABLE', 'DOWNLOADING', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotifyConnection" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "spotifyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "scopes" TEXT[],
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoredPlaylist" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "spotifyPlaylistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "imageUrl" TEXT,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "monitoring" BOOLEAN NOT NULL DEFAULT true,
    "baselineDone" BOOLEAN NOT NULL DEFAULT false,
    "seedRecent" BOOLEAN NOT NULL DEFAULT true,
    "snapshotId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'IDLE',
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitoredPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "spotifyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artists" JSONB NOT NULL,
    "artistNames" TEXT NOT NULL,
    "albumName" TEXT,
    "imageUrl" TEXT,
    "durationMs" INTEGER,
    "isrc" TEXT,
    "isPlayable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistTrack" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedAtSource" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "PlaylistTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "playlistId" TEXT,
    "trackId" TEXT NOT NULL,
    "type" "DiscoveryType" NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "playlistName" TEXT NOT NULL,
    "snapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrackState" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "heard" BOOLEAN NOT NULL DEFAULT false,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "heardAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "heardUpdatedAt" TIMESTAMP(3),
    "savedUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrackState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaybackHistory" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "playedMs" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaybackHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "trackId" TEXT,
    "sourceType" "AudioSourceType" NOT NULL,
    "storageKey" TEXT,
    "title" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT,
    "availability" "AudioAvailability" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "outcome" "SyncOutcome" NOT NULL DEFAULT 'RUNNING',
    "newTracks" INTEGER NOT NULL DEFAULT 0,
    "removedTracks" INTEGER NOT NULL DEFAULT 0,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyConnection_ownerId_key" ON "SpotifyConnection"("ownerId");

-- CreateIndex
CREATE INDEX "MonitoredPlaylist_ownerId_monitoring_idx" ON "MonitoredPlaylist"("ownerId", "monitoring");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoredPlaylist_ownerId_spotifyPlaylistId_key" ON "MonitoredPlaylist"("ownerId", "spotifyPlaylistId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_spotifyId_key" ON "Track"("spotifyId");

-- CreateIndex
CREATE INDEX "Track_artistNames_idx" ON "Track"("artistNames");

-- CreateIndex
CREATE INDEX "Track_title_idx" ON "Track"("title");

-- CreateIndex
CREATE INDEX "PlaylistTrack_playlistId_removedAt_idx" ON "PlaylistTrack"("playlistId", "removedAt");

-- CreateIndex
CREATE INDEX "PlaylistTrack_trackId_idx" ON "PlaylistTrack"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistTrack_playlistId_trackId_key" ON "PlaylistTrack"("playlistId", "trackId");

-- CreateIndex
CREATE INDEX "DiscoveryEvent_ownerId_detectedAt_id_idx" ON "DiscoveryEvent"("ownerId", "detectedAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "DiscoveryEvent_playlistId_idx" ON "DiscoveryEvent"("playlistId");

-- CreateIndex
CREATE INDEX "DiscoveryEvent_trackId_idx" ON "DiscoveryEvent"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryEvent_ownerId_dedupeKey_key" ON "DiscoveryEvent"("ownerId", "dedupeKey");

-- CreateIndex
CREATE INDEX "UserTrackState_ownerId_saved_idx" ON "UserTrackState"("ownerId", "saved");

-- CreateIndex
CREATE INDEX "UserTrackState_ownerId_heard_idx" ON "UserTrackState"("ownerId", "heard");

-- CreateIndex
CREATE UNIQUE INDEX "UserTrackState_ownerId_trackId_key" ON "UserTrackState"("ownerId", "trackId");

-- CreateIndex
CREATE INDEX "PlaybackHistory_ownerId_startedAt_idx" ON "PlaybackHistory"("ownerId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "AudioAsset_ownerId_idx" ON "AudioAsset"("ownerId");

-- CreateIndex
CREATE INDEX "AudioAsset_trackId_idx" ON "AudioAsset"("trackId");

-- CreateIndex
CREATE INDEX "SyncRun_playlistId_startedAt_idx" ON "SyncRun"("playlistId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "SpotifyConnection" ADD CONSTRAINT "SpotifyConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitoredPlaylist" ADD CONSTRAINT "MonitoredPlaylist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MonitoredPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistTrack" ADD CONSTRAINT "PlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MonitoredPlaylist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryEvent" ADD CONSTRAINT "DiscoveryEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrackState" ADD CONSTRAINT "UserTrackState_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrackState" ADD CONSTRAINT "UserTrackState_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistory" ADD CONSTRAINT "PlaybackHistory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaybackHistory" ADD CONSTRAINT "PlaybackHistory_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioAsset" ADD CONSTRAINT "AudioAsset_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "MonitoredPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

