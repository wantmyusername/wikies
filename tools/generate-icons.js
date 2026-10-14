"use strict";

// Genera los iconos de la extensión (icons/icon16.png, icon48.png, icon128.png)
// sin dependencias: cuadrado azul redondeado con «ES» en blanco.
// Uso: node tools/generate-icons.js

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filtro None
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Fuente bitmap 5x7 para «E» y «S».
const GLYPHS = {
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
};

const BG = [51, 102, 204, 255]; // #3366cc
const FG = [255, 255, 255, 255];

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4, 0);
  const radius = size * 0.18;
  const set = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = color[3];
  };
  // Fondo redondeado con antialiasing por cobertura simple.
  const r = radius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.max(r - x, x - (size - 1 - r), 0);
      const dy = Math.max(r - y, y - (size - 1 - r), 0);
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= r) set(x, y, BG);
    }
  }
  // Texto «ES» centrado.
  const chars = ["E", "S"];
  const gw = 5, gh = 7, gap = 1;
  const totalW = gw * chars.length + gap * (chars.length - 1);
  const scale = Math.max(1, Math.floor((size * 0.62) / totalW));
  const textW = totalW * scale;
  const textH = gh * scale;
  const ox = Math.round((size - textW) / 2);
  const oy = Math.round((size - textH) / 2);
  chars.forEach((ch, ci) => {
    const glyph = GLYPHS[ch];
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (glyph[gy][gx] !== "1") continue;
        const bx = ox + (ci * (gw + gap) + gx) * scale;
        const by = oy + gy * scale;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) set(bx + sx, by + sy, FG);
        }
      }
    }
  });
  return px;
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log("escrito", path.relative(path.join(__dirname, ".."), file));
}
