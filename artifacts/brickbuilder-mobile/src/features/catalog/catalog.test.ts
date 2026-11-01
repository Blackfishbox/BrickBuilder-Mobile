import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { decodeCatalog, indexCatalog, searchCatalog, type CatalogData } from "./data";
import { installCatalogIndex, catalogManifest } from "./client";
import { resolvePartMapping, BRICKLINK_EVIDENCE } from "../parts/bricklink-evidence";
import { catalogPalette, resolveColor } from "../formats/colors";
import { refreshedCatalogModel } from "./refresh-model";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { createEmptyDocument, normalizeDocument } from "../editor/model";
import { importInternal, exportInternal } from "../formats/internal/adapter";
import { readZip } from "../formats/zip";

function fixture(): CatalogData {
  return {
    schema: 1, version: "test", attribution: "Synthetic test records",
    sources: Object.fromEntries([["parts", 3], ["colors", 2], ["part_mappings", 7], ["color_mappings", 5]].map(([key, rows]) => [key, { rows: Number(rows), sha256: "a".repeat(64), url: "https://example.invalid" }])),
    parts: [["rb1", "Part one", "1", "Plastic"], ["rb2", "Part two", "1", "Plastic"], ["unmapped", "No mapping", "1", "Plastic"]],
    colors: [["rbColor", "Test Red", "ff0000", "False", "1", "1", "2000", "2026"], ["other", "Test second", "00ff00", "True", "1", "1", "2000", "2026"]],
    part_mappings: [
      ["rb1", "LD", "test", "True", "True"], ["rb1", "BL", "bl1", "True", "True"],
      ["rb1", "BL", "oldAlias", "False", "True"], ["rb2", "LD", "test", "False", "True"],
      ["rb2", "BL", "bl2", "True", "False"], ["rb2", "LD", "outputOnly", "True", "False"],
      ["unmapped", "LD", "no-bl", "True", "True"],
    ],
    color_mappings: [
      ["rbColor", "LD", "4", '["Red"]', "True", "True"], ["rbColor", "BL", "5", '["Red"]', "True", "True"],
      ["other", "LD", "4", '["Other"]', "False", "True"], ["other", "BL", "99", '["Other"]', "True", "True"],
      ["other", "LD", "123456", '["Other"]', "True", "True"],
    ],
  };
}
afterEach(() => installCatalogIndex());
describe("complete catalog semantics", () => {
  it("honors LD import and BL export flags without equating namespaces or aliases", () => {
    const index = indexCatalog(fixture()); installCatalogIndex(index);
    const result = resolvePartMapping("TEST.dat");
    expect(result.status).toBe("ambiguous");
    expect(result.candidates.map(candidate => candidate.brickLinkId).sort()).toEqual(["bl1", "bl2"]);
    expect(result.rebrickableIds).toEqual(["rb1", "rb2"]);
    expect(resolvePartMapping("outputOnly.dat").status).toBe("unknown");
    expect(resolvePartMapping("constructor.dat").status).toBe("unknown");
    expect(resolvePartMapping("no-bl.dat")).toMatchObject({ status: "unknown", rebrickableIds: ["unmapped"] });
    expect(index.coverage).toMatchObject({ confirmedParts: 0, ambiguousParts: 1, unknownParts: 1 });
  });
  it("retains prior proven evidence instead of overriding it", () => {
    installCatalogIndex(indexCatalog(fixture()));
    const prior = { ...BRICKLINK_EVIDENCE[0], ldrawId: "no-bl", brickLinkId: "proven" };
    expect(resolvePartMapping("no-bl.dat", [], [prior])).toMatchObject({ status: "confirmed", candidates: [prior] });
    const other = { ...prior, ldrawId: "test" };
    expect(resolvePartMapping("test.dat", [], [other]).candidates).toHaveLength(3);
  });
  it("keeps official LDraw appearance while exposing conflicting color evidence", () => {
    installCatalogIndex(indexCatalog(fixture()));
    expect(resolveColor("4")).toMatchObject({ hex: "#B40000", brickLinkId: undefined, catalog: { status: "ambiguous", brickLinkIds: [5, 99] } });
    expect(resolveColor("123456")).toMatchObject({ hex: "#00ff00", alpha: 128, brickLinkId: 99 });
    expect(resolveColor("rbColor")).toBeUndefined();
    expect(catalogPalette().some(color => color.ldrawCode === "123456")).toBe(true);
  });
  it("rejects truncation, dangling foreign keys and bad direction flags", () => {
    const data = fixture(); data.sources.parts.rows++;
    expect(() => indexCatalog(data)).toThrow("Unvollständiger");
    const orphan = fixture(); orphan.part_mappings[0][0] = "absent";
    expect(() => indexCatalog(orphan)).toThrow("Katalogschlüssel");
    const bad = fixture(); bad.color_mappings[0][4] = "yes";
    expect(() => indexCatalog(bad)).toThrow("Richtungswert");
  });
  it("preserves original sources and previously proven color conflicts across JSON and repeated refresh", () => {
    installCatalogIndex(indexCatalog(fixture()));
    const text = "0 Main\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat";
    const model: ImportedModel = { version: 1, format: "ldr", sourceName: "test.ldr", sourceText: text, originalBytes: [1, 2, 3],
      ...parseLDraw(text), resources: {}, legalDocuments: [] };
    const original = JSON.stringify([model.sourceText, model.originalBytes, model.instances.map(i => i.matrix)]);
    const next = refreshedCatalogModel(model);
    const cache = new WeakMap();
    const first = refreshedCatalogModel(model, cache);
    const historical = refreshedCatalogModel({ ...model, instances: [...model.instances] }, cache);
    expect(first.instances[0]).toBe(historical.instances[0]);
    expect(model.instances[0].part.mapping).toBeUndefined();
    const doc = importInternal(exportInternal({ ...createEmptyDocument(), imported: next }));
    expect(doc.imported!.instances[0].part.mapping?.status).toBe("ambiguous");
    expect(doc.imported!.instances[0].color?.catalog?.status).toBe("ambiguous");
    expect(JSON.stringify([next.sourceText, next.originalBytes, next.instances.map(i => i.matrix)])).toBe(original);
    const refreshed = normalizeDocument(doc).imported!;
    expect(refreshed.issues.filter(i => i.code === "ambiguous-bl-color")).toHaveLength(1);
  });
  it("searches all records and retains unknown external systems and alias flags", () => {
    const found = searchCatalog(fixture(), "oldAlias", "parts");
    expect(found[0].id).toBe("rb1");
    expect(found[0].mappings.some(row => row[2] === "oldAlias" && row[3] === "False")).toBe(true);
    expect(searchCatalog(fixture(), "unmapped", "parts")[0].id).toBe("unmapped");
  });
  it("retains confirmed IDs and ambiguous candidates through reopen and save without a catalog snapshot", () => {
    const data = fixture();
    data.color_mappings.push(["other", "LD", "2", '["Green"]', "True", "True"]);
    data.sources.color_mappings.rows++;
    installCatalogIndex(indexCatalog(data));
    const text = [2, 4, 123456].map(code => `1 ${code} 0 0 0 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
    const model: ImportedModel = { version: 1, format: "ldr", sourceName: "offline.ldr", sourceText: text, originalBytes: [...new TextEncoder().encode(text)],
      ...parseLDraw(text), resources: {}, legalDocuments: [] };
    const document = { ...createEmptyDocument(), imported: refreshedCatalogModel(model) };
    document.imported.instances[0].color!.hex = "#FF00AA"; // Deliberately stale cached appearance.
    const exported = exportInternal(document);
    installCatalogIndex(); // No worker index or IndexedDB catalog snapshot is available.
    const reopened = importInternal(exported);
    const colors = reopened.imported!.instances.map(instance => instance.color!);
    expect(colors[0]).toMatchObject({ hex: "#00852B", brickLinkId: 99,
      catalog: { status: "confirmed", brickLinkIds: [99], rebrickableIds: ["other"] } });
    expect(colors[1]).toMatchObject({ hex: "#B40000", brickLinkId: undefined,
      catalog: { status: "ambiguous", brickLinkIds: [5, 99] } });
    expect(colors[2]).toMatchObject({ hex: "#FF00AA", brickLinkId: 99,
      catalog: { status: "confirmed", brickLinkIds: [99] } });
    expect(reopened.imported!.issues.some(issue => issue.code === "missing-color" && issue.reference === "123456")).toBe(true);
    expect(colors.every(color => color.source.includes("color_mappings.csv.gz"))).toBe(true);
    const savedAgain = importInternal(exportInternal(reopened));
    expect(savedAgain.imported!.instances.map(instance => instance.color)).toEqual(colors);
    expect(savedAgain.imported!.instances.map(instance => [instance.reference, instance.matrix, instance.colorCode]))
      .toEqual(model.instances.map(instance => [instance.reference, instance.matrix, instance.colorCode]));
    const recolored = structuredClone(savedAgain);
    recolored.imported!.instances[0].colorCode = "1";
    expect(normalizeDocument(recolored).imported!.instances[0].color?.catalog).toBeUndefined();
  });
});
const fullPath = new URL("../../../../../generated-artifacts/catalog-sources/catalog.bin", import.meta.url);
describe.skipIf(!existsSync(fullPath))("complete approved source snapshot", () => {
  it("validates every published row, pinned digest, full coverage and supplied IO references", () => {
    const bytes = new Uint8Array(readFileSync(fullPath));
    expect(bytes.length).toBe(catalogManifest.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(catalogManifest.sha256);
    const data = decodeCatalog(bytes);
    const index = indexCatalog(data); installCatalogIndex(index);
    expect(index.coverage).toMatchObject({ parts: 64914, colors: 275, partRows: 183263, colorRows: 846 });
    expect(index.coverage.confirmedParts + index.coverage.ambiguousParts + index.coverage.unknownParts).toBe(index.coverage.ldrawParts);
    expect(index.coverage.confirmedColors + index.coverage.ambiguousColors + index.coverage.unknownColors).toBe(index.coverage.ldrawColors);
    expect(resolvePartMapping("3001.dat").status).toBe("confirmed");
    expect(resolveColor("14")?.brickLinkId).toBe(3);
    expect(resolveColor("288")?.brickLinkId).toBe(80);
    for (const filename of ["Schild_(1)_1793518004611.io", "40649-size_1793502923137.io", "ford_mxCopy_Copy-1_1793477649199.io"]) {
      const path = new URL(`../../../../../attached_assets/${filename}`, import.meta.url);
      if (!existsSync(path)) continue;
      const entry = readZip(new Uint8Array(readFileSync(path)), { names: ["model.ldr"], studioEncryption: true })["model.ldr"];
      const parsed = parseLDraw(new TextDecoder().decode(entry));
      const original = JSON.stringify(parsed.instances.map(i => [i.reference, i.matrix, i.colorCode]));
      const model: ImportedModel = { version: 1, format: "io", sourceName: filename, sourceText: new TextDecoder().decode(entry),
        originalBytes: [0], ...parsed, resources: {}, legalDocuments: [] };
      const mapped = refreshedCatalogModel(model);
      expect(JSON.stringify(mapped.instances.map(i => [i.reference, i.matrix, i.colorCode]))).toBe(original);
      expect(mapped.instances.every(i => i.part.mapping)).toBe(true);
      const reopened = importInternal(exportInternal({ ...createEmptyDocument(), imported: mapped })).imported!;
      expect(reopened.instances.map(i => i.part)).toEqual(mapped.instances.map(i => i.part));
    }
    console.info("Reviewed catalog coverage", index.coverage);
  });
});
