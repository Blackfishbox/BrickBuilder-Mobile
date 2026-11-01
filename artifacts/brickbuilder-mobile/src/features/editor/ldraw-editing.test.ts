import { afterEach, describe, expect, it, vi } from "vitest";
import { Ray, Vector3 } from "three";
import { createEmptyDocument } from "./model";
import { commit, createHistory, redo, undo } from "./history";
import { editImported, enrichImportedGeometry, moveImported, placePreparedPart, recolorImported, rotateImported, type PreparedPart } from "./ldraw-editing";
import { parseLDraw } from "../formats/ldraw/parser";
import { exportInternal, importInternal } from "../formats/internal/adapter";
import { exportLDR } from "../formats/ldraw/export";
import { exportMPD } from "../formats/mpd/export";
import { exportIO } from "../formats/io/export";
import { readZip } from "../formats/zip";
import type { ImportedModel } from "../formats/types";
import { compilePart, createImportedGroup, reuseGeometryCache } from "../engine/ldraw-geometry";
import { importedSelectionBounds, pickSoftwareInstance } from "../engine/imported-selection";
import { createSoftwareScene } from "../engine/software-scene";
import { disposeImportedScene } from "../engine/imported-scene";
import { builderDatabase, loadProject, saveProject } from "@/storage/database";

function fixture() {
  const text = "0 Synthetic editing fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat\n1 14 100 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
  const imported: ImportedModel = {
    version: 1, format: "mpd", sourceName: "editing.mpd", sourceText: text,
    originalBytes: Array.from(new TextEncoder().encode(text)), ...parseLDraw(text),
    resources: { "parts/test.dat": { path: "parts/test.dat", author: "Synthetic fixture author", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
      content: "0 Synthetic test surface\n3 16 0 0 0 20 0 0 0 20 0\n" } },
    legalDocuments: [],
  };
  imported.instances.forEach(instance => { instance.part.status = "resolved"; });
  return { ...createEmptyDocument(), imported };
}
afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });

describe("editable imported LDraw instances", () => {
  it("edits only the selected occurrence and keeps all original upload metadata untouched", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const source = JSON.stringify([original.imported.sourceText, original.imported.originalBytes, original.imported.sections]);
    const rotated = rotateImported(recolorImported(original, id, "#AEE9EF", "43"), id);
    const moved = moveImported(rotated, id, { x: 3.25, y: -0.4, z: 8 });
    expect(moved.imported!.instances[0].matrix).toEqual([0, 0, 1, 70, 0, 1, 0, 8, -1, -0, -0, 160]);
    expect(moved.imported!.instances[0]).toMatchObject({ colorCode: "43", color: { alpha: 128 } });
    expect(moved.imported!.instances[1]).toBe(original.imported.instances[1]);
    expect(JSON.stringify([moved.imported!.sourceText, moved.imported!.originalBytes, moved.imported!.sections])).toBe(source);
    expect(original.imported.instances[0].colorCode).toBe("4");
    expect(original.imported.instances[0].matrix[3]).toBe(0);
  });
  it("preserves arbitrary source basis, reflection and pivot across four rotations", () => {
    let document = fixture();
    document.imported.instances[0].matrix = [-1, 0.25, 0, 12, 0, 1, 0.5, -31, 0, 0, 2, 44];
    const before = [...document.imported.instances[0].matrix];
    for (let i = 0; i < 4; i++) document = rotateImported(document, document.imported.instances[0].id) as typeof document;
    expect(document.imported.instances[0].matrix).toEqual(before);
  });
  it("restores imported deletion, colors and transforms with undo/redo", () => {
    const document = fixture(), id = document.imported.instances[0].id;
    let history = createHistory(document);
    history = commit(history, recolorImported(history.document, id, "#FAC80A", "14"));
    history = commit(history, rotateImported(history.document, id));
    history = commit(history, editImported(history.document, id, () => null));
    expect(history.document.imported!.instances).toHaveLength(1);
    history = undo(history); expect(history.document.imported!.instances).toHaveLength(2);
    history = undo(history); expect(history.document.imported!.instances[0].matrix).toEqual(document.imported.instances[0].matrix);
    history = undo(history); expect(history.document.imported!.instances[0].colorCode).toBe("4");
    history = redo(redo(redo(history))); expect(history.document.imported!.instances).toHaveLength(1);
  });
  it("persists the edited flag and effective instances through IndexedDB and internal JSON", async () => {
    await builderDatabase.open();
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = rotateImported(recolorImported(original, id, "#00852B", "2"), id);
    await saveProject(edited);
    const reopened = await loadProject(edited.id);
    expect(reopened!.imported).toEqual(edited.imported);
    const roundtrip = importInternal(exportInternal(edited));
    expect(roundtrip.imported!.edited).toBe(true);
    expect(roundtrip.imported!.instances[0].matrix).toEqual(edited.imported!.instances[0].matrix.map(value => value || 0));
    expect(roundtrip.imported!.originalBytes).toEqual(original.imported.originalBytes);
  });
  it("exports edited effective parts rather than the stale original MPD source", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = editImported(rotateImported(recolorImported(original, id, "#00852B", "2"), id), original.imported.instances[1].id, () => null);
    for (const bytes of [exportLDR(edited), exportMPD(edited), readZip(exportIO(edited))["model.ldr"]]) {
      const parsed = parseLDraw(new TextDecoder().decode(bytes));
      expect(parsed.instances).toHaveLength(1);
      expect(parsed.instances[0].colorCode).toBe("2");
      expect(parsed.instances[0].matrix).toEqual(edited.imported!.instances[0].matrix.map(value => value || 0));
    }
    expect(new TextDecoder().decode(exportMPD(original))).toBe(original.imported.sourceText);
  });
  it("never resurrects deleted parts or overwrites edits when older geometry results arrive", () => {
    const original = fixture(), id = original.imported.instances[0].id;
    const edited = editImported(recolorImported(original, id, "#FAC80A", "14"), original.imported.instances[1].id, () => null);
    const enriched = enrichImportedGeometry(edited.imported!, original.imported);
    expect(enriched.instances).toHaveLength(1);
    expect(enriched.instances[0].colorCode).toBe("14");
    expect(enriched.edited).toBe(true);
  });
  it("places actual prepared LDraw geometry, not one of the procedural legacy bricks", () => {
    const original = fixture();
    const prepared: PreparedPart = {
      part: { id: "test", packageId: "test", ldrawId: "test", name: "Test part", category: "Test", keywords: [], file: "parts/test.dat" },
      model: original.imported, bottom: -1,
    };
    const placed = placePreparedPart(createEmptyDocument(), prepared, { x: 2, y: 0.4, z: 3 }, "#FAC80A", "14");
    expect(placed.bricks).toHaveLength(0);
    expect(placed.imported!.instances).toHaveLength(1);
    expect(placed.imported!.instances[0]).toMatchObject({ reference: "test.dat", colorCode: "14" });
    expect(placed.imported!.instances[0].matrix[7]).toBeCloseTo(-28);
    expect(placed.imported!.resources["parts/test.dat"]).toBe(original.imported.resources["parts/test.dat"]);
  });
  it("reuses compiled buffers after color or matrix edits without modifying older snapshots", () => {
    const original = fixture();
    const compiled = compilePart(original.imported, "test.dat", "4");
    const edited = recolorImported(original, original.imported.instances[0].id, "#FAC80A", "14");
    reuseGeometryCache(original.imported, edited.imported!);
    expect(compilePart(edited.imported!, "test.dat", "14")[0].positions).toBe(compiled[0].positions);
  });
  it("maps GPU instance IDs and bounds and hits the nearest software triangle", async () => {
    const document = fixture(), model = document.imported;
    const root = createImportedGroup(model);
    const bounds = importedSelectionBounds(root, model.instances[1].id)!;
    expect(bounds.min.x).toBeCloseTo(5);
    expect(bounds.max.x).toBeCloseTo(6);
    const software = await createSoftwareScene(model);
    const hit = pickSoftwareInstance(new Ray(new Vector3(0.2, -0.2, 2), new Vector3(0, 0, -1)), software, 0);
    expect(hit?.id).toBe(model.instances[0].id);
    expect(hit?.point.z).toBeCloseTo(0);
    disposeImportedScene(root);
  });
});
