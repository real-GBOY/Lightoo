'use client';

import { useApp } from './AppProvider';

/**
 * Spotify's official embedded player (https://developer.spotify.com/documentation/embeds).
 * Audio is played and controlled entirely by Spotify, inside an iframe: LIGHTOO never touches the
 * stream. What you hear (full tracks vs previews, ads) depends on the Spotify account logged in to
 * this browser, and it needs a connection. There is no offline mode.
 */
export function SpotifyEmbed({ kind, id, title }: { kind: 'track' | 'playlist'; id: string; title: string }) {
  const { online } = useApp();
  if (!online) {
    return (
      <div className="banner" role="status" style={{ margin: 0 }}>
        <div><b>Spotify player needs a connection</b><span>Playback through Spotify is online only.</span></div>
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <iframe
        title={`Spotify player: ${title}`}
        src={`https://open.spotify.com/embed/${kind}/${encodeURIComponent(id)}?utm_source=generator&theme=0`}
        width="100%"
        height={kind === 'track' ? 152 : 352}
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        style={{ border: 0, borderRadius: 12, background: 'var(--s2)' }}
      />
      <span className="meta" style={{ lineHeight: 1.4 }}>Plays through Spotify’s own player. Ads or 30-second previews depend on your Spotify account. Online only.</span>
    </div>
  );
}
