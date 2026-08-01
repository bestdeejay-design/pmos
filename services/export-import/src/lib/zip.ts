import { deflateRawSync } from "node:zlib";

/**
 * Minimal in-memory ZIP writer (no runtime dependency).
 *
 * Produces a standard .zip with DEFLATE entries + UTF-8 file names, readable by
 * any unzip tool. Used by GET /export. A JSON-object fallback lives in the route
 * for environments where even this cannot run (effectively never).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (CRC_TABLE[(c ^ buf.readUInt8(i)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(): { time: number; date: number } {
  const d = new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

interface ZipEntry {
  name: Buffer;
  crc: number;
  comp: Buffer;
  size: number;
  csize: number;
  offset: number;
  time: number;
  date: number;
}

const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const EOCD_SIZE = 22;

/** Build a ZIP archive from `{ "path/in.zip": "content" }` entries. */
export function buildZip(files: Record<string, string>): Buffer {
  const { time, date } = dosDateTime();
  const chunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(content, "utf8");
    const comp = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);

    const local = Buffer.alloc(LOCAL_HEADER);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, comp);
    entries.push({ name: nameBuf, crc, comp, size: data.length, csize: comp.length, offset, time, date });
    offset += LOCAL_HEADER + nameBuf.length + comp.length;
  }

  const cdStart = offset;
  const central: Buffer[] = [];
  for (const e of entries) {
    const c = Buffer.alloc(CENTRAL_HEADER);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(e.time, 12);
    c.writeUInt16LE(e.date, 14);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.csize, 20);
    c.writeUInt32LE(e.size, 24);
    c.writeUInt16LE(e.name.length, 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(e.offset, 42);
    central.push(c, e.name);
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, ...central, eocd]);
}
