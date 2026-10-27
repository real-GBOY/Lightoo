'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { IcBack, IcCheck, IcDownload } from '@/components/Icons';
import { usePlayer } from '@/components/PlayerProvider';
import { Banner, Button } from '@/components/ui';
import { ApiError, NetworkError, api } from '@/lib/client/api';
import { listZip } from '@/lib/client/zip';
import { mergeByName, parseExportDocument, type ImportPlaylist } from '@/lib/spotify/exportParser';

type Result = { name: string; ok: boolean; created?: boolean; newTracks?: number; removedTracks?: number; unchanged?: boolean; error?: string };
const PLAYLIST_FILE = /(^|\/)playlist[^/]*\.json$/i;

/** Reads picked files (JSON, or the whole export .zip) into playlists, entirely in the browser. */
async function readFiles(files: File[]): Promise<{ playlists: ImportPlaylist[]; problems: string[] }> {
  const parts: ImportPlaylist[] = [];
  const problems: string[] = [];
  const dec = new TextDecoder();
  const addJson = (bytes: Uint8Array, label: string) => {
    try {
      const r = parseExportDocument(JSON.parse(dec.decode(bytes)), label);
      parts.push(...r.playlists);
      problems.push(...r.problems);
    } catch {
      problems.push(`${label}: not valid JSON.`);
    }
  };
  for (const f of files) {
    try {
      if (/\.zip$/i.test(f.name)) {
        const entries = listZip(await f.arrayBuffer()).filter((e) => PLAYLIST_FILE.test(e.name));
        if (!entries.length) problems.push(`${f.name}: no Playlist*.json inside. Request “Account data” from Spotify.`);
        for (const e of entries) addJson(await e.read(), e.name.split('/').pop() ?? e.name);
      } else if (/\.json$/i.test(f.name)) addJson(new Uint8Array(await f.arrayBuffer()), f.name);
      else problems.push(`${f.name}: choose Playlist*.json files or the export .zip.`);
    } catch (e) {
      problems.push(`${f.name}: ${(e as Error).message}`);
    }
  }
  return { playlists: mergeByName(parts), problems };
}

export default function ImportPage() {
  const { online, bump, me } = useApp();
  const player = usePlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<'pick' | 'reading' | 'review' | 'importing' | 'done'>('pick');
  const [found, setFound] = useState<ImportPlaylist[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [seed, setSeed] = useState(true);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<Result[]>([]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setPhase('reading');
    const r = await readFiles(Array.from(list));
    setFound(r.playlists);
    setProblems(r.problems);
    setPicked(new Set(r.playlists.filter((p) => p.tracks.length > 0).map((p) => p.name)));
    setPhase(r.playlists.length ? 'review' : 'pick');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function run() {
    const todo = found.filter((p) => picked.has(p.name));
    setPhase('importing');
    setProgress(0);
    const out: Result[] = [];
    for (const [i, p] of todo.entries()) {
      try {
        const r = await api<{ created: boolean; outcome: string; newTracks: number; removedTracks: number }>('/api/import/playlist', {
          method: 'POST',
          json: { name: p.name, seedRecent: seed, tracks: p.tracks },
        });
        out.push({ name: p.name, ok: true, created: r.created, newTracks: r.newTracks, removedTracks: r.removedTracks, unchanged: r.outcome === 'NO_CHANGES' });
      } catch (e) {
        out.push({ name: p.name, ok: false, error: e instanceof NetworkError ? 'Offline' : e instanceof ApiError ? e.message : 'Failed' });
      }
      setProgress(i + 1);
    }
    setResults(out);
    bump();
    setPhase('done');
  }

  const toggle = (name: string) => setPicked((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const total = found.filter((p) => picked.has(p.name)).reduce((n, p) => n + p.tracks.length, 0);
  const newTotal = results.reduce((n, r) => n + (r.newTracks ?? 0), 0);

  return (
    <main className={`screen ${player.current ? 'has-mini' : ''}`}>
      <div className="header" style={{ paddingBottom: 0 }}><Link href="/playlists" className="back"><IcBack /> Playlists</Link></div>
      <div className="header"><div><h1 className="page-title">Import</h1><div className="meta" style={{ marginTop: 4 }}>Load playlists from your Spotify data export. No Spotify connection needed.</div></div></div>

      {!online && <Banner title="You are offline">Importing needs a connection to save your playlists.</Banner>}

      {(phase === 'pick' || phase === 'reading') && (
        <div className="pad" style={{ display: 'grid', gap: 16 }}>
          <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--text-2)', lineHeight: 1.6 }}>
            <li>In Spotify, open <b style={{ color: 'var(--text)' }}>Account → Privacy settings → Download your data</b>, choose <b style={{ color: 'var(--text)' }}>Account data</b> and confirm by email.</li>
            <li>Spotify emails a link, which can take several days. Download the .zip.</li>
            <li>Choose that .zip here, or the <span className="mono">Playlist1.json</span> files inside it.</li>
          </ol>
          <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener noreferrer" className="btn text" style={{ justifyContent: 'flex-start', padding: 0 }}>Open Spotify privacy settings</a>
          <input ref={fileRef} type="file" multiple accept=".zip,.json,application/zip,application/json" hidden onChange={(e) => void onFiles(e.target.files)} />
          <Button variant="primary" loading={phase === 'reading'} onClick={() => fileRef.current?.click()}><IcDownload size={20} /> Choose export file</Button>
          <p className="meta" style={{ margin: 0, lineHeight: 1.5 }}>Your file is read on this device. Only the track titles, artists, albums and the playlist names you select are sent to LIGHTOO.</p>
          {problems.map((p) => <div key={p} role="alert" style={{ color: 'var(--error)', fontSize: 14 }}>{p}</div>)}
        </div>
      )}

      {(phase === 'review' || phase === 'importing') && (
        <>
          <div className="pad" style={{ paddingBottom: 8, color: 'var(--text-2)', lineHeight: 1.5 }}>
            Found {found.length} {found.length === 1 ? 'playlist' : 'playlists'}. Choose what to import. Each playlist’s current tracks become its starting point, so your inbox is not flooded.
          </div>
          <div className="list-group">
            {found.map((p) => {
              const skipped = p.skipped.local + p.skipped.episodes + p.skipped.unreadable;
              return (
                <label key={p.name} className="row" style={{ cursor: 'pointer', opacity: p.tracks.length ? 1 : 0.5 }}>
                  <input type="checkbox" checked={picked.has(p.name)} disabled={!p.tracks.length || phase === 'importing'} onChange={() => toggle(p.name)} style={{ width: 22, height: 22, accentColor: 'var(--accent)', flex: 'none' }} />
                  <div className="grow">
                    <div className="title">{p.name}</div>
                    <div className="sub mono" style={{ fontSize: 12 }}>{p.tracks.length} tracks{skipped ? ` · ${skipped} skipped (local files, podcasts or unreadable)` : ''}</div>
                  </div>
                </label>
              );
            })}
          </div>
          {problems.map((p) => <div key={p} className="pad meta" style={{ color: 'var(--warn)', paddingBottom: 6 }}>{p}</div>)}
          <div className="pad" style={{ display: 'grid', gap: 14, paddingTop: 4 }}>
            <label style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <input type="checkbox" checked={seed} disabled={phase === 'importing'} onChange={(e) => setSeed(e.target.checked)} style={{ width: 22, height: 22, accentColor: 'var(--accent)' }} />
              <span>Show the 10 most recent tracks of each new playlist in New Music</span>
            </label>
            <Button variant="primary" loading={phase === 'importing'} disabled={!online || picked.size === 0} onClick={() => void run()}>
              {phase === 'importing' ? `Importing ${progress} of ${picked.size}…` : `Import ${picked.size} ${picked.size === 1 ? 'playlist' : 'playlists'} · ${total} tracks`}
            </Button>
            {phase === 'review' && <Button variant="text" onClick={() => { setPhase('pick'); setFound([]); setProblems([]); }}>Choose different files</Button>}
          </div>
        </>
      )}

      {phase === 'done' && (
        <div className="pad" style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-ink)', display: 'grid', placeItems: 'center' }}><IcCheck size={18} /></span>
            <h2 style={{ margin: 0, fontSize: 22, letterSpacing: '-0.02em' }}>{results.some((r) => !r.ok) ? 'Import finished with problems' : 'Import complete'}</h2>
          </div>
          <div className="list-group" style={{ margin: 0 }}>
            {results.map((r) => (
              <div key={r.name} className="row">
                <div className="grow">
                  <div className="title">{r.name}</div>
                  <div className="sub" style={{ color: r.ok ? undefined : 'var(--error)' }}>
                    {!r.ok ? r.error : r.unchanged ? 'No changes since the last import' : `${r.created ? 'Added' : 'Updated'} · ${r.newTracks} in New Music${r.removedTracks ? ` · ${r.removedTracks} removed from playlist` : ''}`}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Link href="/" className="btn primary" style={{ color: 'var(--accent-ink)' }}>{newTotal > 0 ? `View ${newTotal} in New Music` : 'Go to New Music'}</Link>
          <Button variant="secondary" onClick={() => { setPhase('pick'); setFound([]); setResults([]); }}>Import more files</Button>
          {!me || me.spotify.status !== 'ACTIVE' ? <p className="meta" style={{ margin: 0 }}>Imported playlists update when you import a newer export. Connecting Spotify later enables live checks.</p> : null}
        </div>
      )}
    </main>
  );
}
