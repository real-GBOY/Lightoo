'use client';

import { useEffect, useRef } from 'react';
import { IcBack, IcClose, IcNext, IcPause, IcPlay, IcPrev, IcQueue, IcRepeat, IcShuffle } from './Icons';
import { usePlayer } from './PlayerProvider';
import { Artwork, Sheet, fmtTime } from './ui';

export function MiniPlayer() {
  const p = usePlayer();
  if (!p.current) return null;
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;
  return (
    <div className="mini" role="region" aria-label="Mini player">
      <button className="row" style={{ minHeight: 0, padding: 0, flex: 1, gap: 12 }} onClick={() => p.setNowPlayingOpen(true)} aria-label={`Open Now Playing: ${p.current.title}`}>
        <Artwork src={p.current.imageUrl} name={p.current.title} size={48} />
        <div className="grow">
          <div className="title" style={{ fontSize: 15 }}>{p.current.title}</div>
          <div className="sub" style={{ fontSize: 13, color: p.error ? 'var(--warn)' : undefined }}>{p.error ?? p.current.artist}</div>
        </div>
      </button>
      <button className="icon-btn" onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'}>{p.playing ? <IcPause /> : <IcPlay />}</button>
      <button className="icon-btn" onClick={p.next} aria-label="Next track"><IcNext /></button>
      <div className="bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function NowPlaying() {
  const p = usePlayer();
  const ref = useRef<HTMLDivElement>(null);
  const open = p.nowPlayingOpen && !!p.current;
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.setNowPlayingOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [open, p]);
  if (!open || !p.current) return null;
  const t = p.current;
  const pct = p.duration ? (p.position / p.duration) * 100 : 0;
  return (
    <div className="np" role="dialog" aria-modal="true" aria-label="Now playing" ref={ref} tabIndex={-1}>
      <div className="inner">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="back" onClick={() => p.setNowPlayingOpen(false)}><IcBack /> Back</button>
          <span className="section-label">Imported file</span>
          <button className="icon-btn" onClick={() => p.setQueueOpen(true)} aria-label="Queue"><IcQueue /></button>
        </div>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <Artwork src={t.imageUrl} name={t.title} size={Math.min(340, typeof window === 'undefined' ? 300 : window.innerWidth - 48)} radius={14} />
        </div>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{t.title}</div>
          <div style={{ color: 'var(--text-2)', marginTop: 4, fontSize: 17 }}>{t.artist}</div>
        </div>
        {p.error && <div role="alert" className="banner warn" style={{ margin: 0 }}><span>{p.error}</span></div>}
        <div>
          <input
            className="seek" type="range" min={0} max={Math.max(1, Math.floor(p.duration))} step={1}
            value={Math.min(Math.floor(p.position), Math.floor(p.duration) || 0)}
            style={{ ['--p' as string]: `${pct}%` }}
            onChange={(e) => p.seek(Number(e.target.value))}
            aria-label="Seek" aria-valuetext={`${fmtTime(p.position)} of ${fmtTime(p.duration)}`}
            disabled={!p.duration}
          />
          <div className="mono meta" style={{ display: 'flex', justifyContent: 'space-between', marginTop: -6 }}>
            <span>{fmtTime(p.position)}</span><span>{p.duration ? fmtTime(p.duration) : p.loading ? '…' : '–:––'}</span>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button className="icon-btn" onClick={p.toggleShuffle} aria-pressed={p.shuffle} aria-label="Shuffle" style={{ color: p.shuffle ? 'var(--accent)' : 'var(--text-3)' }}><IcShuffle /></button>
          <button className="icon-btn" onClick={p.prev} aria-label="Previous"><IcPrev size={30} /></button>
          <button
            onClick={p.toggle} aria-label={p.playing ? 'Pause' : 'Play'}
            style={{ width: 72, height: 72, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}
          >
            {p.playing ? <IcPause size={32} /> : <IcPlay size={32} />}
          </button>
          <button className="icon-btn" onClick={p.next} aria-label="Next"><IcNext size={30} /></button>
          <button
            className="icon-btn" onClick={p.cycleRepeat} aria-label={`Repeat: ${p.repeat}`}
            style={{ color: p.repeat === 'off' ? 'var(--text-3)' : 'var(--accent)', position: 'relative' }}
          >
            <IcRepeat />{p.repeat === 'one' && <span className="mono" style={{ position: 'absolute', fontSize: 9, fontWeight: 700 }}>1</span>}
          </button>
        </div>
      </div>
      <QueueSheet />
    </div>
  );
}

export function QueueSheet() {
  const p = usePlayer();
  return (
    <Sheet open={p.queueOpen} onClose={() => p.setQueueOpen(false)} label="Playback queue">
      <h2 style={{ margin: '8px 0 4px', fontSize: 22, letterSpacing: '-0.02em' }}>Queue</h2>
      <div className="meta" style={{ marginBottom: 8 }}>{p.queue.length} {p.queue.length === 1 ? 'track' : 'tracks'}{p.shuffle ? ' · shuffled' : ''}</div>
      <ul style={{ listStyle: 'none', margin: '0 -20px', padding: 0 }}>
        {p.queue.map((t, i) => {
          const isCurrent = i === p.index;
          return (
            <li key={`${t.key}-${i}`} style={{ display: 'flex', alignItems: 'center' }}>
              <button className="row" style={{ flex: 1, minHeight: 60 }} onClick={() => p.jumpTo(i)} aria-current={isCurrent || undefined}>
                <Artwork src={t.imageUrl} name={t.title} size={44} />
                <div className="grow">
                  <div className="title" style={{ color: isCurrent ? 'var(--accent)' : undefined, fontSize: 15 }}>{t.title}</div>
                  <div className="sub" style={{ fontSize: 13 }}>{t.artist}</div>
                </div>
                {isCurrent && <span className="status new">{p.playing ? 'Playing' : 'Paused'}</span>}
              </button>
              {!isCurrent && <button className="icon-btn" onClick={() => p.removeAt(i)} aria-label={`Remove ${t.title} from queue`}><IcClose size={20} /></button>}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
