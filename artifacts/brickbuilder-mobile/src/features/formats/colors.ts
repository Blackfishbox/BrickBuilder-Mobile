import type { ResolvedColor } from "./types";
import { LDRAW_COLOR_ROWS, LDRAW_COLOR_SNAPSHOT } from "./ldraw-palette";

// Explicit reviewed subset; numbers from the two namespaces must never be equated.
// LDraw values: official LDConfig.ldr; BL names/IDs: BrickLink color guide.
const provenance = "LDraw LDConfig.ldr (https://library.ldraw.org/library/official/LDConfig.ldr); BrickLink color guide (https://www.bricklink.com/catalogColors.asp), reviewed 2026-11-01";
const rows: [string, string, string, number, number, string][] = [
  ["0", "Black", "#1B2A34", 255, 11, "Black"],
  ["1", "Blue", "#1E5AA8", 255, 7, "Blue"],
  ["4", "Red", "#B40000", 255, 5, "Red"],
  ["15", "White", "#F4F4F4", 255, 1, "White"],
  ["19", "Tan", "#D7BA8C", 255, 2, "Tan"],
  ["47", "Trans_Clear", "#FCFCFC", 128, 12, "Trans-Clear"],
  ["72", "Dark_Bluish_Grey", "#646464", 255, 85, "Dark Bluish Gray"],
  ["179", "Pearl_Silver", "#898788", 255, 95, "Flat Silver"],
  ["288", "Dark_Green", "#00451A", 255, 80, "Dark Green"],
  ["297", "Pearl_Gold", "#AA7F2E", 255, 115, "Pearl Gold"],
  ["8", "Dark_Grey", "#545955", 255, 10, "Dark Gray"],
];
// Catalog mappings remain an explicitly reviewed subset. A known LDraw
// appearance is not evidence of a BrickLink ID, even when the numbers coincide.
export const COLORS: ResolvedColor[] = LDRAW_COLOR_ROWS.map(([code, name, hex, alpha]) => {
  const ldrawCode = String(code);
  const mapping = rows.find(row => row[0] === ldrawCode);
  return {
    ldrawCode, name, hex, alpha,
    ...(mapping ? { brickLinkId: mapping[4], brickLinkName: mapping[5] } : {}),
    source: `${LDRAW_COLOR_SNAPSHOT.sourceUrl}; update ${LDRAW_COLOR_SNAPSHOT.sourceUpdate}; SHA-256 ${LDRAW_COLOR_SNAPSHOT.sourceSha256}${mapping ? `; ${provenance}` : ""}`,
  };
});
const byCode = new Map(COLORS.map(color => [color.ldrawCode, color]));
export function resolveColor(code: string): ResolvedColor | undefined {
  const mapped = byCode.get(code);
  if (mapped) return { ...mapped };
  if (/^0x2[0-9a-f]{6}$/i.test(code)) return { ldrawCode: code, name: "LDraw Direct Color", hex: "#" + code.slice(3), alpha: 255, source: "LDraw direct colour syntax; no BrickLink mapping" };
  return undefined;
}
