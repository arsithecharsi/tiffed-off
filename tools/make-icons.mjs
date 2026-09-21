// Generates icons/icon-512.png and icon-180.png with zero dependencies:
// software-rasterized watermelon + bomb on a purple gradient, hand-encoded PNG.
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
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = size / 512;
  const corner = 110 * k;
  const put = (i, r, g, b, a = 255) => { px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };

  const seeds = [[-60, 60], [10, 95], [70, 55], [-15, 40], [45, 120], [-80, 115]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // rounded-rect mask
      const cx = Math.max(corner - x, x - (size - 1 - corner), 0);
      const cy = Math.max(corner - y, y - (size - 1 - corner), 0);
      if (cx * cx + cy * cy > corner * corner) { put(i, 0, 0, 0, 0); continue; }
      // diagonal gradient purple -> magenta
      const t = (x + y) / (2 * size);
      put(i, lerp(0x2a, 0xb0, t) | 0, lerp(0x12, 0x1c, t) | 0, lerp(0x45, 0x55, t) | 0);

      // watermelon: semicircle, flat edge up, centered lower-left
      const mx = (x - 225 * k) / k, my = (y - 300 * k) / k;
      const d = Math.hypot(mx, my);
      if (my >= 0 && d <= 185) {
        if (d > 157) put(i, 0x25, 0xc0, 0x4a);           // green rind
        else if (d > 140) put(i, 0xe8, 0xff, 0xe8);      // white inner rind
        else {
          put(i, 0xff, 0x4f, 0x6d);                       // flesh
          for (const [sx, sy] of seeds) {
            if (Math.hypot(mx - sx, (my - sy) * 1.6) < 11) put(i, 0x22, 0x11, 0x22);
          }
        }
      }
      if (my >= -8 && my < 0 && Math.abs(mx) <= 185) put(i, 0xff, 0x8f, 0xa5); // flat top edge

      // bomb: top right
      const bx = (x - 375 * k) / k, by = (y - 165 * k) / k;
      const bd = Math.hypot(bx, by);
      if (bd <= 62) {
        put(i, 0x26, 0x26, 0x30);
        if (Math.hypot(bx + 20, by + 20) < 18) put(i, 0x55, 0x55, 0x66); // highlight
      }
      if (Math.abs(bx - 28) < 7 && by > -85 && by < -55) put(i, 0x8a, 0x6d, 0x3b); // fuse
      if (Math.hypot(bx - 28, by + 92) < 13) put(i, 0xff, 0xd9, 0x4d);             // spark
    }
  }
  return encodePNG(px, size, size);
}

mkdirSync(new URL("../icons/", import.meta.url), { recursive: true });
writeFileSync(new URL("../icons/icon-512.png", import.meta.url), makeIcon(512));
writeFileSync(new URL("../icons/icon-180.png", import.meta.url), makeIcon(180));
console.log("icons written");
