import { afterEach, describe, expect, it } from "vitest";
import { parseInventory } from "./import";
import { allocatedCounts, replaceInventory, validateInventory } from "./accounting";
import { MAX_LIST_BYTES, type InventoryChoice } from "./types";
import { createEmptyDocument, normalizeDocument } from "../editor/model";
import { editImported, moveImported, placeInventoryPart, placePreparedPart, recolorImported, rotateImported, type PreparedPart } from "../editor/ldraw-editing";
import { commit, createHistory, redo, undo } from "../editor/history";
import { parseLDraw } from "../formats/ldraw/parser";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import { builderDatabase, createImportedProject, loadCurrentProject, loadProject, saveProject } from "@/storage/database";
import { resolveInventory } from "../catalog/inventory-resolution";
import { decodeCatalog } from "../catalog/data";
import { existsSync, readFileSync } from "node:fs";

const csv = "part_id,color_id,quantity\n3001,5,2\n3001,5,1\n3001,7,1";
const xml = (items: string) => `<?xml version="1.0"?><INVENTORY>${items}</INVENTORY>`;
const item = (quantity = "2", extra = "", type = "P") => `<ITEM><ITEMTYPE>${type}</ITEMTYPE><ITEMID>3001</ITEMID><COLOR>5</COLOR><QTY>${quantity}</QTY>${extra}</ITEM>`;
function fixture() {
  const inventory = parseInventory("part_id,color_id,quantity\n3001,5,1\n3001,7,2", "synthetic.csv");
  const imported = {
    version: 1 as const, format: "ldr" as const, sourceName: "synthetic.ldr",
    sourceText: "0 Self-authored geometry\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat",
    originalBytes: [1, 2, 3], ...parseLDraw("1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat"),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic fixture author", license: "CC0-1.0" as const,
      sourceUrl: "https://example.invalid", content: "0 Self-authored surface\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances[0].part.status = "resolved";
  const prepared: PreparedPart = { model: imported, bottom: -1, part: {
    id: "synthetic", ldrawId: "test", name: "Synthetic part", packageId: "synthetic",
    category: "", keywords: [], file: "parts/test.dat",
  } };
  const document = { ...createEmptyDocument(), inventory };
  const choice: InventoryChoice = { listId: inventory.id, rowId: inventory.rows[0].id, ldrawId: "test", colorCode: "4" };
  return { document, prepared, choice };
}
const position = { x: 0, y: 0, z: 0 };
afterEach(async () => { await builderDatabase.delete(); });

describe("bounded inventory imports", () => {
  it("aggregates only exact source part/color combinations and retains source metadata", () => {
    const list = parseInventory(csv, "list.csv");
    expect(list.rows.map(r => [r.partId, r.colorId, r.quantity, r.sourceRows])).toEqual([
      ["3001", "5", 3, [1, 2]], ["3001", "7", 1, [3]],
    ]);
    const parsed = parseInventory(xml(item("2", "<REMARKS>My &amp; your stock</REMARKS>") + item("3")), "list.xml");
    expect(parsed.rows[0]).toMatchObject({ quantity: 5, sourceRows: [1, 2] });
    expect(parsed.rows[0].metadata[0].REMARKS).toBe("My & your stock");
  });
  it("supports wanted-list MINQTY and exposes unsupported non-part rows", () => {
    const parsed = parseInventory(xml(item().replace("<QTY>2</QTY>", "<MINQTY>2</MINQTY>") + item("1", "", "S")), "wanted.xml");
    expect(parsed.rows.map(r => [r.itemType, r.quantity])).toEqual([["P", 2], ["S", 1]]);
  });
  it.each(["0", "-1", "1.5", "1e3", "100001", "999999999999999999", "NaN", ""])("rejects invalid quantity %s without mutating the current project", value => {
    const { document } = fixture(), before = JSON.stringify(document);
    expect(() => parseInventory(xml(item(value)), "bad.xml")).toThrow();
    expect(JSON.stringify(document)).toBe(before);
  });
  it.each([
    "<INVENTORY><ITEM></INVENTORY>", "<OTHER/>", "<INVENTORY/>",
    '<!DOCTYPE INVENTORY [<!ENTITY x SYSTEM "file:///etc/passwd">]><INVENTORY/>',
    '<!DOCTYPE INVENTORY [<!ENTITY a "expanded">]><INVENTORY/>',
    xml(item("2", "<QTY>3</QTY>")), xml(item("2", "<MINQTY>3</MINQTY>")),
    xml(item("2", "<ITEMID>other</ITEMID>")), xml(item("2", "<COLOR><nested>5</nested></COLOR>")),
  ])("rejects malformed or unsafe XML", text => {
    expect(() => parseInventory(text, "bad.xml")).toThrow();
  });
  it("rejects oversized input, rows, duplicate totals, unknown formats and malformed CSV", () => {
    expect(() => parseInventory("x".repeat(MAX_LIST_BYTES + 1), "bad.xml")).toThrow("2 MiB");
    expect(() => parseInventory(xml(item("100000") + item("1")), "bad.xml")).toThrow("zusammengefasste");
    expect(() => parseInventory(xml(item().repeat(5001)), "bad.xml")).toThrow("5000");
    for (const text of ["part,color,quantity\n3001,5,2", 'part_id,color_id,quantity\n"3001,5,2', 'part_id,color_id,quantity\n3001,5,"2"junk', "part_id,color_id,quantity\n3001,5,2,3"]) {
      expect(() => parseInventory(text, "bad.csv")).toThrow();
    }
    expect(() => parseInventory(csv, "list.txt")).toThrow("dokumentierte CSV");
    expect(parseInventory('\uFEFFpart_id,color_id,quantity\r\n"3001","5","2"\r\n', "quoted.csv").rows[0].quantity).toBe(2);
  });
});

describe("durable stock allocations", () => {
  it("atomically exhausts a row even with repeated placement and stale choices", () => {
    const { document, prepared, choice } = fixture();
    const first = placeInventoryPart(document, prepared, position, choice);
    expect(allocatedCounts(first).get(choice.rowId)).toBe(1);
    for (let i = 0; i < 20; i++) expect(() => placeInventoryPart(first, prepared, position, choice)).toThrow("aufgebraucht");
    expect(allocatedCounts(document).size).toBe(0);
    const free = placePreparedPart(first, prepared, position, "#1E5AA8", "1");
    expect(free.imported!.instances).toHaveLength(2);
    expect(free.imported!.instances[1].allocation).toBeUndefined();
    expect(allocatedCounts(free).get(choice.rowId)).toBe(1);
    const blue = placeInventoryPart(free, prepared, position, { ...choice, rowId: document.inventory.rows[1].id, colorCode: "1" });
    expect([...allocatedCounts(blue).values()]).toEqual([1, 1]);
  });
  it("reserves original units through move/rotate/recolor; delete and history restore exact stock", () => {
    const { document, prepared, choice } = fixture();
    let history = createHistory(document);
    history = commit(history, placeInventoryPart(history.document, prepared, position, choice));
    const id = history.document.imported!.instances[0].id;
    history = commit(history, moveImported(history.document, id, { x: 2, y: 1, z: 3 }));
    history = commit(history, rotateImported(history.document, id));
    history = commit(history, recolorImported(history.document, id, "#1E5AA8", "1"));
    expect(allocatedCounts(history.document).get(choice.rowId)).toBe(1);
    expect(history.document.imported!.instances[0].allocation).toEqual({ listId: choice.listId, rowId: choice.rowId });
    history = commit(history, editImported(history.document, id, () => null));
    expect(allocatedCounts(history.document).size).toBe(0);
    history = undo(history); expect(allocatedCounts(history.document).get(choice.rowId)).toBe(1);
    history = redo(history); expect(allocatedCounts(history.document).size).toBe(0);
    for (let i = 0; i < 5; i++) history = undo(history);
    expect(history.document).toBe(document);
    for (let i = 0; i < 4; i++) history = redo(history);
    expect(history.document.imported!.instances[0].colorCode).toBe("1");
    expect(allocatedCounts(history.document).get(choice.rowId)).toBe(1);
  });
  it("charges nothing for failed placement, invalid color, stale list or conflicting geometry", () => {
    const { document, prepared, choice } = fixture();
    const original = JSON.stringify(document);
    expect(() => placeInventoryPart(document, prepared, { ...position, x: NaN }, choice)).toThrow();
    expect(() => placeInventoryPart(document, prepared, position, { ...choice, listId: "old" })).toThrow("gültig");
    expect(() => placeInventoryPart(document, prepared, position, { ...choice, colorCode: "16" })).toThrow("Farbe");
    expect(() => placeInventoryPart(document, prepared, position, { ...choice, ldrawId: "guessed" })).toThrow("Geometrie");
    const placed = placeInventoryPart(document, prepared, position, choice);
    const conflict = { ...prepared, model: structuredClone(prepared.model) };
    conflict.model.resources["parts/test.dat"].content = "different";
    expect(() => placePreparedPart(placed, conflict, position, "#B40000", "4")).toThrow("Quellkonflikt");
    expect(JSON.stringify(document)).toBe(original);
    expect(allocatedCounts(placed).get(choice.rowId)).toBe(1);
  });
  it("blocks replacement with allocations and rejects corrupted backups rather than replenishing stock", () => {
    const { document, prepared, choice } = fixture();
    const placed = placeInventoryPart(document, prepared, position, choice);
    expect(() => replaceInventory(placed, parseInventory(csv, "new.csv"))).toThrow("erst ersetzt");
    const deleted = editImported(placed, placed.imported!.instances[0].id, () => null);
    const replaced = replaceInventory(deleted, parseInventory(csv, "new.csv"));
    expect(replaced.inventory!.id).not.toBe(document.inventory.id);
    expect(() => placeInventoryPart(replaced, prepared, position, choice)).toThrow("gültig");
    for (const mutate of [
      (d: typeof placed) => { d.inventory = undefined; },
      (d: typeof placed) => { d.imported!.instances[0].allocation!.rowId = "unknown"; },
      (d: typeof placed) => { d.imported!.instances.push({ ...d.imported!.instances[0], id: "second" }); },
      (d: typeof placed) => { d.inventory!.rows.push(d.inventory!.rows[0]); },
      (d: typeof placed) => { d.imported!.instances.push(d.imported!.instances[0]); },
    ]) {
      const bad = structuredClone(placed); mutate(bad);
      expect(() => importInternal(exportInternal(bad))).toThrow();
      expect(() => normalizeDocument(bad)).toThrow();
    }
  });
  it("preserves inventory, edits, original sources, allocation links and legacy compatibility offline", async () => {
    await builderDatabase.open();
    const { document, prepared, choice } = fixture();
    const placed = placeInventoryPart(document, prepared, position, choice);
    const id = placed.imported!.instances[0].id;
    const edited = recolorImported(placed, id, "#1E5AA8", "1");
    await saveProject(edited);
    await saveProject(createEmptyDocument("Other project"));
    const reopened = normalizeDocument((await loadProject(edited.id))!);
    expect(reopened.inventory).toEqual(edited.inventory);
    expect(reopened.imported!.instances[0].allocation).toEqual(edited.imported!.instances[0].allocation);
    const backup = importInternal(exportInternal(reopened));
    expect(backup.inventory).toEqual(edited.inventory);
    expect(allocatedCounts(backup).get(choice.rowId)).toBe(1);
    expect(backup.imported!.originalBytes).toEqual(edited.imported!.originalBytes);
    expect(backup.imported!.sourceText).toBe(edited.imported!.sourceText);
    expect(backup.imported!.instances[0].colorCode).toBe("1");
    await createImportedProject(reopened, backup);
    expect((await loadCurrentProject())!.inventory).toEqual(edited.inventory);
    validateInventory((await loadProject(backup.id))!);
    expect(normalizeDocument(createEmptyDocument()).inventory).toBeUndefined();
    const legacy = { ...createEmptyDocument(), imported: prepared.model };
    expect(allocatedCounts(legacy).size).toBe(0);
  });
});

describe("existing complete catalog reverse resolution", () => {
  it("honors BL import and LD export flags, aliases, ambiguity and unsupported types", () => {
    const data = {
      schema: 1 as const, version: "synthetic", attribution: "", sources: {}, colors: [["red", "Red", "ff0000", "False"]],
      parts: [["rb", "Real part"], ["rb2", "Variant"]],
      part_mappings: [
        ["rb", "BL", "3001", "False", "True"], ["rb", "BL", "alias", "False", "True"],
        ["rb", "LD", "real.dat", "True", "False"], ["rb", "LD", "not-exportable", "False", "True"],
        ["rb2", "BL", "3001", "False", "True"], ["rb2", "LD", "variant", "True", "True"],
        ["rb2", "BL", "output-only", "True", "False"],
      ],
      color_mappings: [
        ["red", "BL", "5", '["Red"]', "False", "True"], ["red", "LD", "4", '["Red"]', "True", "False"],
        ["red", "LD", "bad", '["Bad"]', "False", "True"],
      ],
    };
    const inventory = parseInventory("part_id,color_id,quantity\n3001,5,1\nalias,5,1\noutput-only,5,1\nunknown,99,2", "test.csv");
    const resolved = resolveInventory(data, inventory).resolutions;
    expect(resolved["row-1"].parts.map(p => p.ldrawId)).toEqual(["real", "variant"]);
    expect(resolved["row-2"].parts.map(p => p.ldrawId)).toEqual(["real"]);
    expect(resolved["row-1"].colors.map(c => c.ldrawCode)).toEqual(["4"]);
    expect(resolved["row-3"].parts).toEqual([]);
    expect(resolved["row-4"]).toEqual({ parts: [], colors: [] });
    inventory.rows[0].itemType = "S";
    expect(resolveInventory(data, inventory).resolutions["row-1"]).toEqual({ parts: [], colors: [] });
  });
  const catalogPath = new URL("../../../../../generated-artifacts/catalog-sources/catalog.bin", import.meta.url);
  it.skipIf(!existsSync(catalogPath))("resolves a standard brick and each source color through the approved complete catalog", () => {
    const data = decodeCatalog(new Uint8Array(readFileSync(catalogPath)));
    const preview = resolveInventory(data, parseInventory(csv, "synthetic.csv"));
    expect(preview.resolutions["row-1"].parts.some(p => p.ldrawId === "3001")).toBe(true);
    expect(preview.resolutions["row-1"].colors.some(c => c.ldrawCode === "4")).toBe(true);
    expect(preview.resolutions["row-3"].colors.some(c => c.ldrawCode === "1")).toBe(true);
  });
});
