// Minimal IndexedDB wrapper. PostgreSQL is the source of truth; this holds
//  - kv:    last good API responses, for offline browsing
//  - queue: user-state changes made offline, replayed on reconnect
//  - audio: user-imported audio blobs (never sent to the server)
// Every call degrades to a no-op/null when IndexedDB is unavailable (private mode, eviction, old iOS).

const DB_NAME = 'lightoo';
const VERSION = 1;

export type QueuedOp = { key: string; trackId: string; heard?: boolean; saved?: boolean; at: string };
export type StoredAudio = { id: string; trackId: string | null; title: string; mimeType: string; sizeBytes: number; blob: Blob; addedAt: string };

let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('kv');
        d.createObjectStore('queue', { keyPath: 'key' });
        const a = d.createObjectStore('audio', { keyPath: 'id' });
        a.createIndex('trackId', 'trackId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const t = d.transaction(store, mode);
      const r = run(t.objectStore(store));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      t.onabort = () => resolve(null); // quota exceeded etc.
    } catch {
      resolve(null);
    }
  });
}

export const kv = {
  get: <T>(key: string) => tx<T>('kv', 'readonly', (s) => s.get(key) as IDBRequest<T>),
  set: (key: string, value: unknown) => tx('kv', 'readwrite', (s) => s.put(value, key)),
  clear: () => tx('kv', 'readwrite', (s) => s.clear()),
};

export const queue = {
  /** One slot per (track): later changes merge into the pending op instead of piling up. */
  async put(op: Omit<QueuedOp, 'key'>) {
    const prev = await tx<QueuedOp>('queue', 'readonly', (s) => s.get(op.trackId) as IDBRequest<QueuedOp>);
    const merged: QueuedOp = { ...(prev ?? {}), ...op, key: op.trackId };
    return tx('queue', 'readwrite', (s) => s.put(merged));
  },
  all: async () => (await tx<QueuedOp[]>('queue', 'readonly', (s) => s.getAll())) ?? [],
  remove: (key: string) => tx('queue', 'readwrite', (s) => s.delete(key)),
  clear: () => tx('queue', 'readwrite', (s) => s.clear()),
};

export const audio = {
  put: (a: StoredAudio) => tx('audio', 'readwrite', (s) => s.put(a)),
  get: (id: string) => tx<StoredAudio>('audio', 'readonly', (s) => s.get(id) as IDBRequest<StoredAudio>),
  all: async () => (await tx<StoredAudio[]>('audio', 'readonly', (s) => s.getAll())) ?? [],
  remove: (id: string) => tx('audio', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('audio', 'readwrite', (s) => s.clear()),
  async byTrack(trackId: string) {
    const d = await open();
    if (!d) return null;
    return new Promise<StoredAudio | null>((resolve) => {
      try {
        const r = d.transaction('audio', 'readonly').objectStore('audio').index('trackId').get(trackId);
        r.onsuccess = () => resolve((r.result as StoredAudio | undefined) ?? null);
        r.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  },
};

/** Ask the browser not to evict our storage. iOS honours this for installed Home Screen apps. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
