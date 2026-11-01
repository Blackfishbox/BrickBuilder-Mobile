import { inflateSync, zipSync } from "fflate";
import { crc32, decryptStudioZipEntry } from "./zip-crypto";
export { crc32 } from "./zip-crypto";

const MAX = 32 * 1024 * 1024;
interface ZipReadOptions {
  /** Only these entries are decompressed; other payloads remain in the original archive. */
  names?: readonly string[];
  /** Opt-in for the public, fixed-key Studio ZIP format, never arbitrary passwords. */
  studioEncryption?: boolean;
}

/** ZIP32 only. Validate all entry bounds before allocating any decompressed data. */
export function readZip(bytes: Uint8Array, options: ZipReadOptions = {}): Record<string, Uint8Array> {
  if (bytes.length > MAX || bytes.length < 22) throw new Error("Ungültige ZIP-Größe (maximal 32 MiB).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error("ZIP-Endverzeichnis fehlt.");
  const count = view.getUint16(end + 10, true);
  const start = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) ||
      count !== view.getUint16(end + 8, true) || count > 128 || !count ||
      start + view.getUint32(end + 12, true) !== end) throw new Error("ZIP64, mehrteilige oder zu große Archive werden nicht unterstützt.");
  let offset = start, total = 0;
  const requested = options.names && new Set(options.names.map(name => name.toLowerCase()));
  const entries = new Map<string, { size: number; crc: number; data: number; packed: number; method: number; encrypted: boolean; checkByte: number }>();
  const normalizedNames = new Set<string>();
  const ranges: { start: number; end: number }[] = [];
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Beschädigtes ZIP-Verzeichnis.");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const packed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + length + extra + comment;
    if (next > end || flags & ~0x080f || ((flags & 1) && !options.studioEncryption) || ![0, 8].includes(method) ||
        size > MAX || (total += size) > MAX || local + 30 > start) throw new Error("ZIP-Eintrag zu groß, verschlüsselt oder nicht unterstützt.");
    const nameBytes = bytes.subarray(offset + 46, offset + 46 + length);
    if (!(flags & 0x800) && nameBytes.some(b => b > 127)) throw new Error("ZIP-Dateinamen müssen ASCII oder UTF-8 verwenden.");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    const key = name.toLowerCase();
    if (!name || name.includes("\\") || name.includes("\0") || name.startsWith("/") || name.includes(":") ||
        name.split("/").some(p => p === ".." || p === ".") || normalizedNames.has(key)) throw new Error("Unsicherer oder doppelter ZIP-Pfad.");
    normalizedNames.add(key);
    if (view.getUint32(local, true) !== 0x04034b50 ||
        view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method) throw new Error("ZIP-Kopf stimmt nicht überein.");
    const localLen = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true);
    const data = local + 30 + localLen + localExtra;
    if (data + packed > start || new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + localLen)) !== name) throw new Error("Ungültige ZIP-Datengrenzen.");
    if ((flags & 1) && packed < 12) throw new Error("Verschlüsselter ZIP-Kopf fehlt.");
    ranges.push({ start: local, end: data + packed });
    if (!requested || requested.has(key)) {
      if (size > 16 * 1024 * 1024) throw new Error("ZIP-Eintrag zu groß (maximal 16 MiB je gelesenem Eintrag).");
      const crc = view.getUint32(offset + 16, true);
      entries.set(name, {
        size, crc, data, packed, method, encrypted: Boolean(flags & 1),
        checkByte: flags & 8 ? view.getUint16(offset + 12, true) >>> 8 : crc >>> 24,
      });
    }
    offset = next;
  }
  if (offset !== end) throw new Error("ZIP-Verzeichnislänge stimmt nicht.");
  ranges.sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index].start < ranges[index - 1].end) throw new Error("Überlappende ZIP-Einträge.");
  }
  const result: Record<string, Uint8Array> = Object.create(null);
  for (const [name, entry] of entries) {
    const payload = bytes.subarray(entry.data, entry.data + entry.packed);
    const compressed = entry.encrypted ? decryptStudioZipEntry(payload, entry.checkByte) : payload;
    // Fixed output allocation plus one overflow byte: never allocate from an
    // unchecked DEFLATE stream or decompress unselected Studio resources.
    const decoded = entry.method === 0 ? compressed.slice() : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) });
    if (decoded.length !== entry.size || crc32(decoded) !== entry.crc) throw new Error(`ZIP-Prüfsumme oder Größe ungültig: ${name}`);
    result[name] = decoded;
  }
  return result;
}

export function writeZip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6 });
}
