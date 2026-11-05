// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuilder } from "./useBuilder";
import { createEmptyDocument } from "./model";
import { prepareLibraryPart, type PreparedPart } from "./ldraw-editing";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { parseInventory } from "../inventory/import";
import { allocatedCounts } from "../inventory/accounting";
import { builderDatabase, loadProject } from "@/storage/database";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  ensureCatalog: async () => {},
  resolveStoredInventory: async (inventory: ReturnType<typeof parseInventory>) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: "3022", name: "Plate 2 x 2" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
vi.mock("./ldraw-editing", async original => ({
  ...await original<typeof import("./ldraw-editing")>(), prepareLibraryPart: vi.fn(),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; await builderDatabase.delete(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("commits inventory snapping once and preserves exact height through manual edits, undo and local save", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const resources = Object.fromEntries(["bricks", "plates"].flatMap(group =>
    JSON.parse(readFileSync(resolve(`public/parts/ldraw-${group}-2026-10-31.json`), "utf8")).files,
  ).map(file => [file.path, file])) as ImportedModel["resources"];
  function model(sourceText: string): ImportedModel {
    const imported: ImportedModel = { version: 1, format: "ldr", sourceName: "fixture.ldr", sourceText,
      originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText), resources, legalDocuments: [] };
    imported.instances.forEach(instance => { instance.part.status = "resolved"; });
    return imported;
  }
  const base = model("1 4 4.6 -24 3.4 1 0 0 0 1 0 0 0 1 3001.dat");
  await act(async () => { await editor.importProject({ ...createEmptyDocument(), imported: base }); });
  const inventory = parseInventory("part_id,color_id,quantity\n3022,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const prepared: PreparedPart = { bottom: -0.4, part: {
    id: "plate", packageId: "test", ldrawId: "3022", name: "Plate 2 x 2", category: "", keywords: [], file: "parts/3022.dat",
  }, model: model("1 4 0 0 0 1 0 0 0 1 0 0 0 1 3022.dat") };
  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);
  await act(async () => { await editor.selectInventoryPart({ listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "3022", colorCode: "4" }); });
  await act(async () => editor.place({ x: 0.28, y: 1.4, z: 0.2 }));
  const placed = editor.imported!.instances[1], id = placed.id;
  expect(placed.matrix[3]).toBeCloseTo(4.6);
  expect(placed.matrix[7]).toBeCloseTo(-32);
  expect(placed.matrix[11]).toBeCloseTo(3.4);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id)).toBe(1);
  await act(async () => editor.undo());
  expect(editor.imported!.instances).toHaveLength(1);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id) ?? 0).toBe(0);
  await act(async () => editor.redo());
  expect(editor.imported!.instances[1]).toEqual(placed);
  await act(async () => editor.select(id));
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.imported!.instances[1].matrix[7]).toBeCloseTo(-24);
  expect(editor.imported!.instances[1].matrix[3]).toBeCloseTo(4.6);
  await act(async () => editor.undo());
  await act(async () => editor.place({ x: 0.28, y: 1.4, z: 0.2 }));
  expect(editor.imported!.instances).toHaveLength(2);
  expect(editor.partError).toBeTruthy();
  await act(async () => { await editor.save(); });
  const stored = await loadProject(editor.document.id);
  expect(stored!.imported!.instances.find(instance => instance.id === id)).toEqual(placed);
  expect(editor.imported!.instances[0]).toMatchObject({
    id: base.instances[0].id, reference: base.instances[0].reference,
    matrix: base.instances[0].matrix, colorCode: base.instances[0].colorCode,
  });
  expect(editor.imported!.sourceText).toBe(base.sourceText);
  expect(editor.imported!.originalBytes).toEqual(base.originalBytes);
  for (let i = 0; i < 10; i++) await act(async () => editor.changeHeight(-0.4));
  expect(editor.imported!.instances.find(instance => instance.id === id)!.matrix[7]).toBeCloseTo(-8);
  const floorDocument = editor.document;
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document).toBe(floorDocument);
  await act(async () => editor.nudgeSelected({ x: 0.05, y: 0.05, z: -0.05 }));
  const fine = editor.imported!.instances.find(instance => instance.id === id)!;
  expect(fine.matrix[3]).toBeCloseTo(5.6);
  expect(fine.matrix[7]).toBeCloseTo(-9);
  expect(fine.matrix[11]).toBeCloseTo(2.4);
  expect(allocatedCounts(editor.document).get(inventory.rows[0].id)).toBe(1);
  await act(async () => editor.undo());
  expect(editor.document).toBe(floorDocument);
  await act(async () => editor.redo());
  await act(async () => { await editor.save(); });
  expect((await loadProject(editor.document.id))!.imported!.instances.find(instance => instance.id === id)).toEqual(fine);
});

it("clamps legacy saved bricks and allows fine steps without grid rounding", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const legacyDocument = createEmptyDocument();
  legacyDocument.bricks = [{ id: "legacy", type: "brick-1x2", color: "#B40000", x: 0, y: 0, z: 0, rotation: 0 }];
  await act(async () => editor.importProject(legacyDocument));
  await act(async () => editor.select("legacy"));
  const before = editor.document;
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document).toBe(before);
  await act(async () => editor.nudgeSelected({ x: 0.05, y: 0.05, z: -0.05 }));
  expect(editor.document.bricks[0]).toMatchObject({ x: 0.05, y: 0.05, z: -0.05 });
  await act(async () => editor.changeHeight(-0.4));
  expect(editor.document.bricks[0].y).toBe(0);
});
