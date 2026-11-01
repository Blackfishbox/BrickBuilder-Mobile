import { expect, it } from "vitest";
import { connectionFixture, partLine } from "./fixtures";
import { surfacesObstruct } from "./obstruction";
import { compilePart } from "../engine/ldraw-geometry";

it("rejects coincident solids even without non-coplanar surface crossings", () => {
  const model = connectionFixture([partLine("3003"), partLine("3003", 160)].join("\n"));
  // Reuse genuine source triangles in exactly the same pose. A lack of
  // non-coplanar crossings must not permit two overlapping brick bodies.
  const surfaces = compilePart(model, "3003.dat", "16");
  expect(surfaces.length).toBeGreaterThan(0);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] as const;
  expect(surfacesObstruct(model, model.instances[1].id, [...matrix], model.instances[0].id, [])).toBe(true);
});
