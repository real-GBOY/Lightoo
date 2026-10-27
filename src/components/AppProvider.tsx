'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ApiError, NetworkError, api, cachedGet } from '@/lib/client/api';
import { kv, queue } from '@/lib/client/idb';
import type { MeDTO, SettingsDTO, SyncResult } from '@/lib/client/types';

type Toast = { id: number; message: string; action?: { label: string; run: () => void } };
type Override = { heard?: boolean; saved?: boolean };
export type SyncState = {
  phase: 'idle' | 'syncing' | 'ok' | 'failed';
  at: string | null;
  message?: string;
  needsReconnect?: boolean;
  newTracks: number;
  failedIds: string[];
};

type Ctx = {
  me: MeDTO | null;
  meStale: boolean;
  online: boolean;
  version: number;
  bump: () => void;
  sync: SyncState;
  runSync: (opts?: { quiet?: boolean }) => Promise<void>;
  settings: SettingsDTO;
  setSettings: (s: SettingsDTO) => void;
  refreshMe: () => Promise<void>;
  toast: (message: string, action?: Toast['action']) => void;
  toasts: Toast[];
  overrides: Record<string, Override>;
  setTrackState: (trackId: string, patch: Override, opts?: { toast?: string; undo?: boolean }) => Promise<void>;
  pending: number;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
};

const PUBLIC = ['/login'];

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [me, setMe] = useState<MeDTO | null>(null);
  const [meStale, setMeStale] = useState(false);
  const [online, setOnline] = useState(true);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [pending, setPending] = useState(0);
  const [settings, setSettings] = useState<SettingsDTO>({ recordPlayback: false, syncOnOpen: true });
  const [sync, setSync] = useState<SyncState>({ phase: 'idle', at: null, newTracks: 0, failedIds: [] });
  const toastId = useRef(0);
  const syncing = useRef(false);
  const synced = useRef(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const toast = useCallback((message: string, action?: Toast['action']) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-1), { id, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // connectivity
  useEffect(() => {
    const set = () => setOnline(navigator.onLine);
    set();
    window.addEventListener('online', set);
    window.addEventListener('offline', set);
    return () => { window.removeEventListener('online', set); window.removeEventListener('offline', set); };
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const { data, stale } = await cachedGet<MeDTO>('/api/auth/me');
      setMe(data);
      setMeStale(stale);
    } catch (e) {
      if (e instanceof ApiError && e.unauthenticated && !PUBLIC.includes(path)) router.replace('/login');
    }
  }, [path, router]);

  useEffect(() => { if (!PUBLIC.includes(path)) void refreshMe(); }, [path, refreshMe]);

  useEffect(() => {
    void kv.get<string>('lastSync').then((t) => t && setSync((s) => ({ ...s, at: t })));
    void queue.all().then((q) => setPending(q.length));
    void cachedGet<SettingsDTO>('/api/settings').then((r) => setSettings(r.data)).catch(() => {});
  }, []);

  // ── offline queue: replay on reconnect; server keeps the newer write (last-writer-wins per field)
  const flush = useCallback(async () => {
    const ops = await queue.all();
    setPending(ops.length);
    if (!ops.length || !navigator.onLine) return;
    try {
      const res = await api<{ results: { trackId: string }[] }>('/api/tracks/state', {
        method: 'POST',
        json: { ops: ops.map(({ trackId, heard, saved, at }) => ({ trackId, heard, saved, at })) },
      });
      // Every op got a definite answer (applied, stale or unknown track), so none will ever need resending.
      for (const r of res.results) await queue.remove(r.trackId);
      setPending((await queue.all()).length);
      bump();
    } catch { /* still offline or server down: keep the queue */ }
  }, [bump]);

  useEffect(() => { if (online && me) void flush(); }, [online, me, flush]);

  const setTrackState = useCallback<Ctx['setTrackState']>(async (trackId, patch, opts) => {
    const at = new Date().toISOString();
    setOverrides((o) => ({ ...o, [trackId]: { ...o[trackId], ...patch } }));
    try {
      await api('/api/tracks/state', { method: 'POST', json: { ops: [{ trackId, ...patch, at }] } });
    } catch (e) {
      if (e instanceof NetworkError) {
        await queue.put({ trackId, ...patch, at });
        setPending((await queue.all()).length);
        toast('Saved on this device. It will sync when you are back online.');
        return;
      }
      setOverrides((o) => ({ ...o, [trackId]: Object.fromEntries(Object.keys(patch).map((k) => [k, !(patch as Record<string, boolean>)[k]])) }));
      toast('Could not update that track. Try again.');
      return;
    }
    if (opts?.toast) {
      const inverse = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, !v])) as Override;
      toast(opts.toast, opts.undo === false ? undefined : { label: 'Undo', run: () => void setTrackState(trackId, inverse) });
    }
  }, [toast]);

  const runSync = useCallback<Ctx['runSync']>(async ({ quiet } = {}) => {
    if (syncing.current) return;
    if (!navigator.onLine) {
      if (!quiet) toast('Still offline. LIGHTOO will check when you reconnect.');
      return;
    }
    syncing.current = true;
    setSync((s) => ({ ...s, phase: 'syncing' }));
    try {
      const r = await api<SyncResult>('/api/sync', { method: 'POST' });
      void kv.set('lastSync', r.at);
      const failed = r.failed.length > 0 || r.needsReconnect;
      setSync({
        phase: failed ? 'failed' : 'ok',
        at: r.at,
        newTracks: r.newTracks,
        failedIds: r.failed,
        needsReconnect: r.needsReconnect,
        message: r.needsReconnect ? 'Spotify sign-in expired.' : failed ? r.results.find((x) => x.error)?.error : undefined,
      });
      if (r.newTracks > 0) toast(`${r.newTracks} new ${r.newTracks === 1 ? 'track' : 'tracks'} found`);
      bump();
    } catch (e) {
      const msg = e instanceof ApiError && e.code === 'spotify.not_connected' ? 'Spotify is not connected.' : e instanceof NetworkError ? 'Offline.' : 'Sync failed. Try again.';
      setSync((s) => ({ ...s, phase: 'failed', message: msg, needsReconnect: e instanceof ApiError && e.code === 'spotify.not_connected' }));
    } finally {
      syncing.current = false;
    }
  }, [bump, toast]);

  // Sync once per launch, because iOS web apps cannot sync in the background.
  useEffect(() => {
    if (synced.current || !me || me.spotify.status !== 'ACTIVE' || !online || !settings.syncOnOpen) return;
    synced.current = true;
    void runSync({ quiet: true });
  }, [me, online, settings.syncOnOpen, runSync]);

  const value = useMemo<Ctx>(
    () => ({ me, meStale, online, version, bump, sync, runSync, settings, setSettings, refreshMe, toast, toasts, overrides, setTrackState, pending }),
    [me, meStale, online, version, bump, sync, runSync, settings, refreshMe, toast, toasts, overrides, setTrackState, pending],
  );
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
