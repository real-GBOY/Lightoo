// Renders the LIGHTOO "OO" mark (lit disc + unlit ring) to PNG with no image dependencies.
// Geometry from the design system: discs are 31% of the tile, gap 4.5%, ring stroke ~19% of diameter.
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const INK = [8, 9, 8], LIME = [200, 242, 58], PAPER = [241, 242, 236], DARK = [13, 14, 13];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function render(size, { bg, disc, ring, scale = 1 }) {
  const d = 0.31 * scale, gap = 0.045 * scale, stroke = d * 0.19;
  const cy = 0.5, c1 = 0.5 - (d + gap) / 2, c2 = 0.5 + (d + gap) / 2;
  const SS = 4;
  return png(size, (px, py) => {
    let acc = [0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
      const d1 = Math.hypot(x - c1, y - cy), d2 = Math.hypot(x - c2, y - cy);
      let col = bg;
      if (d1 <= d / 2) col = disc;
      else if (d2 <= d / 2 && d2 >= d / 2 - stroke) col = ring;
      acc = acc.map((v, i) => v + col[i]);
    }
    return acc.map((v) => Math.round(v / (SS * SS)));
  });
}

mkdirSync('public/icons', { recursive: true });
const primary = { bg: INK, disc: LIME, ring: PAPER };
// Maskable: lime ground, ink circles, inside the 80% safe zone.
const maskable = { bg: LIME, disc: DARK, ring: DARK, scale: 1.0 };
writeFileSync('public/icons/apple-touch-icon.png', render(180, primary));
writeFileSync('public/icons/icon-192.png', render(192, primary));
writeFileSync('public/icons/icon-512.png', render(512, primary));
writeFileSync('public/icons/maskable-512.png', render(512, maskable));
console.log('icons written to public/icons');
