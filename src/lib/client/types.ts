// Wire types shared by the UI. They mirror the API responses in src/lib/services/library.ts.

export type Artist = { id?: string; name: string };

export type TrackDTO = {
  id: string;
  spotifyId: string;
  title: string;
  artists: Artist[];
  albumName: string | null;
  imageUrl: string | null;
  durationMs: number | null;
};

export type DiscoveryDTO = {
  id: string;
  type: 'NEW_TRACK' | 'SEEDED';
  detectedAt: string;
  playlist: { id: string | null; name: string };
  removedFromPlaylist: boolean;
  track: TrackDTO;
  heard: boolean;
  saved: boolean;
  audioAssetId: string | null;
};

export type FeedPage = { items: DiscoveryDTO[]; nextCursor: string | null };

export type SyncStatus = 'IDLE' | 'OK' | 'FAILED' | 'RATE_LIMITED' | 'UNREADABLE';

export type PlaylistDTO = {
  id: string;
  spotifyPlaylistId: string;
  name: string;
  ownerName: string | null;
  imageUrl: string | null;
  trackCount: number;
  monitoring: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: string | null;
  newCount: number;
};

export type ConnectionDTO =
  | { status: 'NOT_CONNECTED' }
  | { status: 'ACTIVE' | 'EXPIRED' | 'DISCONNECTED'; displayName: string | null; spotifyUserId: string; scopes: string[]; lastError: string | null };

export type MeDTO = { email: string; spotify: ConnectionDTO };

export type SyncResult = {
  results: { playlistId: string; outcome: string; newTracks: number; error?: string; needsReconnect?: boolean }[];
  newTracks: number;
  failed: string[];
  needsReconnect: boolean;
  at: string;
};

export type SettingsDTO = { recordPlayback: boolean; syncOnOpen: boolean };

export type AudioAssetDTO = {
  id: string;
  trackId: string | null;
  title: string | null;
  mimeType: string;
  sizeBytes: number;
  availability: string;
  createdAt: string;
};

export const artistLine = (t: Pick<TrackDTO, 'artists'>) => t.artists.map((a) => a.name).join(', ');
export const spotifyTrackUrl = (spotifyId: string) => `https://open.spotify.com/track/${spotifyId}`;
export const spotifyPlaylistUrl = (id: string) => `https://open.spotify.com/playlist/${id}`;
