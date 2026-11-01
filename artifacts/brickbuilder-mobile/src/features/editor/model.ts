import type { ImportedModel } from "../formats/types";
import { refreshedCatalogModel } from "../catalog/refresh-model";
import type { Inventory } from "../inventory/types";
import { validateInventory } from "../inventory/accounting";

export type BrickType = "brick-2x4" | "brick-2x2" | "brick-1x2";
export type ToolMode = "build" | "select" | "delete";

export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export interface Brick {
  id: string;
  type: BrickType;
  color: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export interface BuilderDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  bricks: Brick[];
  metadata: Record<string, unknown>;
  imported?: ImportedModel;
  inventory?: Inventory;
}

export interface BrickDefinition {
  label: string;
  studsX: number;
  studsZ: number;
  ldrawId: string;
  brickLinkId?: string;
}

export interface PaletteColor {
  name: string;
  value: string;
}

export const BRICK_HEIGHT = 1.2;
export const GRID_STEP = 0.5;

export const BRICK_DEFINITIONS: Record<BrickType, BrickDefinition> = {
  "brick-2x4": { label: "Klassischer Stein", studsX: 2, studsZ: 4, ldrawId: "3001" },
  "brick-2x2": { label: "Quadratischer Stein", studsX: 2, studsZ: 2, ldrawId: "3003" },
  "brick-1x2": { label: "Schmaler Stein", studsX: 1, studsZ: 2, ldrawId: "3004" },
};

export const BRICK_PALETTE: PaletteColor[] = [
  { name: "Ziegelrot", value: "#d75b3f" },
  { name: "Sonnengelb", value: "#e4b844" },
  { name: "Moosgrün", value: "#668b6e" },
  { name: "Ozeanblau", value: "#597e91" },
  { name: "Kreide", value: "#e9e2d2" },
  { name: "Graphit", value: "#434b48" },
  { name: "Rosé", value: "#c9867e" },
  { name: "Flieder", value: "#9389a6" },
];

export function createEmptyDocument(name = "Neues Modell"): BuilderDocument {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    bricks: [],
    metadata: {},
  };
}

export function snapPosition(position: Position3): Position3 {
  return {
    x: Math.round(position.x / GRID_STEP) * GRID_STEP,
    y: Math.max(0, Math.round(position.y / BRICK_HEIGHT) * BRICK_HEIGHT),
    z: Math.round(position.z / GRID_STEP) * GRID_STEP,
  };
}

export function rotateQuarterTurn(rotation: number): number {
  return ((Math.round(rotation / 90) * 90 + 90) % 360 + 360) % 360;
}

export function normalizeDocument(
  document: Partial<BuilderDocument> & Pick<BuilderDocument, "id" | "name">,
): BuilderDocument {
  const now = new Date().toISOString();
  validateInventory(document as BuilderDocument);
  if (document.imported) document = { ...document, imported: refreshedCatalogModel(document.imported) };
  return {
    schemaVersion: 1,
    id: document.id,
    name: document.name,
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now,
    bricks: Array.isArray(document.bricks) ? document.bricks : [],
    metadata:
      typeof document.metadata === "object" && document.metadata !== null
        ? document.metadata
        : {},
    ...(document.imported ? { imported: document.imported } : {}),
    ...(document.inventory ? { inventory: document.inventory } : {}),
  };
}
