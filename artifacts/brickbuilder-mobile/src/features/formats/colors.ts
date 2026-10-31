import type { ResolvedColor } from "./types";

// Explicit reviewed subset; numbers from the two namespaces must never be equated.
// LDraw values: official LDConfig.ldr; BL names/IDs: BrickLink color guide.
const provenance = "LDraw LDConfig.ldr (https://library.ldraw.org/library/official/LDConfig.ldr); BrickLink color guide (https://www.bricklink.com/catalogColors.asp), reviewed 2026-10-31";
const rows: [string, string, string, number, number, string][] = [
  ["0", "Black", "#1B2A34", 255, 11, "Black"],
  ["1", "Blue", "#1E5AA8", 255, 7, "Blue"],
  ["4", "Red", "#B40000", 255, 5, "Red"],
  ["15", "White", "#F4F4F4", 255, 1, "White"],
  ["19", "Tan", "#D7BA8C", 255, 2, "Tan"],
  ["47", "Trans_Clear", "#FCFCFC", 128, 12, "Trans-Clear"],
  ["72", "Dark_Bluish_Grey", "#646464", 255, 85, "Dark Bluish Gray"],
  ["179", "Pearl_Silver", "#898788", 255, 95, "Flat Silver"],
];
export const COLORS: ResolvedColor[] = rows.map(([ldrawCode, name, hex, alpha, brickLinkId, brickLinkName]) => ({
  ldrawCode, name, hex, alpha, brickLinkId, brickLinkName, source: provenance,
}));
export function resolveColor(code: string): ResolvedColor | undefined {
  const mapped = COLORS.find(c => c.ldrawCode === code);
  if (mapped) return { ...mapped };
  if (/^0x2[0-9a-f]{6}$/i.test(code)) return { ldrawCode: code, name: "LDraw Direct Color", hex: "#" + code.slice(3), alpha: 255, source: "LDraw direct colour syntax; no BrickLink mapping" };
  return undefined;
}
