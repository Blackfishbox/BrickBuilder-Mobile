import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImportedModel } from "../formats/types";
import { connectionFixture, partLine } from "./fixtures";
import { activeConnections, constructionTransform, magneticConstructionTransform } from "./engine";
import { describeConnections } from "./description";
import { equivalentPrimitiveHierarchy } from "./hierarchy-equivalence";
import { createEmptyDocument } from "../editor/model";
import { moveImported } from "../editor/ldraw-editing";
import { createHistory, commit, undo, redo } from "../editor/history";
import { exportInternal, importInternal } from "../formats/internal/adapter";

const plates = JSON.parse(readFileSync(new URL("../../../public/parts/ldraw-plates-2026-10-31.json", import.meta.url), "utf8"));
const resources = Object.fromEntries(plates.files.map((f: { path: string }) => [f.path, f])) as ImportedModel["resources"];
const support = readFileSync(new URL("./fixtures/3795.dat", import.meta.url), "utf8");
function fixture(part = "3023b", legacy = false) {
  const model = connectionFixture([partLine("3795", 0, -8), partLine(part, 160, -8)].join("\n"));
  model.resources = { ...model.resources, ...resources,
    "parts/3795.dat": { ...resources["parts/3020.dat"], path: "parts/3795.dat", content: support } };
  if (legacy) {
    const content = resources["parts/3023b.dat"].content
      .replace(/^1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\3023bs01.dat$/m, resources["parts/s/3023bs01.dat"].content)
      .replace(/^1 16 0 0 0 1 0 0 0 1 0 0 0 1 stug-1x2.dat$/m, resources["p/stug-1x2.dat"].content);
    model.resources = { ...model.resources, "parts/3023.dat": { ...resources["parts/3023.dat"], content } };
  }
  return model;
}
describe("standard plate mating from installed source geometry", () => {
  it("mates a legacy flat 3023 source as well as the current subpart-based source", () => {
    const model = fixture("3023", true);
    // Older installed/embedded libraries place these exact references directly
    // in 3023.dat, whereas the pinned library moved them into 3023bs01.dat.
    expect(equivalentPrimitiveHierarchy("3023.dat", model)).toBe(true);
    const result = constructionTransform(model, model.instances[1].id, { x: 0.03, y: 0.4, z: 0.52 });
    expect(result.contacts.length).toBe(2);
    expect(result.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
  });
  it("does not invent sockets for changed or incomplete geometry with the same part number", () => {
    const model = fixture("3023", true);
    const changed = { ...model, resources: { ...model.resources, "parts/3023.dat": {
      ...model.resources["parts/3023.dat"], content: model.resources["parts/3023.dat"].content
        .replace("1 16 10 0 0", "1 16 12 0 0"),
    } } };
    expect(equivalentPrimitiveHierarchy("3023.dat", changed)).toBe(false);
    expect(describeConnections("3023.dat", changed).connectors.filter(c => c.gender === "F")).toHaveLength(0);
    const incomplete = { ...model, resources: { ...model.resources } };
    delete incomplete.resources["p/stud.dat"];
    expect(equivalentPrimitiveHierarchy("3023.dat", incomplete)).toBe(false);
  });
  it("preserves exact legacy plate alignment through magnetic preview, commit, history and JSON", () => {
    const model = fixture("3023", true), id = model.instances[1].id;
    const source = model.resources["parts/3023.dat"].content, originalBytes = model.originalBytes;
    const first = magneticConstructionTransform(model, id, { x: 0.03, y: 0.4, z: 0.52 });
    expect(first.transform.contacts).toHaveLength(2);
    const held = magneticConstructionTransform(model, id, { x: 0.12, y: 0.4, z: 0.6 }, first.latch);
    expect(held.transform).toBe(first.transform);
    const document = { ...createEmptyDocument(), imported: model };
    const next = moveImported(document, id, { x: 0, y: 0.8, z: 0.5 }, false, held.transform.matrix);
    const history = commit(createHistory(document), next);
    expect(undo(history).document).toBe(document);
    expect(redo(undo(history)).document).toBe(next);
    expect(activeConnections(next.imported!, id)).toHaveLength(2);
    const saved = importInternal(exportInternal(next));
    expect(saved.imported!.instances[1].matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
    expect(saved.imported!.resources["parts/3023.dat"].content).toBe(source);
    expect(next.imported!.originalBytes).toBe(originalBytes);
  });
  it("matches both sockets on a rotated off-grid 2x6 support without rounding the imported origin", () => {
    const base = fixture("3023", true), basis = "0 0 1 0 1 0 -1 0 0";
    const model = connectionFixture([partLine("3795", 4.6, -8, 3.4, basis), partLine("3023", 160, -8, 0, basis)].join("\n"));
    model.resources = base.resources;
    const result = constructionTransform(model, model.instances[1].id, { x: 0.76, y: 0.4, z: 0.2 });
    expect(result.contacts).toHaveLength(2);
    expect(result.matrix).toEqual([0, 0, 1, 14.6, 0, 1, 0, -16, -1, 0, 0, 3.4]);
  });
  for (const basis of ["1 0 0 0 1 0 0 0 1", "0 0 1 0 1 0 -1 0 0", "-1 0 0 0 1 0 0 0 -1", "0 0 -1 0 1 0 1 0 0"]) {
    it(`keeps plate orientation and height while approaching a row: ${basis}`, () => {
      for (const x of [-1, -0.5, 0, 0.5, 1]) for (const z of [-0.5, -0.2, 0, 0.2, 0.5]) {
        const model = fixture();
        const rotated = connectionFixture([partLine("3795", 0, -8), partLine("3023b", 160, -8, 0, basis)].join("\n"));
        rotated.resources = model.resources;
        const result = constructionTransform(rotated, rotated.instances[1].id, { x, y: 0.4, z });
        expect(result.contacts.length, `${x},${z}`).toBeGreaterThan(0);
        expect(result.matrix[5], `${x},${z}`).toBe(1);
        expect(result.matrix[7], `${x},${z}`).toBe(-16);
        expect(result.matrix.filter((_,i) => ![3,7,11].includes(i))).toEqual(basis.split(" ").map(Number));
      }
    });
  }
  it("reproduces the exact 1x2 on 2x6 connection", () => {
    const model = fixture();
    for (const x of [-2, -1, 0, 1, 2]) for (const z of [-0.5, 0.5]) {
      const result = constructionTransform(model, model.instances[1].id, { x: x + 0.03, y: 0.4, z: z + 0.02 });
      expect(result.contacts.length).toBe(2);
      expect(result.matrix).toEqual([1, 0, 0, x * 20, 0, 1, 0, -16, 0, 0, 1, z * 20]);
    }
  });
  for (const part of ["3023", "3023b", "3024", "3022", "3710", "3020"]) {
    for (const y of [0.4, 0.6, 0.8, 1, 1.2]) {
      it(`places upright ${part} above a 2x6 plate from drag height ${y}`, () => {
        const model = fixture(part);
        const result = constructionTransform(model, model.instances[1].id, { x: 0.03, y, z: 0.52 });
        expect(result.contacts.length).toBeGreaterThan(0);
        expect(result.matrix.slice(0, 3)).toEqual([1, 0, 0]);
        expect(result.matrix[5]).toBe(1);
        expect(result.matrix[7]).toBe(-16);
      });
    }
  }
});
