import type { LibraryPart, PartMappingEvidence, PartMappingResult } from "./types";

/**
 * Derived from explicit !KEYWORDS only. CC BY 4.0, independently of app code.
 * Original credits retained; extraction/selection by BrickBuilder.
 * The original files and full license are in the pinned import geometry package.
 */
export const MAPPING_SET = {
  id: "ldraw-explicit-bricklink",
  version: "2026-10-31.1",
  license: "CC-BY-4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
} as const;

type Row = [string, string, string, string, string, string, string];
const rows: Row[] = [
  ["3023a", "3023old", "Plate 1 x 2 with Flat Pin", "Flat Pin; nicht 3023b",
    "Rene Rechthaler [Blechtaler]", "0 !KEYWORDS Bricklink 3023old",
    "f49389ea0cffbc83346724fea5a1718a7e8a2c3d8d664736f8aab75233516659"],
  ["3023b", "3023", "Plate 1 x 2", "Standard; nicht Flat Pin (3023a)",
    "James Jessiman", "0 !KEYWORDS BrickLink 3023, Rebrickable 3023",
    "42f96ca69f8a0b83a877f4e128e4143ce753d038b1074835edc5aca9a9954fc9"],
  ["3069b", "3069", "Tile 1 x 2 with Groove", "Mit Rille; nicht 3069a ohne Rille",
    "Santeri Piippo [arezey]", "0 !KEYWORDS BrickLink 3069",
    "31203056de061c115b007f68a564bb2383761844b9373098df0c94cc4b18046a"],
  ["3070b", "3070", "Tile 1 x 1 with Groove", "Mit Rille; keine Übertragung auf andere Suffixe",
    "Chris Dee [cwdee]", "0 !KEYWORDS BrickLink 3070",
    "c7608c7e9f40c61747fb46c7107ef141b0a441e381768d2cdac0129f8ad03752"],
  ["4032a", "4032", "Plate 2 x 2 Round with Axlehole", "Axlehole; nur exakte LDraw-Variante 4032a",
    "James Jessiman", "0 !KEYWORDS BrickLink 4032",
    "ac5774e2a8eeb9811db795707f6c03cc0b834313b9b9ac5ba25dbb576c9851cb"],
  ["60897", "4085d", "Plate 1 x 1 with Clip Vertical (Thick C-Clip)", "Thick C-Clip; BrickLink-Variante d",
    "Owen Burgoyne [C3POwen]", "0 !KEYWORDS BrickLink 4085d",
    "5a55863184489f1ece294b75a5d51ccee2e2c8ebade1f269968ee1e768c41ebb"],
  ["6141", "4073", "Plate 1 x 1 Round", "Nur 6141; keine Ableitung weiterer Aliasnummern",
    "James Jessiman", "0 !KEYWORDS BrickLink 4073",
    "fb2cd4fad207392508bd2ca8b5469b1c351b692e111aa06b55da55d53fd44dd7"],
  ["73587p01", "4592c02", "Hinge Control Stick Base with Black Control Stick", "Baugruppe mit schwarzem Hebel; nicht Basis allein",
    "Magnus Forsberg [MagFors]", "0 !KEYWORDS antenna, BrickLink 4592c02, controls, finger, gear shift, lever",
    "1d6c56787238b8310648a5167a2ff8d68925076ec9159a38d572569c2c417d45"],
];

export const BRICKLINK_EVIDENCE: PartMappingEvidence[] = rows.map(
  ([ldrawId, brickLinkId, name, variant, author, sourceLine, sourceSha256]) => ({
    ldrawId, brickLinkId, name, variant, author, sourceLine, sourceSha256,
    sourceUrl: `https://library.ldraw.org/library/official/parts/${ldrawId}.dat`,
    license: MAPPING_SET.license, mappingSet: MAPPING_SET.id, version: MAPPING_SET.version,
  }),
);

export const MAPPING_LEGAL_DOCUMENT = {
  name: `${MAPPING_SET.id}-${MAPPING_SET.version}-CC-BY-4.0.txt`,
  sourceUrl: MAPPING_SET.licenseUrl,
  content: [
    `${MAPPING_SET.id} / ${MAPPING_SET.version}: CC BY 4.0`,
    MAPPING_SET.licenseUrl,
    "Derived selection from official LDraw !KEYWORDS. Extraction, whitespace-normalized names and variant notes by BrickBuilder. No endorsement by the original authors, LDraw or BrickLink.",
    ...BRICKLINK_EVIDENCE.map(e => `${e.ldrawId} → ${e.brickLinkId}: ${e.name}\n${e.author}\n${e.sourceUrl}\nSHA-256 ${e.sourceSha256}\n${e.sourceLine}`),
  ].join("\n\n"),
};

export function resolvePartMapping(reference: string, local: LibraryPart[] = []): PartMappingResult {
  // Case and file extension only: never strip suffixes, paths or print codes.
  const id = reference.toLowerCase().replace(/\.dat$/, "");
  const candidates = [...BRICKLINK_EVIDENCE, ...local.flatMap(p =>
    p.ldrawId.toLowerCase() === id ? p.mappings ?? [] : [])]
    .filter(e => e.ldrawId.toLowerCase() === id)
    .filter((e, index, all) => all.findIndex(other => JSON.stringify(other) === JSON.stringify(e)) === index);
  const ids = new Set(candidates.map(e => e.brickLinkId));
  return { status: ids.size === 0 ? "unknown" : ids.size === 1 ? "confirmed" : "ambiguous", candidates };
}
