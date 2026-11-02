import { expect, it } from "vitest";
import { groundedTransform, modelGround } from "./positioning";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel, Affine } from "../formats/types";
import { localPartBounds } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";

function fixture(): ImportedModel {
  const sourceText = "1 4 0 0 0 1 0 0 0 1 0 0 0 1 test.dat";
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", originalBytes: [], sourceText,
    ...parseLDraw(sourceText), legalDocuments: [], resources: {
      "parts/test.dat": {
        path: "parts/test.dat", sourceUrl: "https://example.invalid/test.dat", author: "Synthetic fixture", license: "CC0-1.0",
        content: "0 Synthetic bounding fixture\n4 16 -20 0 -10 20 0 -10 20 24 10 -20 24 10",
      },
    },
  };
  model.instances[0].part.status = "resolved";
  return model;
}
it("keeps the entire part above ground, not just its LDraw pivot", () => {
  const model = fixture();
  const matrix = groundedTransform(model, model.instances[0].id, { x: 0.23, y: -3, z: 0.17 }, 0);
  const box = localPartBounds(model, "test.dat").clone().applyMatrix4(worldMatrix(matrix));
  expect(box.min.y).toBeCloseTo(0);
  expect(matrix[7]).toBeCloseTo(-24);
  expect(matrix[3]).toBeCloseTo(4.6);
  expect(matrix[11]).toBeCloseTo(3.4);
});
it("uses the transformed bottom of rotated/reflected parts without changing their basis", () => {
  const model = fixture();
  for (const basis of [
    [0, -1, 0, 7.3, 1, 0, 0, 80, 0, 0, 1, -2.1],
    [-1, 0, 0, 7.3, 0, -1, 0, 80, 0, 0, 1, -2.1],
  ]) {
    const transform = basis as Affine;
    const matrix = groundedTransform(model, model.instances[0].id, { x: 0, y: 0, z: 0 }, 0, transform);
    expect(localPartBounds(model, "test.dat").clone().applyMatrix4(worldMatrix(matrix)).min.y).toBeCloseTo(0);
    expect(matrix.filter((_, i) => i !== 7)).toEqual(transform.filter((_, i) => i !== 7));
  }
});
it("preserves negative imported origins using the original visible floor", () => {
  const model = fixture(), original = [...model.instances[0].matrix];
  const floor = modelGround(model);
  expect(floor).toBeCloseTo(-1.2);
  const matrix = groundedTransform(model, model.instances[0].id, { x: 0, y: -0.4, z: 0 }, floor);
  expect(matrix[7]).toBeCloseTo(0);
  expect(model.instances[0].matrix).toEqual(original);
});
