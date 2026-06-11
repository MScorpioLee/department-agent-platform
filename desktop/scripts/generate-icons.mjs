import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const size = 1024;
const data = Buffer.alloc((size * 4 + 1) * size);

function setPixel(row, col, r, g, b, a = 255) {
  const offset = row * (size * 4 + 1) + 1 + col * 4;
  data[offset] = r;
  data[offset + 1] = g;
  data[offset + 2] = b;
  data[offset + 3] = a;
}

function fillRect(x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let col = x; col < x + width; col += 1) {
      setPixel(row, col, color[0], color[1], color[2], color[3] ?? 255);
    }
  }
}

for (let row = 0; row < size; row += 1) {
  data[row * (size * 4 + 1)] = 0;
  for (let col = 0; col < size; col += 1) {
    const rx = col / (size - 1);
    const ry = row / (size - 1);
    const r = Math.round(18 + rx * 22);
    const g = Math.round(36 + ry * 54);
    const b = Math.round(58 + (1 - rx) * 54);
    setPixel(row, col, r, g, b);
  }
}

fillRect(192, 240, 640, 544, [248, 250, 252]);
fillRect(236, 300, 552, 76, [15, 23, 42]);
fillRect(264, 430, 56, 56, [15, 23, 42]);
fillRect(320, 486, 56, 56, [15, 23, 42]);
fillRect(264, 542, 56, 56, [15, 23, 42]);
fillRect(444, 558, 260, 48, [15, 23, 42]);
fillRect(236, 704, 552, 36, [99, 102, 241]);

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])));
  return Buffer.concat([length, typeBuffer, payload, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(data)),
  chunk("IEND", Buffer.alloc(0))
]);

const outputPath = join(root, "assets", "icon-source.png");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, png);
console.log(outputPath);
