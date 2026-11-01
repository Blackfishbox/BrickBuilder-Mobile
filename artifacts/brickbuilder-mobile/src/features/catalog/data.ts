import { gunzipSync } from "fflate";

export interface CatalogData {
  schema: 1; version: string; attribution: string;
  sources: Record<string, { rows: number; sha256: string; url: string }>;
  parts: string[][]; colors: string[][]; part_mappings: string[][]; color_mappings: string[][];
}
export interface PartRecord { rb: string; name: string; bl: string[] }
export interface ColorRecord { rb: string; name: string; hex: string; transparent: boolean; ld: string[]; bl: { id: string; name: string }[] }
export interface CatalogIndex {
  parts: Record<string, PartRecord[]>; colors: Record<string, ColorRecord[]>; allColors: ColorRecord[];
  coverage: { parts: number; colors: number; partRows: number; colorRows: number;
    ldrawParts: number; confirmedParts: number; ambiguousParts: number; unknownParts: number;
    ldrawColors: number; confirmedColors: number; ambiguousColors: number; unknownColors: number };
}
const key = (id: string) => id.toLowerCase().replace(/\.dat$/i, "");
export function indexCatalog(data: CatalogData): CatalogIndex {
  if (data.schema !== 1) throw new Error("Unbekanntes Katalogformat.");
  for (const name of ["parts", "colors", "part_mappings", "color_mappings"] as const) {
    if (!Array.isArray(data[name]) || data[name].length !== data.sources[name]?.rows) throw new Error(`Unvollständiger Katalog: ${name}`);
    const width = { parts: 4, colors: 8, part_mappings: 5, color_mappings: 6 }[name];
    if (data[name].some(row => !Array.isArray(row) || row.length !== width || row.some(cell => typeof cell !== "string"))) throw new Error(`Ungültige Zeile: ${name}`);
  }
  const partNames = new Map(data.parts.map(row => [row[0], row[1]]));
  const colorNames = new Map(data.colors.map(row => [row[0], row]));
  const pRows = new Map<string, string[][]>(), cRows = new Map<string, string[][]>();
  for (const [rows, parents, target] of [[data.part_mappings, partNames, pRows], [data.color_mappings, colorNames, cRows]] as const) {
    for (const row of rows) {
      if (!parents.has(row[0]) || row.slice(-2).some(flag => !["True", "False"].includes(flag))) throw new Error("Ungültiger Katalogschlüssel oder Richtungswert.");
      const list = target.get(row[0]) ?? []; list.push(row); target.set(row[0], list);
    }
  }
  const parts: CatalogIndex["parts"] = Object.create(null), colors: CatalogIndex["colors"] = Object.create(null);
  for (const [rb, rows] of pRows) {
    const bl = [...new Set(rows.filter(r => r[1] === "BL" && r[3] === "True").map(r => r[2]))];
    for (const ld of new Set(rows.filter(r => r[1] === "LD" && r[4] === "True").map(r => key(r[2])))) {
      (parts[ld] ??= []).push({ rb, name: partNames.get(rb)!, bl });
    }
  }
  const allColors: ColorRecord[] = [];
  for (const [rb, row] of colorNames) {
    if (!/^[a-f0-9]{6}$/i.test(row[2]) || !["True", "False"].includes(row[3])) throw new Error("Ungültige Katalogfarbe.");
    const rows = cRows.get(rb) ?? [];
    const bl = rows.filter(r => r[1] === "BL" && r[4] === "True").map(r => {
      const names: unknown = JSON.parse(r[3]);
      return { id: r[2], name: Array.isArray(names) ? names.join(" / ") : String(names) };
    });
    const color: ColorRecord = { rb, name: row[1], hex: `#${row[2]}`, transparent: row[3] === "True",
      ld: [...new Set(rows.filter(r => r[1] === "LD" && r[5] === "True").map(r => r[2]))], bl };
    allColors.push(color);
    for (const ld of color.ld) (colors[ld] ??= []).push(color);
  }
  const counts = (items: { bl: (string | { id: string })[] }[][]) => {
    const statuses = items.map(records => new Set(records.flatMap(record => record.bl.map(v => typeof v === "string" ? v : v.id))).size);
    return [statuses.filter(n => n === 1).length, statuses.filter(n => n > 1).length, statuses.filter(n => !n).length];
  };
  const p = counts(Object.values(parts)), c = counts(Object.values(colors));
  return { parts, colors, allColors, coverage: {
    parts: data.parts.length, colors: data.colors.length, partRows: data.part_mappings.length, colorRows: data.color_mappings.length,
    ldrawParts: Object.keys(parts).length, confirmedParts: p[0], ambiguousParts: p[1], unknownParts: p[2],
    ldrawColors: Object.keys(colors).length, confirmedColors: c[0], ambiguousColors: c[1], unknownColors: c[2],
  } };
}
export function decodeCatalog(bytes: Uint8Array): CatalogData {
  // Bound decompression before JSON parsing; browser worker owns these allocations.
  if (bytes.length < 18) throw new Error("Katalogarchiv ist abgeschnitten.");
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(bytes.length - 4, true);
  if (length >= 32 * 1024 * 1024) throw new Error("Katalog ist zu groß.");
  const unpacked = gunzipSync(bytes);
  if (unpacked.length !== length) throw new Error("Unvollständiges Katalogarchiv.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(unpacked));
}
export function searchCatalog(data: CatalogData, query: string, kind: "parts" | "colors") {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const rows = data[kind];
  const external = kind === "parts" ? data.part_mappings : data.color_mappings;
  const matches = new Set(external.filter(row => terms.every(term => row[2].toLowerCase().includes(term))).map(row => row[0]));
  return rows.filter(row => matches.has(row[0]) || terms.every(term => `${row[0]} ${row[1]}`.toLowerCase().includes(term)))
    .slice(0, 60).map(row => ({ id: row[0], name: row[1], mappings: external.filter(mapping => mapping[0] === row[0]) }));
}
