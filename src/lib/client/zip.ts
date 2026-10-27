// Minimal zip reader so the owner can pick Spotify's export .zip directly instead of unzipping it first.
// Reads the central directory, supports "stored" and "deflate" entries (all Spotify uses), and inflates with the
// browser/Node built-in DecompressionStream. Entries are streamed out one at a time; nothing is uploaded.

export type ZipEntry = { name: string; read: () => Promise<Uint8Array> };

const MAX_ENTRY = 200 * 1024 * 1024; // refuse absurd entries (zip-bomb guard)

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([data as BlobPart]).stream().pipeThrough(ds));
  const buf = new Uint8Array(await out.arrayBuffer());
  if (buf.length > MAX_ENTRY) throw new Error('Zip entry too large.');
  return buf;
}

export function listZip(buf: ArrayBuffer): ZipEntry[] {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // End of central directory record: scan backwards for its signature (comment may follow it).
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 22 - 65535); i--) {
    if (u32(v, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid zip file.');
  const count = u16(v, eocd + 10);
  let p = u32(v, eocd + 16);
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(v, p) !== 0x02014b50) throw new Error('Corrupt zip directory.');
    const method = u16(v, p + 10);
    const csize = u32(v, p + 20);
    const usize = u32(v, p + 24);
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      read: async () => {
        if (usize > MAX_ENTRY) throw new Error('Zip entry too large.');
        if (u32(v, local) !== 0x04034b50) throw new Error('Corrupt zip entry.');
        const start = local + 30 + u16(v, local + 26) + u16(v, local + 28);
        const raw = bytes.subarray(start, start + csize);
        if (method === 0) return raw;
        if (method === 8) return inflateRaw(raw);
        throw new Error(`Unsupported zip compression (${method}).`);
      },
    });
  }
  return entries;
}
