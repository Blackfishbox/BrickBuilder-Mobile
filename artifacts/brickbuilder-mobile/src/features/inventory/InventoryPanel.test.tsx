// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import InventoryPanel from "./InventoryPanel";
import { createEmptyDocument, type BuilderDocument } from "../editor/model";
import { parseInventory } from "./import";
import { parseLDraw } from "../formats/ldraw/parser";
import type { Inventory } from "./types";

vi.mock("../catalog/client", () => ({
  resolveStoredInventory: async (inventory: Inventory) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: row.partId, name: `Part ${row.partId}` }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});
function fixture(count: number) {
  const document = createEmptyDocument("Inventory visibility");
  document.inventory = parseInventory("part_id,color_id,quantity\n" +
    Array.from({ length: count }, (_, i) => `${3000 + i},5,1`).join("\n"), "synthetic.csv");
  return document;
}
function consume(document: BuilderDocument, indexes: number[]) {
  const parsed = parseLDraw(indexes.map(() => "1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat").join("\n"));
  parsed.instances.forEach((instance, i) => {
    instance.allocation = { listId: document.inventory!.id, rowId: document.inventory!.rows[indexes[i]].id };
  });
  return { ...document, imported: {
    version: 1 as const, format: "ldr" as const, sourceName: "synthetic.ldr", originalBytes: [], sourceText: "",
    ...parsed, resources: {}, legalDocuments: [],
  } };
}
async function panel() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = window.document.createElement("div");
  root = createRoot(container);
  return {
    container,
    render: async (document: BuilderDocument) => {
      await act(async () => root!.render(<InventoryPanel document={document} selected={null}
        onSelect={async () => true} onReplace={() => {}} onSelected={() => {}} />));
    },
  };
}
it("filters exhausted rows before pagination and retains partially available rows", async () => {
  const document = fixture(33);
  document.inventory!.rows[30].quantity = 2;
  const view = await panel();
  await view.render(consume(document, Array.from({ length: 31 }, (_, i) => i)));
  expect(view.container.querySelectorAll(".inv-row")).toHaveLength(3);
  expect(view.container.querySelector(".inv-pager")).toBeNull();
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[30].id}"]`)?.textContent).toContain("Übrig 1");
  await view.render(consume(document, Array.from({ length: 29 }, (_, i) => i + 1)));
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[0].id}"]`)).not.toBeNull();
});
it("clamps the page when stock shrinks and does not jump back after a deleted part returns", async () => {
  const document = fixture(31);
  const view = await panel();
  await view.render(document);
  await act(async () => (view.container.querySelector('[data-testid="button-inventory-next"]') as HTMLButtonElement).click());
  expect(view.container.textContent).toContain("Seite 2 / 2");
  await view.render(consume(document, [30]));
  expect(view.container.querySelectorAll(".inv-row")).toHaveLength(30);
  expect(view.container.querySelector(".inv-pager")).toBeNull();
  await view.render(document);
  expect(view.container.textContent).toContain("Seite 1 / 2");
  await act(async () => (view.container.querySelector('[data-testid="button-inventory-next"]') as HTMLButtonElement).click());
  expect(view.container.querySelector(`[data-testid="row-inventory-${document.inventory!.rows[30].id}"]`)).not.toBeNull();
});
