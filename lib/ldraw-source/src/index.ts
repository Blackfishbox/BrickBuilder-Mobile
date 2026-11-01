/** Fixed public source identity. Catalog IDs are deliberately not part of this contract. */
export const OFFICIAL = "https://library.ldraw.org/library/official/";
export const LEGAL_PATHS = ["CAreadme.txt", "CAlicense4.txt", "CC0-1.0.txt"] as const;
export const sourceUrl = (path: string) => path === "CC0-1.0.txt"
  ? "https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt" : `${OFFICIAL}${path}`;
export function normalizeReference(input: string): string {
  const ref = input.trim().replaceAll("\\", "/").toLowerCase();
  if (ref.length > 170 || !/^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.dat$/.test(ref)) {
    throw new Error("Ungültige LDraw-Referenz.");
  }
  return ref;
}
export function normalizePath(input: string): string {
  if ((LEGAL_PATHS as readonly string[]).includes(input)) return input;
  const path = normalizeReference(input);
  if (!/^(parts|p)\//.test(path)) throw new Error("Nicht freigegebener LDraw-Pfad.");
  return path;
}
export function candidates(reference: string): string[] {
  const ref = normalizeReference(reference);
  return /^(parts|p)\//.test(ref) ? [ref] : [`parts/${ref}`, `p/${ref}`];
}
export interface SourceFile {
  path: string;
  sourceUrl: string;
  author: string;
  license: "CC-BY-4.0" | "CC0-1.0";
  content: string;
}
/** Validate original headers and every executable geometry line before accepting a file. */
export function inspectFile(path: string, bytes: Uint8Array): SourceFile {
  normalizePath(path);
  if (bytes.length > 2 * 1024 * 1024 || !bytes.length) throw new Error("LDraw-Dateigröße ungültig.");
  const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (content.includes("\0")) throw new Error("Ungültiger Dateiinhalt.");
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  const license = lines.includes("0 !LICENSE Licensed under CC0 : see CAreadme.txt") ? "CC0-1.0" :
    lines.some(line => line === "0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt" ||
      line === "0 !LICENSE Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt") ? "CC-BY-4.0" : undefined;
  const author = lines.find(line => /^0 Author: .+/.test(line))?.slice(10).trim();
  if (!license || !author) throw new Error("Lizenz oder Originalcredits nicht freigegeben.");
  for (const line of lines) {
    if (!line.trim()) continue;
    const tokens = line.trim().split(/\s+/);
    const type = Number(tokens[0]);
    if (!/^[0-5]$/.test(tokens[0])) throw new Error("Ungültiger LDraw-Zeilentyp.");
    if (type === 0) continue;
    if (!/^(?:\d+|0x2[0-9a-f]{6})$/i.test(tokens[1])) throw new Error("Ungültige Geometriefarbe.");
    const count = type === 1 ? 12 : type === 2 ? 6 : type === 3 ? 9 : 12;
    const values = tokens.slice(2, 2 + count);
    if (values.length !== count || values.some(v => !Number.isFinite(Number(v)) || Math.abs(Number(v)) > 1e7) ||
        (type !== 1 && tokens.length !== count + 2)) throw new Error("Ungültige Geometriezeile.");
    if (type === 1) normalizeReference(tokens.slice(14).join(" "));
  }
  return { path, content, sourceUrl: `${OFFICIAL}${path}`, author, license };
}
export function dependencies(content: string): string[] {
  return [...new Set(content.replace(/^\uFEFF/, "").split(/\r?\n/)
    .filter(line => /^\s*1\s/.test(line))
    .map(line => normalizeReference(line.trim().split(/\s+/).slice(14).join(" "))))];
}
