'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/client/api';
import { resolveTrack, type PlayerTrack, type Resolved } from '@/lib/client/providers';

export type Repeat = 'off' | 'all' | 'one';

type Ctx = {
  queue: PlayerTrack[];
  current: PlayerTrack | null;
  index: number;
  playing: boolean;
  loading: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: Repeat;
  error: string | null;
  nowPlayingOpen: boolean;
  queueOpen: boolean;
  setNowPlayingOpen: (o: boolean) => void;
  setQueueOpen: (o: boolean) => void;
  playTracks: (tracks: PlayerTrack[], start?: number) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (sec: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  jumpTo: (queueIndex: number) => void;
  removeAt: (queueIndex: number) => void;
  stop: () => void;
};

const PlayerCtx = createContext<Ctx | null>(null);
export const usePlayer = () => {
  const c = useContext(PlayerCtx);
  if (!c) throw new Error('usePlayer outside PlayerProvider');
  return c;
};

function shuffled(n: number, first: number): number[] {
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [first, ...rest];
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const release = useRef<(() => void) | null>(null);
  const started = useRef<{ trackId: string; at: string } | null>(null);
  const token = useRef(0);

  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [pos, setPos] = useState(-1); // cursor into `order`
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('off');
  const [error, setError] = useState<string | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const index = pos >= 0 ? (order[pos] ?? -1) : -1;
  const current = index >= 0 ? (queue[index] ?? null) : null;

  const reportPlayback = useCallback((completed: boolean) => {
    const s = started.current;
    const a = el.current;
    started.current = null;
    if (!s || !a) return;
    const playedMs = Math.round(a.currentTime * 1000);
    if (playedMs < 1000) return;
    // Server records it only if the owner enabled playback history; failures are irrelevant to playback.
    void api('/api/playback', { method: 'POST', json: { trackId: s.trackId, startedAt: s.at, playedMs, completed } }).catch(() => {});
  }, []);

  const load = useCallback(async (track: PlayerTrack) => {
    const a = el.current;
    if (!a) return;
    const my = ++token.current;
    reportPlayback(false);
    a.pause();
    release.current?.();
    release.current = null;
    setError(null);
    setLoading(true);
    setPosition(0);
    setDuration(0);
    let r: Resolved;
    try {
      r = await resolveTrack(track);
    } catch {
      r = { ok: false, reason: 'error', message: 'Could not read the audio file.' };
    }
    if (my !== token.current) { if (r.ok) r.release(); return; } // superseded by a newer request
    setLoading(false);
    if (!r.ok) {
      setPlaying(false);
      setError(r.message);
      return;
    }
    release.current = r.release;
    a.src = r.url;
    try {
      await a.play();
      if (track.trackId) started.current = { trackId: track.trackId, at: new Date().toISOString() };
    } catch (e) {
      setPlaying(false);
      setError((e as Error).name === 'NotAllowedError' ? 'Tap play to start.' : 'This file could not be played.');
    }
  }, [reportPlayback]);

  // load whenever the current track changes
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (!current) { lastKey.current = null; return; }
    if (lastKey.current === current.key && !loading && el.current?.src) return;
    lastKey.current = current.key;
    void load(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.key, pos]);

  const advance = useCallback((dir: 1 | -1, auto: boolean) => {
    if (!queue.length) return;
    if (auto && repeat === 'one') { const a = el.current; if (a) { a.currentTime = 0; void a.play(); } return; }
    const n = pos + dir;
    if (n >= order.length) {
      if (repeat === 'all') {
        if (order.length === 1) { const el0 = el.current; if (el0) { el0.currentTime = 0; void el0.play(); } return; } // same cursor would not retrigger the load effect
        setPos(0); lastKey.current = null; return;
      }
      setPlaying(false);
      return;
    }
    setPos(Math.max(0, n));
    lastKey.current = null;
  }, [queue.length, pos, order.length, repeat]);

  // audio element + events (created once)
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const a = new Audio();
    a.preload = 'metadata';
    el.current = a;
    const on = <K extends keyof HTMLMediaElementEventMap>(ev: K, fn: () => void) => a.addEventListener(ev, fn);
    on('play', () => setPlaying(true));
    on('pause', () => setPlaying(false));
    on('timeupdate', () => setPosition(a.currentTime));
    on('durationchange', () => setDuration(Number.isFinite(a.duration) ? a.duration : 0));
    on('ended', () => { reportPlayback(true); advanceRef.current(1, true); });
    on('error', () => { setPlaying(false); setError('This file could not be played.'); });
    return () => { a.pause(); a.src = ''; release.current?.(); };
  }, [reportPlayback]);

  const playTracks = useCallback((tracks: PlayerTrack[], start = 0) => {
    if (!tracks.length) return;
    setQueue(tracks);
    setOrder(shuffle ? shuffled(tracks.length, start) : tracks.map((_, i) => i));
    setPos(shuffle ? 0 : start);
    lastKey.current = null;
    setNowPlayingOpen(false);
  }, [shuffle]);

  const toggle = useCallback(() => {
    const a = el.current;
    if (!a || !current) return;
    if (a.paused) {
      if (!a.src || error) { lastKey.current = null; void load(current); } else void a.play().catch(() => setError('Tap play to start.'));
    } else a.pause();
  }, [current, error, load]);

  const seek = useCallback((sec: number) => { const a = el.current; if (a && Number.isFinite(sec)) { a.currentTime = sec; setPosition(sec); } }, []);

  const prev = useCallback(() => {
    const a = el.current;
    if (a && a.currentTime > 3) return seek(0);
    advance(-1, false);
  }, [advance, seek]);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const on = !s;
      if (queue.length) {
        const cur = index >= 0 ? index : 0;
        setOrder(on ? shuffled(queue.length, cur) : queue.map((_, i) => i));
        setPos(on ? 0 : cur);
        lastKey.current = current?.key ?? null; // same track keeps playing
      }
      return on;
    });
  }, [queue, index, current?.key]);

  const jumpTo = useCallback((qi: number) => {
    const p = order.indexOf(qi);
    if (p >= 0) { setPos(p); lastKey.current = null; }
  }, [order]);

  const removeAt = useCallback((qi: number) => {
    if (qi === index) return; // removing the playing track is "stop", not "remove"
    const nq = queue.filter((_, i) => i !== qi);
    const remap = (i: number) => (i > qi ? i - 1 : i);
    const no = order.filter((i) => i !== qi).map(remap);
    setQueue(nq);
    setOrder(no);
    setPos(no.indexOf(remap(index)));
  }, [queue, order, index]);

  const stop = useCallback(() => {
    reportPlayback(false);
    token.current++;
    el.current?.pause();
    release.current?.(); release.current = null;
    setQueue([]); setOrder([]); setPos(-1); setPlaying(false); setNowPlayingOpen(false); setQueueOpen(false); setError(null);
    lastKey.current = null;
  }, [reportPlayback]);

  const cycleRepeat = useCallback(() => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')), []);

  // Lock-screen / headphone controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({ title: current.title, artist: current.artist, artwork: current.imageUrl ? [{ src: current.imageUrl }] : [] });
    ms.setActionHandler('play', toggle);
    ms.setActionHandler('pause', toggle);
    ms.setActionHandler('nexttrack', () => advance(1, false));
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  }, [current, toggle, advance, prev, seek]);

  const value = useMemo<Ctx>(
    () => ({
      queue, current, index, playing, loading, position, duration, shuffle, repeat, error, nowPlayingOpen, queueOpen,
      setNowPlayingOpen, setQueueOpen, playTracks, toggle, next: () => advance(1, false), prev, seek, toggleShuffle, cycleRepeat, jumpTo, removeAt, stop,
    }),
    [queue, current, index, playing, loading, position, duration, shuffle, repeat, error, nowPlayingOpen, queueOpen, playTracks, toggle, advance, prev, seek, toggleShuffle, cycleRepeat, jumpTo, removeAt, stop],
  );
  return <PlayerCtx.Provider value={value}>{children}</PlayerCtx.Provider>;
}
