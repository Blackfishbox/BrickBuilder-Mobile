import type { BuilderDocument } from "../editor/model";
import { inventorySchema, allocationSchema, type Allocation, type Inventory } from "./types";

/** Stock is always derived from effective instances, including undo/redo snapshots. */
export function allocatedCounts(document: BuilderDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const instance of document.imported?.instances ?? []) {
    const allocation = instance.allocation;
    if (allocation && allocation.listId === document.inventory?.id) counts.set(allocation.rowId, (counts.get(allocation.rowId) ?? 0) + 1);
  }
  return counts;
}
export function requireAvailable(document: BuilderDocument, allocation: Allocation) {
  const row = document.inventory?.id === allocation.listId ? document.inventory.rows.find(r => r.id === allocation.rowId) : undefined;
  if (!row || row.itemType !== "P") throw new Error("Diese Teilelisten-Auswahl ist nicht mehr gültig. Bitte neu auswählen.");
  if ((allocatedCounts(document).get(row.id) ?? 0) >= row.quantity) throw new Error(`BrickLink ${row.partId}, Farbe ${row.colorId}: Bestand aufgebraucht.`);
  return row;
}
export function replaceInventory(document: BuilderDocument, inventory: Inventory): BuilderDocument {
  const checked = inventorySchema.parse(inventory);
  if ((document.imported?.instances ?? []).some(i => i.allocation)) throw new Error("Liste kann erst ersetzt werden, wenn alle daraus verbauten Teile entfernt wurden. Alternativ ein neues Projekt beginnen.");
  const next = { ...document, inventory: checked, updatedAt: new Date().toISOString() };
  validateInventory(next);
  return next;
}
export function validateInventory(document: BuilderDocument): void {
  if (document.inventory) {
    inventorySchema.parse(document.inventory);
    if (new Set(document.inventory.rows.map(r => r.id)).size !== document.inventory.rows.length) throw new Error("Doppelte Teilelisten-Zeilen.");
  }
  const instances = document.imported?.instances ?? [];
  if (new Set(instances.map(i => i.id)).size !== instances.length) throw new Error("Doppelte Instanz-IDs.");
  const rows = new Map(document.inventory?.rows.map(row => [row.id, row]));
  const counts = new Map<string, number>();
  for (const instance of instances) {
    if (instance.allocation === undefined) continue;
    const allocation = allocationSchema.parse(instance.allocation);
    const row = rows.get(allocation.rowId);
    if (!row || row.itemType !== "P" || allocation.listId !== document.inventory?.id) throw new Error("Verwaiste Teilelisten-Zuordnung.");
    const count = (counts.get(row.id) ?? 0) + 1;
    if (count > row.quantity) throw new Error("Teilelisten-Menge überschritten.");
    counts.set(row.id, count);
  }
}
