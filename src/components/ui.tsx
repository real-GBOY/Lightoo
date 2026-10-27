'use client';

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { IcAlert, IcClose, IcRefresh, IcWifiOff } from './Icons';

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} aria-label="LIGHTOO">
      LIGHT<span className="on" /><span className="off" />
    </span>
  );
}

export function Artwork({ src, name, size, radius }: { src?: string | null; name?: string; size: number; radius?: number }) {
  const [bad, setBad] = useState(false);
  const r = radius ?? (size <= 56 ? 6 : size <= 124 ? 10 : 12);
  return (
    <div className="art" style={{ width: size, height: size, borderRadius: r, fontSize: size / 2.4 }} aria-hidden="true">
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} /> : (name?.trim()[0] ?? '♪').toUpperCase()}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'destructive' | 'text'; loading?: boolean };
export function Button({ variant = 'secondary', loading, children, className = '', disabled, ...p }: BtnProps) {
  return (
    <button className={`btn ${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading && <span className="spin" style={{ display: 'inline-flex' }}><IcRefresh size={20} /></span>}
      {children}
    </button>
  );
}

export function Banner({ tone = 'neutral', title, children, action }: { tone?: 'neutral' | 'warn' | 'error'; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'neutral' ? 'status' : 'alert'}>
      <span style={{ color: tone === 'error' ? 'var(--error)' : tone === 'warn' ? 'var(--warn)' : 'var(--text-2)', paddingTop: 1 }}>
        {tone === 'neutral' ? <IcWifiOff size={18} /> : <IcAlert size={18} />}
      </span>
      <div style={{ flex: 1 }}>
        <b>{title}</b>
        {children && <span>{children}</span>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div style={{ color: 'var(--text-4)' }}>{icon}</div>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function RowSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="row" style={{ opacity: 1 - i * 0.12 }}>
          <div className="skeleton" style={{ width: 54, height: 54 }} />
          <div className="grow" style={{ display: 'grid', gap: 8 }}>
            <div className="skeleton" style={{ height: 14, width: `${60 - (i % 3) * 10}%` }} />
            <div className="skeleton" style={{ height: 12, width: '40%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Bottom sheet: scrim click, Esc, focus moved in on open and restored on close. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0]!, last = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <div className="handle" />
        <button className="icon-btn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', right: 8, top: 8 }}><IcClose /></button>
        {children}
      </div>
    </>
  );
}

export function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} style={{ zIndex: 41 }} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return 'Found today';
  if (days === 1) return 'Found yesterday';
  return `Found ${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}
