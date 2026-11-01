import type { CatalogData } from "./data";
import type { Inventory, InventoryPreview } from "../inventory/types";

/** Reverse direction: BL import -> RB -> LD export, not the forward LD index. */
export function resolveInventory(data: CatalogData, inventory: Inventory): InventoryPreview {
  const names = new Map(data.parts.map(row => [row[0], row[1]]));
  const colorNames = new Map(data.colors.map(row => [row[0], row]));
  const partInputs = new Map<string, Set<string>>(), colorInputs = new Map<string, Set<string>>();
  const partOutputs = new Map<string, Set<string>>(), colorOutputs = new Map<string, Set<string>>();
  for (const [rows, inputs, outputs, offset] of [
    [data.part_mappings, partInputs, partOutputs, 3],
    [data.color_mappings, colorInputs, colorOutputs, 4],
  ] as const) {
    for (const row of rows) {
      if (row[1] === "BL" && row[offset + 1] === "True") {
        const rb = inputs.get(row[2]) ?? new Set<string>(); rb.add(row[0]); inputs.set(row[2], rb);
      }
      if (row[1] === "LD" && row[offset] === "True") {
        const ld = outputs.get(row[0]) ?? new Set<string>(); ld.add(row[2].replace(/\.dat$/i, "")); outputs.set(row[0], ld);
      }
    }
  }
  const resolutions: InventoryPreview["resolutions"] = {};
  for (const row of inventory.rows) {
    const parts = new Map<string, { ldrawId: string; name: string }>();
    const colors = new Map<string, { ldrawCode: string; name: string; hex: string }>();
    if (row.itemType === "P") {
      for (const rb of partInputs.get(row.partId) ?? []) {
        for (const ld of partOutputs.get(rb) ?? []) {
          if (/^[a-z0-9_/-]+$/i.test(ld) && !ld.split("/").includes("..")) parts.set(ld, { ldrawId: ld, name: names.get(rb)! });
        }
      }
      for (const rb of colorInputs.get(row.colorId) ?? []) {
        const color = colorNames.get(rb)!;
        for (const ld of colorOutputs.get(rb) ?? []) if (/^\d+$/.test(ld)) colors.set(ld, { ldrawCode: ld, name: color[1], hex: `#${color[2]}` });
      }
    }
    resolutions[row.id] = { parts: [...parts.values()].sort((a, b) => a.ldrawId.localeCompare(b.ldrawId)), colors: [...colors.values()].sort((a, b) => a.ldrawCode.localeCompare(b.ldrawCode)) };
  }
  return { inventory, resolutions };
}
