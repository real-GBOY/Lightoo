'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { IcChevron } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { Button, Dialog, fmtBytes, timeAgo } from '@/components/ui';
import { ApiError, api } from '@/lib/client/api';
import { audio, kv, queue, storageEstimate } from '@/lib/client/idb';
import { useResource } from '@/lib/client/hooks';
import type { SettingsDTO } from '@/lib/client/types';

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} style={{ width: 51, height: 31, borderRadius: 16, background: checked ? 'var(--accent)' : 'var(--s3)', position: 'relative', flex: 'none', opacity: disabled ? 0.4 : 1, transition: 'background 160ms' }}>
      <span style={{ position: 'absolute', top: 2, left: checked ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: checked ? 'var(--accent-ink)' : 'var(--text-2)', transition: 'left 160ms var(--ease)' }} />
    </button>
  );
}

export default function SettingsPage() {
  const { me, online, settings, setSettings, sync, runSync, refreshMe, toast, pending } = useApp();
  const player = usePlayer();
  const router = useRouter();
  const counts = useResource<{ playlists: number; discoveries: number; saved: number }>('/api/data');
  const [dialog, setDialog] = useState<null | 'disconnect' | 'delete'>(null);
  const [confirmText, setConfirmText] = useState('');
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void storageEstimate().then(setUsage); }, []);

  async function patch(p: Partial<SettingsDTO>) {
    const prev = settings;
    setSettings({ ...settings, ...p });
    try { setSettings(await api<SettingsDTO>('/api/settings', { method: 'PUT', json: p })); }
    catch { setSettings(prev); toast(online ? 'Could not save that setting.' : 'Connect to the internet to change settings.'); }
  }

  async function disconnect() {
    setBusy(true);
    try { await api('/api/spotify', { method: 'DELETE' }); await refreshMe(); setDialog(null); toast('Spotify disconnected. History stays.'); }
    catch { toast('Could not disconnect. Try again.'); } finally { setBusy(false); }
  }

  async function wipe() {
    setBusy(true);
    try {
      await api('/api/data', { method: 'DELETE', json: { confirm: 'DELETE' } });
      await Promise.all([kv.clear(), queue.clear(), audio.clear()]);
      setDialog(null);
      toast('All data deleted.');
      await refreshMe();
      router.replace('/connect');
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete. Try again.'); } finally { setBusy(false); }
  }

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/login');
  }

  const sp = me?.spotify;
  const connected = sp?.status === 'ACTIVE';
  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header"><h1 className="page-title">Settings</h1></div>

      <div className="section-label pad" style={{ padding: '8px 20px' }}>Spotify account</div>
      <div className="list-group">
        <div className="row">
          <div className="grow">
            <div className="title">{connected ? (sp.displayName ?? sp.spotifyUserId) : sp?.status === 'EXPIRED' ? 'Sign-in expired' : 'Not connected'}</div>
            <div className="sub">{connected ? 'Connected' : sp?.status === 'EXPIRED' ? 'Reconnect to resume checking' : 'History stays; syncing is stopped'}</div>
          </div>
          {connected ? <Button variant="text" onClick={() => setDialog('disconnect')}>Disconnect</Button> : <Link href="/connect" className="btn text">{sp?.status === 'EXPIRED' ? 'Reconnect' : 'Connect'}</Link>}
        </div>
      </div>

      <div className="list-group">
        <Link href="/import" className="row" style={{ color: 'var(--text)' }}><div className="grow"><div className="title">Import from Spotify export</div><div className="sub">Load playlists from a data export file. No Premium needed.</div></div><IcChevron /></Link>
      </div>

      <div className="section-label pad" style={{ padding: '8px 20px' }}>Sync</div>
      <div className="list-group">
        <div className="row"><div className="grow"><div className="title">Check when opened</div><div className="sub">iOS can’t sync in the background, so LIGHTOO checks at launch.</div></div><Switch label="Check when opened" checked={settings.syncOnOpen} onChange={(v) => void patch({ syncOnOpen: v })} /></div>
        <div className="row"><div className="grow"><div className="title">Last checked</div><div className="sub mono">{timeAgo(sync.at)}</div></div><Button variant="secondary" loading={sync.phase === 'syncing'} disabled={!online || !connected} onClick={() => void runSync()}>Check now</Button></div>
        {pending > 0 && <div className="row"><div className="grow"><div className="title">{pending} change{pending > 1 ? 's' : ''} waiting</div><div className="sub">Made offline. They sync when you reconnect.</div></div></div>}
      </div>

      <div className="section-label pad" style={{ padding: '8px 20px' }}>Alerts</div>
      <div className="list-group">
        <div className="row"><div className="grow"><div className="title">Notifications</div><div className="sub">Not available yet. They need a separate push service.</div></div><Switch label="Notifications" checked={false} disabled onChange={() => {}} /></div>
      </div>

      <div className="section-label pad" style={{ padding: '8px 20px' }}>Playback &amp; storage</div>
      <div className="list-group">
        <div className="row"><div className="grow"><div className="title">Record what I play in LIGHTOO</div><div className="sub">Only files played here. Spotify listening is never visible to LIGHTOO.</div></div><Switch label="Record playback history" checked={settings.recordPlayback} onChange={(v) => void patch({ recordPlayback: v })} /></div>
        <Link href="/downloads" className="row" style={{ color: 'var(--text)' }}><div className="grow"><div className="title">Downloads</div><div className="sub">Audio files you added to this device</div></div><IcChevron /></Link>
        <div className="row"><div className="grow"><div className="title">Used on this device</div><div className="sub mono">{usage ? `${fmtBytes(usage.usage)} of ${fmtBytes(usage.quota)}` : 'Unavailable'}</div></div></div>
        <button className="row" onClick={() => setDialog('delete')} style={{ color: 'var(--error)' }}><div className="grow"><div className="title">Delete all data…</div></div></button>
      </div>

      <div className="section-label pad" style={{ padding: '8px 20px' }}>About</div>
      <div className="list-group">
        <div className="row"><div className="grow"><div className="title">LIGHTOO</div><div className="sub">Version 0.1 · signed in as {me?.email ?? '…'}</div></div></div>
        <button className="row" onClick={() => void signOut()}><div className="grow"><div className="title">Sign out</div></div></button>
      </div>

      {dialog === 'disconnect' && (
        <Dialog title="Disconnect Spotify?" onClose={() => setDialog(null)}>
          <p>LIGHTOO will delete its Spotify sign-in and stop checking playlists. Everything it already found stays in History and Saved.</p>
          <Button variant="destructive" loading={busy} onClick={() => void disconnect()}>Disconnect</Button>
          <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
        </Dialog>
      )}
      {dialog === 'delete' && (
        <Dialog title="Delete all data?" onClose={() => { setDialog(null); setConfirmText(''); }}>
          <p>
            This permanently removes {counts.data ? `${counts.data.playlists} playlists, ${counts.data.discoveries} discoveries and ${counts.data.saved} saved tracks` : 'your playlists, discoveries and saved tracks'}, your Spotify sign-in, and every audio file on this device. It cannot be undone.
          </p>
          <label className="field"><span className="sr">Type DELETE to confirm</span><input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="Type DELETE to confirm" autoCapitalize="characters" /></label>
          <Button variant="destructive" loading={busy} disabled={confirmText !== 'DELETE' || !online} onClick={() => void wipe()}>Delete everything</Button>
          <Button variant="secondary" onClick={() => { setDialog(null); setConfirmText(''); }}>Cancel</Button>
        </Dialog>
      )}
    </main>
  );
}
