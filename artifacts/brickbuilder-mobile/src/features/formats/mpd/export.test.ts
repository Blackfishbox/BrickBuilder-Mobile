import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createEmptyDocument, type BuilderDocument } from "@/features/editor/model";
import { editImported, recolorImported, rotateImported } from "@/features/editor/ldraw-editing";
import type { Affine, ImportedModel } from "../types";
import { IDENTITY, multiply, parseLDraw, referenceLine } from "../ldraw/parser";
import { exportInternal, importInternal } from "../internal/adapter";
import { exportIO } from "../io/export";
import { readZip, writeZip } from "../zip";
import { exportMPD } from "./export";

const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const ref = (name: string, color = "16", x = 0) => `1 ${color} ${x} 0 0 1 0 0 0 1 0 0 0 1 ${name}`;
const source = `0 !UNKNOWN preamble payload
0 FILE main.ldr
0 !UNKNOWN root payload
${ref("assembly.ldr", "4")}
${ref("assembly.ldr", "14", 100)}
${ref("assembly.ldr", "2", 200)}
0 FILE assembly.ldr
0 !UNKNOWN child payload
0 STEP
${ref("inner.ldr")}
${ref("inline.dat", "16", 10)}
0 FILE inner.ldr
${ref("a.dat")}
${ref("b.dat", "0", 20)}
0 FILE inline.dat
0 !LICENSE Synthetic CC0-1.0 fixture
2 24 0 0 0 1 1 1
3 16 0 0 0 10 0 0 0 10 0
4 4 0 0 0 1 0 0 1 1 0 0 1 0
5 24 0 0 0 1 1 1 1 0 0 0 1 0
0 FILE unused.dat
0 !UNKNOWN unreferenced record
3 16 0 0 0 1 0 0 0 1 0
0 NOFILE
`;

function fixture(text = source): BuilderDocument & { imported: ImportedModel } {
  return { ...createEmptyDocument("Export fixture"), imported: {
    version: 1, format: "mpd", sourceName: "fixture.mpd", sourceText: text,
    originalBytes: Array.from(encode(text)), ...parseLDraw(text), resources: {}, legalDocuments: [],
  } };
}

function assertEffective(text: string, document: BuilderDocument) {
  const actual = parseLDraw(text).instances;
  const expected = document.imported!.instances;
  expect(actual).toHaveLength(expected.length + document.bricks.length);
  // Traversal order can change when singular transforms require root lifting.
  const remaining = [...actual];
  for (const instance of expected) {
    const index = remaining.findIndex(i => i.reference === instance.reference && i.colorCode === instance.colorCode &&
      i.matrix.every((n, j) => Math.abs(n - instance.matrix[j]) < 1e-6));
    expect(index, `Missing effective occurrence ${JSON.stringify(instance)}`).toBeGreaterThanOrEqual(0);
    remaining.splice(index, 1);
  }
}

/** Independent traversal of retained inline geometry, not the leaf-instance parser. */
function inlineSurfaces(text: string) {
  const parsed = parseLDraw(text), surfaces: string[] = [];
  function walk(name: string, parent: Affine, color: string) {
    for (const line of parsed.sections[name]) {
      if (/^\s*1\s/.test(line)) {
        const r = referenceLine(line), target = r.reference.toLowerCase();
        if (parsed.sections[target]) walk(target, multiply(parent, r.matrix), r.color === "16" ? color : r.color);
      } else if (/^\s*[2-5]\s/.test(line)) surfaces.push(JSON.stringify([line, parent, color]));
    }
  }
  walk(parsed.root, IDENTITY, "16");
  return surfaces.sort();
}

describe("occurrence-aware MPD and minimal IO exports", () => {
  it("distinguishes repeated submodels and edits only one nested occurrence", () => {
    const original = fixture();
    expect(new Set(original.imported.instances.map(i => i.sourceOccurrence!.join("/"))).size).toBe(6);
    expect(original.imported.instances[0].sourcePath).toEqual(original.imported.instances[2].sourcePath);
    const edited = rotateImported(recolorImported(original, original.imported.instances[0].id, "#00852B", "2"), original.imported.instances[0].id);
    for (const text of [decode(exportMPD(edited)), decode(readZip(exportIO(edited))["model.ldr"])]) {
      assertEffective(text, edited);
      const parsed = parseLDraw(text), root = parsed.sections[parsed.root];
      expect(referenceLine(root.find(line => /^1 4 /.test(line))!).reference).not.toBe("assembly.ldr");
      expect(root).toContain(ref("assembly.ldr", "14", 100));
      expect(root).toContain(ref("assembly.ldr", "2", 200));
      expect(parsed.sections["inline.dat"]).toContain("3 16 0 0 0 10 0 0 0 10 0");
      expect(inlineSurfaces(text)).toEqual(inlineSurfaces(source));
    }
  });

  it("keeps repeated unmodified sections shared and reuses identical edited variants", () => {
    const original = fixture(`${source}\n`);
    const edited = { ...original, imported: { ...original.imported, edited: true,
      instances: original.imported.instances.map(i => i.reference === "b.dat" ? { ...i, colorCode: "7" } : i) } };
    const text = decode(exportMPD(edited)), parsed = parseLDraw(text);
    assertEffective(text, edited);
    const targets = parsed.sections[parsed.root].filter(line => /^1 /.test(line)).map(line => referenceLine(line).reference);
    expect(new Set(targets).size).toBe(1);
    expect(Object.keys(parsed.sections)).toHaveLength(Object.keys(original.imported.sections).length + 2);
    const untouched = { ...original, imported: { ...original.imported, edited: true } };
    expect(Object.keys(parseLDraw(decode(exportMPD(untouched))).sections)).toEqual(Object.keys(original.imported.sections));
  });

  it("preserves nested reflection, shear, scaling and translations after world-space edits", () => {
    const text = `0 FILE main.ldr
1 72 10 20 30 -1 0.5 0 0 2 0 0 0 3 sub.ldr
0 FILE sub.ldr
1 16 4 5 6 0 0 1 0 1 0 -1 0 0 inner.ldr
0 FILE inner.ldr
${ref("a.dat")}`;
    const original = fixture(text), id = original.imported.instances[0].id;
    const edited = editImported(rotateImported(original, id), id, i => ({ ...i, matrix: i.matrix.map((n, k) => k === 3 ? n + 17.5 : n) as Affine }));
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    expect(parseLDraw(exported).sections["main.ldr"].find(line => /^1 /.test(line))).toContain("10 20 30 -1 0.5 0 0 2 0 0 0 3");
  });

  it("lifts only edited leaves out of singular ancestors and retains inline surfaces", () => {
    const text = `0 FILE main.ldr
1 4 10 20 30 0 0 0 0 1 0 0 0 1 sub.ldr
0 FILE sub.ldr
3 16 0 0 0 0 10 0 0 0 10
${ref("a.dat")}
${ref("b.dat")}`;
    const original = fixture(text);
    const edited = editImported(original, original.imported.instances[0].id, i => ({ ...i, matrix: [...IDENTITY] }));
    const exported = decode(exportMPD(edited));
    assertEffective(exported, edited);
    expect(inlineSurfaces(exported)).toEqual(inlineSurfaces(text));
    expect(parseLDraw(exported).sections["main.ldr"]).toContain(ref("a.dat", "4"));
  });

  it("writes additions and occurrence deletions without restoring stale original leaves", () => {
    const original = fixture();
    const edited = editImported(original, original.imported.instances[2].id, () => null);
    edited.imported!.instances.push({ ...original.imported.instances[0], id: "new", reference: "new.dat",
      matrix: [1, 0, 0, 500, 0, 1, 0, -20, 0, 0, 1, 90], sourcePath: ["BrickBuilder"], sourceOccurrence: undefined });
    edited.bricks.push({ id: "legacy", type: "brick-2x4", color: "#FF0000", x: 1, y: 0, z: 2, rotation: 90 });
    for (const text of [decode(exportMPD(edited)), decode(readZip(exportIO(edited))["model.ldr"])]) {
      assertEffective(text, edited);
      expect(parseLDraw(text).instances.filter(i => i.reference === "a.dat")).toHaveLength(2);
      expect(parseLDraw(text).instances.some(i => i.reference === "3001.dat")).toBe(true);
      expect(inlineSurfaces(text)).toEqual(inlineSurfaces(source));
    }
  });

  it("retains exact original archive, unknown source records and JSON extension metadata", () => {
    const original = fixture();
    const archive = writeZip({ "model.ldr": encode(source), "unknown/studio.bin": new Uint8Array([0, 254, 1]),
      "model.ins": encode("<UnknownInstruction />") });
    original.imported.format = "io";
    original.imported.originalBytes = Array.from(archive);
    Object.assign(original.imported, { unknownExtension: { nested: ["untouched"] } });
    Object.assign(original.imported.instances[0], { unknownInstanceMetadata: "opaque" });
    original.metadata = { unknown: { data: [1, 2, 3] } };
    const before = JSON.stringify(original);
    const edited = recolorImported(original, original.imported.instances[0].id, "#00852B", "2");
    const restored = importInternal(exportInternal(edited));
    expect(restored.imported).toMatchObject({ originalBytes: Array.from(archive), sourceText: source,
      sections: original.imported.sections, unknownExtension: { nested: ["untouched"] } });
    expect(restored.imported!.instances[0]).toMatchObject({ sourceOccurrence: original.imported.instances[0].sourceOccurrence,
      unknownInstanceMetadata: "opaque" });
    expect(restored.metadata).toEqual(original.metadata);
    const text = decode(exportMPD(restored));
    expect(text).toContain("0 !UNKNOWN preamble payload");
    expect(text).toContain("0 !UNKNOWN unreferenced record");
    expect(text).toContain("0 !UNKNOWN child payload");
    assertEffective(text, restored);
    const generated = readZip(exportIO(restored));
    expect(Object.keys(generated).sort()).toEqual([".info", "model.ldr"]);
    expect(JSON.parse(decode(generated[".info"])).omittedRecords).toContain("unknown proprietary metadata");
    expect(JSON.stringify(original)).toBe(before);
    expect(restored.imported!.originalBytes).toEqual(Array.from(archive));
  });

  it("supports unambiguous legacy JSON but refuses ambiguous provenance and duplicate keys", () => {
    const unique = fixture(ref("a.dat", "4"));
    delete unique.imported.instances[0].sourceOccurrence;
    unique.imported.edited = true;
    assertEffective(decode(exportMPD(unique)), unique);
    const ambiguous = fixture();
    ambiguous.imported.edited = true;
    ambiguous.imported.instances.forEach(i => { delete i.sourceOccurrence; });
    expect(() => exportMPD(ambiguous)).toThrow(/ältere Projektstand/);
    const duplicate = fixture();
    duplicate.imported.edited = true;
    duplicate.imported.instances[1].sourceOccurrence = duplicate.imported.instances[0].sourceOccurrence;
    expect(() => exportIO(duplicate)).toThrow(/doppelte Vorkommenskennung/);
  });

  it("does not apply a deleted reference's BFC INVERTNEXT to the following part", () => {
    const original = fixture(`0 FILE main.ldr\n0 BFC INVERTNEXT\n${ref("a.dat", "4")}\n${ref("b.dat", "4")}`);
    const edited = editImported(original, original.imported.instances[0].id, () => null);
    const text = decode(exportMPD(edited));
    assertEffective(text, edited);
    expect(parseLDraw(text).sections["main.ldr"]).not.toContain("0 BFC INVERTNEXT");
  });

  it("does not let generated section names shadow an external reference", () => {
    const original = fixture(`0 FILE main.ldr\n${ref("sub.ldr", "4")}\n${ref("brickbuilder-1.ldr", "4")}\n0 FILE sub.ldr\n${ref("a.dat")}`);
    const edited = rotateImported(original, original.imported.instances[0].id);
    const text = decode(exportMPD(edited));
    assertEffective(text, edited);
    expect(Object.keys(parseLDraw(text).sections)).not.toContain("brickbuilder-1.ldr");
  });

  it("lifts an explicitly effective main color rather than re-inheriting a different ancestor color", () => {
    const original = fixture();
    const edited = editImported(original, original.imported.instances[0].id, i => ({ ...i, colorCode: "16" }));
    assertEffective(decode(exportMPD(edited)), edited);
  });
});

// Local private uploads are never copied into a public fixture or export bundle.
for (const filename of ["ford_mxCopy_Copy-1_1793477649199.io", "40649-size_1793502923137.io"]) {
  const path = new URL(`../../../../../../attached_assets/${filename}`, import.meta.url);
  it.skipIf(!existsSync(path))(`roundtrips edited LDraw occurrences from the optional private fixture ${filename}`, () => {
    const archive = new Uint8Array(readFileSync(path));
    const entries = readZip(archive, { names: ["model.ldr"], studioEncryption: true });
    const original = fixture(decode(entries[Object.keys(entries)[0]]));
    const edited = editImported(rotateImported(original, original.imported.instances[0].id), original.imported.instances[1].id, () => null);
    const text = decode(readZip(exportIO(edited))["model.ldr"]);
    assertEffective(text, edited);
    expect(inlineSurfaces(text)).toEqual(inlineSurfaces(original.imported.sourceText));
  });
}
