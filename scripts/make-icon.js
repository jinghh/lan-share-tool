'use strict';

/**
 * 生成应用图标（无第三方依赖，纯 Node + zlib）。
 *
 *   assets/app.ico   Windows（pkg 打包后用 rcedit 写入 exe）
 *   assets/app.icns  macOS（放进 .app/Contents/Resources）
 *
 * ICO / ICNS 都支持直接内嵌 PNG（Vista+ / 10.7+），所以只要能编出 PNG 即可。
 * 图案：圆角方块底 + 白色「上传」箭头。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const ICNS_CHUNKS = [
  { type: 'ic08', size: 256 },
  { type: 'ic07', size: 128 },
];

const BG = [76, 110, 245]; // #4C6EF5
const FG = [255, 255, 255];

// ---------------- CRC32 ----------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- PNG 编码 ----------------

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);

  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------- 形状（返回 0~1 覆盖率，带 1px 羽化抗锯齿）----------------

function insideRoundRect(x, y, s) {
  const r = s * 0.22;
  if (x < -0.5 || y < -0.5 || x > s + 0.5 || y > s + 0.5) return 0;

  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= r - 0.5) return 1;
  if (dist >= r + 0.5) return 0;
  return r + 0.5 - dist;
}

function insideRect(x, y, x0, y0, x1, y1) {
  const cx = Math.min(Math.max(x, x0), x1);
  const cy = Math.min(Math.max(y, y0), y1);
  const dist = Math.max(Math.abs(x - cx), Math.abs(y - cy));
  if (dist <= 0) return 1;
  if (dist >= 1) return 0;
  return 1 - dist;
}

function insideArrow(x, y, s) {
  const apexY = s * 0.26;
  const baseY = s * 0.54;
  const half = s * 0.24;
  if (y < apexY || y > baseY) return 0;

  const halfAtY = half * ((y - apexY) / (baseY - apexY));
  const dx = Math.abs(x - s * 0.5);
  if (dx <= halfAtY - 0.5) return 1;
  if (dx >= halfAtY + 0.5) return 0;
  return halfAtY + 0.5 - dx;
}

function insideStem(x, y, s) {
  return insideRect(x, y, s * 0.45, s * 0.48, s * 0.55, s * 0.74);
}

function insideBase(x, y, s) {
  return insideRect(x, y, s * 0.26, s * 0.72, s * 0.74, s * 0.82);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = px + 0.5;
      const y = py + 0.5;

      const covBg = insideRoundRect(x, y, size);
      const covFg = Math.min(
        Math.max(insideArrow(x, y, size), insideStem(x, y, size), insideBase(x, y, size)),
        covBg,
      );

      const offset = (py * size + px) * 4;
      const mix = (fg, bg, cov) => Math.round(bg + (fg - bg) * cov);

      rgba[offset] = mix(FG[0], BG[0], covFg);
      rgba[offset + 1] = mix(FG[1], BG[1], covFg);
      rgba[offset + 2] = mix(FG[2], BG[2], covFg);
      rgba[offset + 3] = Math.round(255 * covBg);
    }
  }

  return rgba;
}

function pngFor(size, cache) {
  if (!cache.has(size)) {
    cache.set(size, encodePng(size, renderIcon(size)));
  }
  return cache.get(size);
}

// ---------------- ICO / ICNS ----------------

function buildIco(cache) {
  const images = ICO_SIZES.map((size) => ({ size, data: pngFor(size, cache) }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = header.length + images.length * 16;

  for (const image of images) {
    const entry = Buffer.alloc(16);
    entry[0] = image.size >= 256 ? 0 : image.size;
    entry[1] = image.size >= 256 ? 0 : image.size;
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += image.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function buildIcns(cache) {
  const blocks = ICNS_CHUNKS.map((chunk) => {
    const png = pngFor(chunk.size, cache);
    const head = Buffer.alloc(8);
    head.write(chunk.type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });

  const body = Buffer.concat(blocks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);

  return Buffer.concat([header, body]);
}

// ---------------- 入口 ----------------

function main() {
  const outDir = path.resolve(__dirname, '..', 'assets');
  fs.mkdirSync(outDir, { recursive: true });

  const cache = new Map();
  const icoPath = path.join(outDir, 'app.ico');
  const icnsPath = path.join(outDir, 'app.icns');

  fs.writeFileSync(icoPath, buildIco(cache));
  fs.writeFileSync(icnsPath, buildIcns(cache));

  console.log(`🎨 图标已生成: ${icoPath} (${fs.statSync(icoPath).size} B), ${icnsPath} (${fs.statSync(icnsPath).size} B)`);
}

if (require.main === module) {
  main();
}

module.exports = { buildIco, buildIcns, renderIcon };
