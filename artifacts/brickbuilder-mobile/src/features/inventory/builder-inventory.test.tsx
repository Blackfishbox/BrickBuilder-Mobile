// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuilder } from "../editor/useBuilder";
import { createEmptyDocument } from "../editor/model";
import { parseInventory } from "./import";
import { allocatedCounts } from "./accounting";
import { parseLDraw } from "../formats/ldraw/parser";
import { prepareLibraryPart, type PreparedPart } from "../editor/ldraw-editing";
import { builderDatabase } from "@/storage/database";
import InventoryPanel from "./InventoryPanel";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }),
  ensureCatalog: async () => {},
  resolveStoredInventory: async (inventory: ReturnType<typeof parseInventory>) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: "test", name: "Synthetic test part" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
vi.mock("../editor/ldraw-editing", async importOriginal => ({
  ...await importOriginal<typeof import("../editor/ldraw-editing")>(),
  prepareLibraryPart: vi.fn(),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  await builderDatabase.delete();
  vi.unstubAllGlobals(); vi.clearAllMocks();
});

it("handles failed/cancelled loading, fast taps, stale source colors, catalog exit and project switching", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() {
    editor = useBuilder();
    return <InventoryPanel document={editor.document} selected={editor.selectedInventory}
      onSelect={editor.selectInventoryPart} onReplace={editor.replacePartsInventory} onSelected={() => {}} />;
  }
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => { root!.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  const inventory = parseInventory("part_id,color_id,quantity\n3001,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  const choice = { listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "test", colorCode: "4" };
  const visibleRow = () => container.querySelector(`[data-testid="row-inventory-${choice.rowId}"]`);
  expect(visibleRow()).not.toBeNull();
  const part = { id: "test", packageId: "test", ldrawId: "test", name: "Synthetic", category: "", keywords: [], file: "parts/test.dat" };
  const prepared: PreparedPart = { part, bottom: -1, model: {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", sourceText: "0 Synthetic", originalBytes: [],
    ...parseLDraw("1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat"),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic", sourceUrl: "https://example.invalid",
      license: "CC0-1.0", content: "0 Synthetic triangle\n3 16 0 0 0 20 0 0 0 20 0" } }, legalDocuments: [],
  } };
  prepared.model.instances[0].part.status = "resolved";
  vi.mocked(prepareLibraryPart).mockRejectedValueOnce(new Error("Geometry failed"));
  await act(async () => { expect(await editor.selectInventoryPart(choice)).toBe(false); });
  expect(editor.partError).toBe("Geometry failed");
  expect(allocatedCounts(editor.document).size).toBe(0);

  let finish!: (value: PreparedPart) => void;
  vi.mocked(prepareLibraryPart).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let loading!: Promise<boolean>;
  await act(async () => { loading = editor.selectInventoryPart(choice); await Promise.resolve(); });
  await act(async () => { editor.cancelPartPreparation(); finish(prepared); expect(await loading).toBe(false); });
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(editor.selectedInventory).toBeNull();

  vi.mocked(prepareLibraryPart).mockResolvedValue(prepared);
  await act(async () => { expect(await editor.selectInventoryPart(choice)).toBe(true); });
  await act(async () => editor.setSelectedColor("#1E5AA8", "1"));
  await act(async () => { for (let i = 0; i < 10; i++) editor.place({ x: i, y: 0, z: 0 }); });
  expect(editor.brickCount).toBe(1);
  expect(editor.imported!.instances[0].colorCode).toBe("4");
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  expect(container.textContent).toContain("Alle Teile dieser Liste sind verbaut");
  expect(editor.partError).toContain("aufgebraucht");
  await act(async () => editor.setSelectedColor("#1E5AA8", "1"));
  expect(editor.imported!.instances[0].colorCode).toBe("1");
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  await act(async () => editor.deleteSelected());
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(visibleRow()).not.toBeNull();
  await act(async () => editor.undo());
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  await act(async () => editor.redo());
  expect(allocatedCounts(editor.document).size).toBe(0);
  expect(visibleRow()).not.toBeNull();
  await act(async () => editor.undo());
  await act(async () => { expect(await editor.selectLibraryPart(part)).toBe(true); });
  expect(editor.selectedInventory).toBeNull();
  await act(async () => editor.place({ x: 4, y: 0, z: 0 }));
  expect(editor.brickCount).toBe(2);
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(editor.imported!.instances[1].allocation).toBeUndefined();
  expect(visibleRow()).toBeNull();
  await act(async () => editor.deleteSelected());
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(visibleRow()).toBeNull();
  await act(async () => editor.undo());

  const firstId = editor.document.id;
  const staleChoice = { ...choice };
  await act(async () => editor.importProject(createEmptyDocument("Other project")));
  expect(editor.selectedInventory).toBeNull();
  await act(async () => { expect(await editor.selectInventoryPart(staleChoice)).toBe(false); });
  expect(editor.brickCount).toBe(0);
  await act(async () => { await editor.openProject(firstId); });
  expect(editor.brickCount).toBe(2);
  expect(editor.document.inventory).toEqual(inventory);
  expect(allocatedCounts(editor.document).get(choice.rowId)).toBe(1);
  expect(() => editor.replacePartsInventory(inventory, "old-project")).toThrow("gewechselt");
});
