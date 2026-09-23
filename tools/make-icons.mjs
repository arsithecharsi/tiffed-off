// Generates icons/icon-512.png and icon-180.png with zero dependencies:
// TIFFED OFF! — hand-styled strawberry + bomb on cream paper, hand-encoded PNG.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crc]);
}

function encodePNG(px, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;

// strawberry body: point-in-union of circles along a shrinking spine (512-space)
function berryDist(x, y) {
  let best = 1e9;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const cy = 218 + 180 * t;
    const r = lerp(118, 22, t * t * 0.55 + t * 0.45);
    const d = Math.hypot(x - 236, y - cy) - r;
    if (d < best) best = d;
  }
  return best;
}
function crownTop(x) {
  const rel = x - 128;
  const tooth = Math.abs(((rel % 72) + 72) % 72 - 36);
  return 152 + tooth * 1.55;
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = size / 512;
  const corner = 110 * k;
  const put = (i, r, g, b, a = 255) => { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  const seeds = [[196, 300], [268, 292], [232, 352], [200, 388], [270, 372], [236, 430]];

  for (let yy = 0; yy < size; yy++) {
    for (let xx = 0; xx < size; xx++) {
      const i = (yy * size + xx) * 4;
      const x = xx / k, y = yy / k;
      // rounded-rect mask + ink sticker border
      const cx = Math.max(corner - xx, xx - (size - 1 - corner), 0);
      const cy = Math.max(corner - yy, yy - (size - 1 - corner), 0);
      const cd = Math.sqrt(cx * cx + cy * cy);
      if (cd > corner) { put(i, 0, 0, 0, 0); continue; }
      put(i, 0xf7, 0xef, 0xdf); // cream paper
      if (cd > corner - 14 * k || xx < 14 * k || yy < 14 * k || xx > size - 1 - 14 * k || yy > size - 1 - 14 * k) {
        const edge = Math.min(xx, yy, size - 1 - xx, size - 1 - yy);
        if (cd > corner - 14 * k || edge < 14 * k) { put(i, 0x2a, 0x26, 0x24); continue; }
      }

      // crown (drawn under the berry top)
      if (y > crownTop(x) && y < 240 && Math.abs(x - 236) < 118) {
        put(i, 0x3f, 0x9b, 0x4f);
        if (y < crownTop(x) + 9) put(i, 0x2a, 0x26, 0x24);
      }

      // berry
      const bd = berryDist(x, y);
      if (bd <= 0 && y > 205) {
        if (bd > -11) put(i, 0x2a, 0x26, 0x24);               // ink outline
        else {
          put(i, 0xe5, 0x25, 0x4f);
          for (const [sx, sy] of seeds) {
            if (Math.hypot((x - sx) * 1.4, y - sy) < 9) put(i, 0xff, 0xd9, 0xa8);
          }
          if (Math.hypot((x - 190) * 1.1, (y - 268) * 1.7) < 30) put(i, 0xff, 0x8f, 0xa8); // highlight
        }
      }

      // bomb top-right
      const bx = x - 398, by = y - 142;
      const bbd = Math.hypot(bx, by) - 62;
      if (bbd <= 0) {
        put(i, bbd > -10 ? 0x2a : 0x35, bbd > -10 ? 0x26 : 0x31, bbd > -10 ? 0x24 : 0x3c);
        if (Math.hypot(bx + 22, by + 20) < 16) put(i, 0x5a, 0x55, 0x66);
      }
      if (Math.abs(bx - 32 - (by + 74) * 0.35) < 7 && by > -96 && by < -56) put(i, 0x2a, 0x26, 0x24); // fuse
      if (Math.abs(bx - 42) + Math.abs(by + 104) < 18) put(i, 0xf0, 0xa8, 0x21);                       // spark
      if (Math.abs(bx - 42) + Math.abs(by + 104) < 7) put(i, 0xe5, 0x25, 0x4f);
    }
  }
  return encodePNG(px, size, size);
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
writeFileSync(new URL("../icons/icon-512.png", import.meta.url), makeIcon(512));
writeFileSync(new URL("../icons/icon-180.png", import.meta.url), makeIcon(180));
console.log("icons written");
