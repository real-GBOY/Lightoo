'use client';

import type { ReactNode } from 'react';
import { artistLine, type DiscoveryDTO } from '@/lib/client/types';
import { IcBookmark, IcCheck } from './Icons';
import { Artwork, clock } from './ui';

export function TrackRow({
  item, context, onOpen, onToggleHeard, trailing,
}: {
  item: DiscoveryDTO;
  context?: 'inbox' | 'history' | 'playlist';
  onOpen: (i: DiscoveryDTO) => void;
  onToggleHeard?: (i: DiscoveryDTO) => void;
  trailing?: ReactNode;
}) {
  const t = item.track;
  const meta =
    context === 'history'
      ? `${item.playlist.name} · found ${clock(item.detectedAt)}`
      : context === 'playlist'
        ? new Date(item.detectedAt).toLocaleDateString([], { day: 'numeric', month: 'short' })
        : `${item.playlist.name} · ${clock(item.detectedAt)}`;
  return (
    <div className={`row ${item.heard ? 'heard' : ''}`} style={{ paddingRight: 8 }}>
      <button className="row" style={{ padding: 0, minHeight: 54, flex: 1, minWidth: 0 }} onClick={() => onOpen(item)} aria-label={`${t.title} by ${artistLine(t)}. ${item.heard ? 'Listened' : 'New'}. Open details`}>
        <span className={`dot ${item.heard ? 'off' : ''}`} aria-hidden="true" />
        <Artwork src={t.imageUrl} name={t.title} size={54} />
        <div className="grow">
          <div className="title">{t.title}</div>
          <div className="sub">{artistLine(t)}</div>
          <div className="ctx mono" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {item.saved && <span style={{ color: 'var(--accent)', display: 'inline-flex' }} aria-label="Saved"><IcBookmark size={14} filled /></span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
            {item.removedFromPlaylist && <span className="status" style={{ fontFamily: 'inherit' }}>Removed from playlist</span>}
          </div>
        </div>
      </button>
      {trailing ?? (onToggleHeard && (
        <button className="toggle" aria-pressed={item.heard} aria-label={item.heard ? `Mark ${t.title} as new` : `Mark ${t.title} as listened`} onClick={() => onToggleHeard(item)}>
          <i>{item.heard && <IcCheck size={14} />}</i>
        </button>
      ))}
    </div>
  );
}
