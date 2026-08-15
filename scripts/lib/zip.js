/**
 * Minimal, deterministic ZIP writer and reader.
 *
 * Why our own: the platform has no dependencies (ADR 0001), and the released
 * skill bundle must be byte reproducible (ADR 0017). Shelling out to `zip`
 * would add a tool dependency and stamp the current time into every entry.
 *
 * Determinism measures:
 *   - fixed DOS timestamp for every entry
 *   - entries sorted by path before writing
 *   - fixed compression level and fixed external attributes
 *   - no "extra" fields, no archive comment, no directory entries
 *
 * Only the subset needed here is implemented: deflate and store, no ZIP64,
 * no encryption, no multi-disk archives. Files above 4 GiB are rejected rather
 * than silently truncated.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

/** 2020-01-01 00:00:00, encoded as DOS date/time. Constant on purpose. */
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** Version made by: 3 = UNIX, 20 = ZIP 2.0 feature set. */
const VERSION_MADE_BY = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_SIZE = 0xffffffff;

/** @type {Uint32Array|null} */
let crcTable = null;

/**
 * @returns {Uint32Array}
 */
function getCrcTable() {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/**
 * @param {Buffer} buffer
 * @returns {number} CRC-32 as an unsigned 32 bit integer
 */
export function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = table[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * @typedef {object} ZipEntry
 * @property {string} path      forward slash separated path inside the archive
 * @property {Buffer} data
 * @property {boolean} [executable] sets mode 0755 instead of 0644
 */

/**
 * Build a ZIP archive. The same entries always produce the same bytes on a given
 * Node major version; the content itself is additionally pinned by the manifest
 * that build-skill.js writes into the archive.
 *
 * @param {ZipEntry[]} entries
 * @param {{compress?: boolean}} [options]
 * @returns {Buffer}
 */
export function createZip(entries, options = {}) {
  const compress = options.compress ?? true;
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const seen = new Set();
  for (const entry of sorted) {
    if (seen.has(entry.path)) throw new Error(`duplicate entry in archive: ${entry.path}`);
    if (entry.path.startsWith('/') || entry.path.includes('..')) {
      throw new Error(`unsafe entry path: ${entry.path}`);
    }
    seen.add(entry.path);
  }

  /** @type {Buffer[]} */
  const localParts = [];
  /** @type {Buffer[]} */
  const centralParts = [];
  let offset = 0;

  for (const entry of sorted) {
    const name = Buffer.from(entry.path, 'utf8');
    const raw = entry.data;
    if (raw.length > MAX_SIZE) throw new Error(`entry too large for ZIP32: ${entry.path}`);

    const deflated = compress ? deflateRawSync(raw, { level: 9 }) : null;
    // Never let compression make an entry bigger than storing it.
    const useDeflate = deflated !== null && deflated.length < raw.length;
    const payload = useDeflate ? /** @type {Buffer} */ (deflated) : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const checksum = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    localHeader.writeUInt16LE(VERSION_NEEDED, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    centralHeader.writeUInt16LE(VERSION_MADE_BY, 4);
    centralHeader.writeUInt16LE(VERSION_NEEDED, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    const mode = entry.executable ? 0o100755 : 0o100644;
    centralHeader.writeUInt32LE((mode << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + payload.length;
  }

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, central, eocd]);
}

/**
 * Read a ZIP archive produced by createZip (or any simple ZIP32 archive).
 * Used by the verification step, so that checking a release artefact needs no
 * external tool either.
 *
 * @param {Buffer} buffer
 * @returns {Array<{path: string, data: Buffer, mode: number}>}
 */
export function readZip(buffer) {
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('not a ZIP archive: end of central directory not found');

  const total = buffer.readUInt16LE(eocdOffset + 10);
  let cursor = buffer.readUInt32LE(eocdOffset + 16);

  /** @type {Array<{path: string, data: Buffer, mode: number}>} */
  const entries = [];
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error(`corrupt central directory at entry ${i}`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttrs = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const payload = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === METHOD_DEFLATE ? inflateRawSync(payload) : Buffer.from(payload);
    if (data.length !== uncompressedSize) {
      throw new Error(`size mismatch for ${path}: expected ${uncompressedSize}, got ${data.length}`);
    }

    entries.push({ path, data, mode: (externalAttrs >>> 16) & 0xffff });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
