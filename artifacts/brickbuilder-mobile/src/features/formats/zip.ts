import { unzipSync, zipSync } from "fflate";

const MAX = 32 * 1024 * 1024;
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP32 only. Validate all entry bounds before allocating any decompressed data. */
export function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
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
  const entries = new Map<string, { size: number; crc: number }>();
  const normalizedNames = new Set<string>();
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error("Beschädigtes ZIP-Verzeichnis.");
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
    const packed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const length = view.getUint16(offset + 28, true), extra = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const next = offset + 46 + length + extra + comment;
    if (next > end || flags & ~0x080e || flags & 1 || ![0, 8].includes(method) ||
        size > 16 * 1024 * 1024 || (total += size) > MAX || local + 30 > start) throw new Error("ZIP-Eintrag zu groß, verschlüsselt oder nicht unterstützt.");
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
    entries.set(name, { size, crc: view.getUint32(offset + 16, true) });
    offset = next;
  }
  if (offset !== end) throw new Error("ZIP-Verzeichnislänge stimmt nicht.");
  const result = unzipSync(bytes);
  if (Object.keys(result).length !== entries.size) throw new Error("ZIP-Einträge stimmen nicht überein.");
  for (const [name, entry] of entries) {
    if (!result[name] || result[name].length !== entry.size || crc32(result[name]) !== entry.crc) throw new Error(`ZIP-Prüfsumme ungültig: ${name}`);
  }
  return result;
}

export function writeZip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 6 });
}
