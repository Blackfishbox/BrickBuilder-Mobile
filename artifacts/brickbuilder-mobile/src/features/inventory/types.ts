import { z } from "zod";

export const MAX_ROWS = 5000;
export const MAX_QUANTITY = 100000;
export const MAX_LIST_BYTES = 2 * 1024 * 1024;
const identifier = z.string().min(1).max(128);
export const allocationSchema = z.object({ listId: identifier, rowId: identifier }).strict();
export type Allocation = z.infer<typeof allocationSchema>;
export const inventoryRowSchema = z.object({
  id: identifier,
  partId: z.string().regex(/^[a-z0-9_-]{1,80}$/i),
  colorId: z.string().regex(/^\d{1,8}$/),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  itemType: z.string().min(1).max(16),
  sourceRows: z.array(z.number().int().min(1).max(MAX_ROWS)).min(1).max(MAX_ROWS),
  metadata: z.array(z.record(z.string().max(80), z.string().max(1024))).max(MAX_ROWS),
});
export const inventorySchema = z.object({
  version: z.literal(1), id: identifier, name: z.string().max(256),
  importedAt: z.string(), rows: z.array(inventoryRowSchema).min(1).max(MAX_ROWS),
});
export type InventoryRow = z.infer<typeof inventoryRowSchema>;
export type Inventory = z.infer<typeof inventorySchema>;
export interface InventoryResolution {
  parts: { ldrawId: string; name: string }[];
  colors: { ldrawCode: string; name: string; hex: string }[];
}
export interface InventoryPreview { inventory: Inventory; resolutions: Record<string, InventoryResolution> }
export interface InventoryChoice extends Allocation { ldrawId: string; colorCode: string }
