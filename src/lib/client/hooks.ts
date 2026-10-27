'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { ApiError, api, cachedGet } from './api';
import type { DiscoveryDTO, FeedPage } from './types';

export type Resource<T> = { data: T | null; loading: boolean; error: ApiError | Error | null; stale: boolean; reload: () => void };

/** GET with offline fallback. Re-runs when `path` changes or the app bumps its data version (after a sync). */
export function useResource<T>(path: string | null): Resource<T> {
  const { version } = useApp();
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: Error | null; stale: boolean }>({ data: null, loading: !!path, error: null, stale: false });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    if (!path) { setState({ data: null, loading: false, error: null, stale: false }); return; }
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    cachedGet<T>(path)
      .then(({ data, stale }) => my === seq.current && setState({ data, loading: false, error: null, stale }))
      .catch((error: Error) => my === seq.current && setState((s) => ({ ...s, loading: false, error })));
  }, [path, version, tick]);

  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Cursor-paged discovery feed: first page cached for offline, later pages fetched on demand. */
export function useFeed(query: string) {
  const first = useResource<FeedPage>(`/api/discoveries?${query}`);
  const [extra, setExtra] = useState<DiscoveryDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => { setExtra([]); setCursor(first.data?.nextCursor ?? null); }, [first.data]);

  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    try {
      const page = await api<FeedPage>(`/api/discoveries?${query}&cursor=${encodeURIComponent(cursor)}`);
      setExtra((e) => [...e, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setMore(false);
    }
  }, [cursor, more, query]);

  return { ...first, items: first.data ? [...first.data.items, ...extra] : [], hasMore: !!cursor, loadingMore: more, loadMore };
}

/** Applies optimistic overrides from the app so toggles feel instant and survive until the next server read. */
export function useViewItems(items: DiscoveryDTO[]): DiscoveryDTO[] {
  const { overrides } = useApp();
  return items.map((i) => {
    const o = overrides[i.track.id];
    return o ? { ...i, heard: o.heard ?? i.heard, saved: o.saved ?? i.saved } : i;
  });
}
