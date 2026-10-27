-- CreateEnum
CREATE TYPE "PlaylistSource" AS ENUM ('SPOTIFY_API', 'IMPORT');

-- AlterTable (additive, with a default: safe on existing rows)
ALTER TABLE "MonitoredPlaylist" ADD COLUMN "source" "PlaylistSource" NOT NULL DEFAULT 'SPOTIFY_API';
