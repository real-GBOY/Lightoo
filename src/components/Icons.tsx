import type { ReactNode, SVGProps } from 'react';

// 24 grid, 1.75 stroke, round caps and joins, currentColor (per the design system).
function I({ children, size = 24, fill = 'none', sw = 1.75, ...p }: SVGProps<SVGSVGElement> & { size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}
type P = { size?: number; filled?: boolean };
const mk = (body: ReactNode) => function Icon({ size }: P) { return <I size={size}>{body}</I>; };

export const IcBack = mk(<path d="M15 5l-7 7 7 7" />);
export const IcChevron = mk(<path d="M9 5l7 7-7 7" />);
export const IcClose = mk(<path d="M6 6l12 12M18 6L6 18" />);
export const IcPlus = mk(<path d="M12 5v14M5 12h14" />);
export const IcRefresh = mk(<><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></>);
export const IcSearch = mk(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const IcExternal = mk(<><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>);
export const IcWifiOff = mk(<><path d="M3 3l18 18" /><path d="M8.5 16.4a5 5 0 017 0" /><path d="M5 12.9a10 10 0 015-2.6M19 12.9a10 10 0 00-3.6-2.2" /><circle cx="12" cy="19.5" r=".6" fill="currentColor" /></>);
export const IcAlert = mk(<><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17.3v.1" /></>);
export const IcMusic = mk(<><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></>);
export const IcDownload = mk(<><path d="M12 4v11M7 11l5 5 5-5" /><path d="M5 20h14" /></>);
export const IcTrash = mk(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>);
export const IcQueue = mk(<><path d="M4 7h12M4 12h12M4 17h8" /><path d="M19 14v6l-4-3z" /></>);
export const IcCheck = ({ size = 14 }: P) => <I size={size} sw={2.4}><path d="M5 12.5l4.5 4.5L19 7.5" /></I>;
export const IcBookmark = ({ size, filled }: P) => <I size={size} fill={filled ? 'currentColor' : 'none'}><path d="M7 4h10a1 1 0 011 1v15l-6-4-6 4V5a1 1 0 011-1z" /></I>;
export const IcPlay = ({ size }: P) => <I size={size} fill="currentColor" sw={1}><path d="M8 5.5v13a1 1 0 001.5.9l10.5-6.5a1 1 0 000-1.8L9.5 4.6A1 1 0 008 5.5z" /></I>;
export const IcPause = ({ size }: P) => <I size={size} fill="currentColor" sw={1}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></I>;
export const IcNext = ({ size }: P) => <I size={size} fill="currentColor" sw={1}><path d="M6 6.2v11.6a.8.8 0 001.2.7l8.3-5.8a.8.8 0 000-1.4L7.2 5.5A.8.8 0 006 6.2z" /><rect x="17" y="5" width="2.4" height="14" rx="1" /></I>;
export const IcPrev = ({ size }: P) => <I size={size} fill="currentColor" sw={1}><path d="M18 6.2v11.6a.8.8 0 01-1.2.7l-8.3-5.8a.8.8 0 010-1.4l8.3-5.8A.8.8 0 0118 6.2z" /><rect x="4.6" y="5" width="2.4" height="14" rx="1" /></I>;
export const IcShuffle = mk(<><path d="M3 7h3c5 0 5 10 10 10h5M3 17h3c1.5 0 2.6-.8 3.5-2M13.5 9C14.4 7.800 15.500 7 17 7h4" /><path d="M18 4l3 3-3 3M18 14l3 3-3 3" /></>);
export const IcRepeat = mk(<><path d="M4 11V9a3 3 0 013-3h13M20 13v2a3 3 0 01-3 3H4" /><path d="M17 3l3 3-3 3M7 21l-3-3 3-3" /></>);
export const IcNew = ({ size = 24 }: P) => <I size={size}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" fill="currentColor" /></I>;
export const IcList = mk(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.500" cy="6" r=".8" fill="currentColor" /><circle cx="4.500" cy="12" r=".8" fill="currentColor" /><circle cx="4.500" cy="18" r=".8" fill="currentColor" /></>);
export const IcClock = mk(<><circle cx="12" cy="12" r="8.500" /><path d="M12 7.500V12l3 2" /></>);
export const IcGear = mk(<><circle cx="12" cy="12" r="3" /><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800" /></>);
