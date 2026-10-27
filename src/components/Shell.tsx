'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useResource } from '@/lib/client/hooks';
import type { DiscoveryDTO, PlaylistDTO } from '@/lib/client/types';
import { AppProvider, useApp } from './AppProvider';
import { IcClock, IcGear, IcList, IcNew } from './Icons';
import { MiniPlayer, NowPlaying } from './PlayerUI';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { TrackSheet } from './TrackSheet';

const SheetCtx = createContext<(d: DiscoveryDTO) => void>(() => {});
export const useOpenTrack = () => useContext(SheetCtx);

const TABS = [
  { href: '/', label: 'New', Icon: IcNew },
  { href: '/playlists', label: 'Playlists', Icon: IcList },
  { href: '/history', label: 'History', Icon: IcClock },
  { href: '/settings', label: 'Settings', Icon: IcGear },
] as const;

const NO_CHROME = ['/connect'];

function TabBar() {
  const path = usePathname();
  const { data } = useResource<{ items: PlaylistDTO[] }>('/api/playlists');
  const unheard = (data?.items ?? []).some((p) => p.newCount > 0);
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h));
  // Pushed screens belong to a tab: Saved/Search → New, Downloads → Settings.
  const owner = (h: string) => active(h) || (h === '/' && (path.startsWith('/saved') || path.startsWith('/search'))) || (h === '/settings' && path.startsWith('/downloads'));
  return (
    <div className="tabbar">
      <nav aria-label="Main">
        {TABS.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="tab" aria-current={owner(href) ? 'page' : undefined}>
            <Icon size={24} />
            {label}
            {href === '/' && unheard && <span className="pip" aria-label="Unheard tracks" />}
          </Link>
        ))}
      </nav>
    </div>
  );
}

function Toasts() {
  const { toasts } = useApp();
  const { current } = usePlayer();
  return (
    <div className={`toast-wrap ${current ? 'has-mini-toast' : ''}`} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <span>{t.message}</span>
          {t.action && <button onClick={t.action.run}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

function Chrome({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [sheet, setSheet] = useState<DiscoveryDTO | null>(null);
  const bare = NO_CHROME.some((p) => path.startsWith(p));
  return (
    <SheetCtx.Provider value={setSheet}>
      {children}
      {!bare && <MiniPlayer />}
      {!bare && <TabBar />}
      <TrackSheet item={sheet} onClose={() => setSheet(null)} />
      <NowPlaying />
      <Toasts />
    </SheetCtx.Provider>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <AppProvider>
      <PlayerProvider>
        <Chrome>{children}</Chrome>
      </PlayerProvider>
    </AppProvider>
  );
}
