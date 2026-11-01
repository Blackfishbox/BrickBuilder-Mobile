// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBuilder } from "./useBuilder";
import { builderDatabase, loadProject } from "@/storage/database";
import { activeConnections, constructionTransform } from "../connections/engine";
import { prepareLibraryPart, placePreparedPart, moveImported } from "./ldraw-editing";
import { createEmptyDocument } from "./model";
import type { LibraryFile } from "../parts/types";
import { gunzipSync } from "fflate";
import { hashBytes } from "../formats/online-geometry";
import { parseInventory } from "../inventory/import";
import type { LibraryPart } from "../parts/types";

vi.mock("../catalog/client", () => ({
  useCatalog: () => ({ status: "ready" }), ensureCatalog: async () => {},
  getCatalogState: () => ({ status: "idle" }),
  resolveStoredInventory: async (inventory: ReturnType<typeof parseInventory>) => ({
    inventory, resolutions: Object.fromEntries(inventory.rows.map(row => [row.id, {
      parts: [{ ldrawId: "3023b", name: "Plate 1 x 2" }],
      colors: [{ ldrawCode: "4", name: "Red", hex: "#B40000" }],
    }])),
  }),
}));
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined; await builderDatabase.delete(); vi.unstubAllGlobals();
});
const part = (id: string): LibraryPart => ({
  id: `catalog:${id}`, packageId: "catalog", ldrawId: id, name: id, category: "", keywords: [], file: `parts/${id}.dat`,
});
it("prepares actual catalog geometry and commits catalog/inventory plates through the live editor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Worker", class { addEventListener() {} postMessage() {} terminate() {} });
  await builderDatabase.open();
  const bytes = readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin"));
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!url.endsWith("import-geometry-2026-10-31.bin")) throw new Error(`Unexpected request: ${url}`);
    return new Response(bytes);
  }));
  let editor!: ReturnType<typeof useBuilder>;
  function Harness() { editor = useBuilder(); return null; }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(<Harness />));
  await act(async () => { await vi.waitFor(() => expect(editor.isReady).toBe(true)); });
  await act(async () => editor.selectLibraryPart(part("3795")));
  expect(editor.partError).toBeNull();
  await act(async () => editor.place({ x: 0, y: 0, z: 0 }));
  expect(editor.imported!.instances[0].matrix[7]).toBe(-8);
  await act(async () => editor.selectLibraryPart(part("3023b")));
  expect(editor.partError).toBeNull();
  await act(async () => editor.place({ x: 0.03, y: 0.6, z: 0.52 }));
  const placed = editor.imported!.instances[1];
  expect(placed.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
  expect(activeConnections(editor.imported!, placed.id)).toHaveLength(2);
  await act(async () => editor.undo());
  expect(editor.imported!.instances).toHaveLength(1);
  await act(async () => editor.redo());
  expect(editor.imported!.instances[1]).toEqual(placed);
  const inventory = parseInventory("part_id,color_id,quantity\n3023,5,1", "self-authored.csv");
  await act(async () => editor.replacePartsInventory(inventory, editor.document.id));
  await act(async () => editor.selectInventoryPart({ listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "3023b", colorCode: "4" }));
  expect(editor.partError).toBeNull();
  await act(async () => editor.place({ x: 0.03, y: 0.6, z: -0.52 }));
  expect(editor.imported!.instances).toHaveLength(3);
  const allocated = editor.imported!.instances[2];
  expect(allocated.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, -10]);
  await act(async () => editor.place({ x: 2, y: 0.6, z: -0.5 }));
  expect(editor.imported!.instances).toHaveLength(3);
  expect(editor.partError).toBeTruthy();
  await act(async () => editor.save());
  const stored = await loadProject(editor.document.id);
  expect(stored!.imported!.instances).toEqual(editor.imported!.instances);
  expect(stored!.imported!.resources).toEqual(editor.imported!.resources);
});

it.each(["installed package", "flattened legacy package", "verified retrieval cache"])(
  "prepares the reference through real local resolution from %s without replacing sources",
  async mode => {
    await builderDatabase.open();
    const payload = JSON.parse(readFileSync(resolve("public/parts/ldraw-plates-2026-10-31.json"), "utf8"));
    const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")))));
    let files: LibraryFile[] = payload.files;
    if (mode === "flattened legacy package") {
      const byPath = Object.fromEntries(files.map(f => [f.path, f]));
      const content = byPath["parts/3023b.dat"].content
        .replace(/^1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\3023bs01.dat$/m, byPath["parts/s/3023bs01.dat"].content)
        .replace(/^1 16 0 0 0 1 0 0 0 1 0 0 0 1 stug-1x2.dat$/m, byPath["p/stug-1x2.dat"].content);
      files = files.map(f => f.path === "parts/3023.dat" ? { ...f, content } : f);
    }
    if (mode === "verified retrieval cache") {
      const verified = await Promise.all(files.map(async f => {
        const bytes = new TextEncoder().encode(f.content);
        return { ...f, sha256: await hashBytes(bytes), byteLength: bytes.length };
      }));
      await builderDatabase.geometrySnapshots.put({ version: 1, id: "self-authored-cache", createdAt: new Date().toISOString(),
        roots: ["3023.dat"], graph: {}, files: verified, legalDocuments: payload.legalDocuments });
    } else {
      await builderDatabase.libraryFiles.bulkPut(files.map(f => ({ ...f, packageId: payload.id, id: `${payload.id}:${f.path}` })));
      await builderDatabase.libraryParts.bulkPut(payload.parts);
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")))));
    const prepared = await prepareLibraryPart(part("3023"));
    const originalSource = prepared.model.resources["parts/3023.dat"].content;
    expect(originalSource).toBe(files.find(f => f.path === "parts/3023.dat")!.content);
    const support = await prepareLibraryPart(part("3795"));
    let document = placePreparedPart(createEmptyDocument(), support, { x: 0, y: 0, z: 0 }, "#B40000", "4");
    document = placePreparedPart(document, prepared, { x: 0.03, y: 0.6, z: 0.52 }, "#B40000", "4");
    const instance = document.imported!.instances[1];
    const snapped = constructionTransform(document.imported!, instance.id, { x: 0.03, y: -instance.matrix[7] / 20, z: 0.52 });
    expect(snapped.contacts).toHaveLength(2);
    document = moveImported(document, instance.id, { x: 0, y: 0.8, z: 0.5 }, false, snapped.matrix);
    expect(document.imported!.instances[1].matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
    expect(document.imported!.resources["parts/3023.dat"].content).toBe(originalSource);
    expect(snapshot.files.some((f: LibraryFile) => f.path === "parts/3795.dat")).toBe(true);
  },
);
