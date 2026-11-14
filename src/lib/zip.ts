/**
 * Minimaler ZIP-Leser/-Schreiber ohne Abhängigkeiten (Browser & Node ≥ 18).
 * Schreiben: „stored“ (Audio ist schon komprimiert) bzw. „deflate“ für Text über
 * CompressionStream. Lesen: „stored“ und „deflate“ über DecompressionStream.
 * Kein ZIP64, keine Verschlüsselung – für Projekt-Archive mit Samples völlig ausreichend.
 */

export interface ZipEntry {
  /** Pfad im Archiv mit „/“ als Trenner, ohne führenden „/“. */
  path: string;
  data: Uint8Array;
}

export class ZipError extends Error {
  constructor(readonly reason: 'notZip' | 'unsupported' | 'corrupt') {
    super(`zip: ${reason}`);
    this.name = 'ZipError';
  }
}

/* ------------------------------------------------------------------ */
/* CRC-32                                                              */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ */
/* Streams                                                             */
/* ------------------------------------------------------------------ */

async function pipeThrough(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canDeflate = () => typeof CompressionStream !== 'undefined';

/* ------------------------------------------------------------------ */
/* Schreiben                                                           */
/* ------------------------------------------------------------------ */

const TEXT_EXT = /\.(json|txt|js|md|strudel)$/i;

/**
 * Baut ein ZIP. Textdateien werden (wenn möglich) komprimiert, alles andere gespeichert.
 */
export async function createZip(entries: ZipEntry[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  // DOS-Zeitstempel (fest, damit Archive reproduzierbar sind): 2025-01-01 00:00
  const dosTime = 0;
  const dosDate = ((2025 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const name = enc.encode(entry.path.replace(/^\/+/, ''));
    const crc = crc32(entry.data);
    let method = 0;
    let body = entry.data;
    if (TEXT_EXT.test(entry.path) && canDeflate() && entry.data.length > 64) {
      const deflated = await pipeThrough(entry.data, new CompressionStream('deflate-raw'));
      if (deflated.length < entry.data.length) {
        method = 8;
        body = deflated;
      }
    }

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8-Dateinamen
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Lesen                                                               */
/* ------------------------------------------------------------------ */

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5) && (data[3] === 4 || data[3] === 6);
}

/** Liest alle Dateien eines ZIP (Ordner und macOS-Metadaten werden übersprungen). */
export async function readZip(data: Uint8Array): Promise<ZipEntry[]> {
  if (!isZip(data)) throw new ZipError('notZip');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // End of Central Directory suchen (max. 64 KiB Kommentar)
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('corrupt');
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError('unsupported');

  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== 0x02014b50) throw new ZipError('corrupt');
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const path = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    if (path.endsWith('/') || path.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(path)) continue;
    if (flags & 0x1) throw new ZipError('unsupported');
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new ZipError('corrupt');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = data.subarray(start, start + compSize);
    let body: Uint8Array;
    if (method === 0) body = raw.slice();
    else if (method === 8) body = await pipeThrough(raw, new DecompressionStream('deflate-raw'));
    else throw new ZipError('unsupported');
    out.push({ path, data: body });
  }
  return out;
}
