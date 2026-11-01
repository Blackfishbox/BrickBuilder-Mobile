import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { liftOverlaps, stackedPosition, stackingBounds } from "./stacking";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";

const box = (x: number, y: number, z: number, height = 1.2) =>
  new Box3(new Vector3(x, y, z), new Vector3(x + 1, y + height, z + 1));

describe("conservative automatic stacking", () => {
  it("raises overlapping parts above a stack", () => {
    expect(liftOverlaps(box(0, 0, 0), [box(0, 1.2, 0), box(0, 0, 0)])).toBeCloseTo(2.4);
  });
  it("removes the temporary lift after moving away", () => {
    const obstacles = [box(0, 0, 0)];
    expect(liftOverlaps(box(0, 0, 0), obstacles)).toBeCloseTo(1.2);
    expect(liftOverlaps(box(2, 0, 0), obstacles)).toBe(0);
  });
  it("does not raise touching edges or parts that are already above", () => {
    expect(liftOverlaps(box(1, 0, 0), [box(0, 0, 0)])).toBe(0);
    expect(liftOverlaps(box(0, 1.2, 0), [box(0, 0, 0)])).toBe(0);
  });
  it("does not jump onto unrelated overhead parts", () => {
    expect(liftOverlaps(box(0, 0, 0), [box(0, 5, 0)])).toBe(0);
  });
  it("preserves source matrices and handles LDraw downward Y coordinates", () => {
    const sourceText = "0 Fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat\n1 4 40 0 0 1 0 0 0 1 0 0 0 1 test.dat\n";
    const model: ImportedModel = {
      version: 1, format: "ldr", sourceName: "fixture.ldr", sourceText,
      originalBytes: [], ...parseLDraw(sourceText), legalDocuments: [],
      resources: { "parts/test.dat": {
        path: "parts/test.dat", author: "Synthetic fixture", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
        content: "0 Synthetic bounding triangles\n3 16 0 0 0 20 0 20 0 -24 0\n",
      } },
    };
    model.instances.forEach(value => { value.part.status = "resolved"; });
    const id = model.instances[1].id;
    const original = JSON.stringify(model);
    expect(stackedPosition(model, id, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1.2);
    expect(stackedPosition(model, id, { x: 2, y: 0, z: 0 }).y).toBe(0);
    expect(stackingBounds(model)).toBe(stackingBounds(model));
    expect(JSON.stringify(model)).toBe(original);
  });
});
