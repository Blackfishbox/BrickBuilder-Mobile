import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { floatingParts, legacyBrickBounds } from "./floating";
import type { Brick } from "../editor/model";

const box = (x: number, y: number, z = 0) => new Box3(new Vector3(x, y, z), new Vector3(x + 1, y + 1, z + 1));
describe("floating geometry diagnostics", () => {
  it("finds an entire unsupported assembly, not just its lowest member", () => {
    const boxes = new Map([["base", box(0, 0)], ["top", box(0, 1)], ["air", box(3, 2)], ["air-top", box(3, 3)]]);
    expect([...floatingParts(boxes, 0).keys()]).toEqual(["air", "air-top"]);
  });
  it("propagates ground support through horizontal contacts in any insertion order", () => {
    const boxes = new Map([["overhang", box(1, 1)], ["upper", box(0, 1)], ["ground", box(0, 0)]]);
    expect(floatingParts(boxes, 0).size).toBe(0);
    boxes.delete("ground");
    expect([...floatingParts(boxes, 0).keys()]).toEqual(["overhang", "upper"]);
    boxes.set("ground", box(0, 0));
    expect(floatingParts(boxes, 0).size).toBe(0);
  });
  it("does not mistake a small fine-adjustment gap for contact", () => {
    expect(floatingParts(new Map([["a", box(0, 0)], ["b", box(0, 1.05)]]), 0).has("b")).toBe(true);
    expect(floatingParts(new Map([["a", box(0, 0)], ["b", box(0, 1.00001)]]), 0).size).toBe(0);
  });
  it("respects the preserved negative floor of imported models", () => {
    expect([...floatingParts(new Map([["a", box(0, -4)], ["b", box(4, -2)]]), -4).keys()]).toEqual(["b"]);
  });
  it("handles oversized baseplates and empty geometries without giant spatial allocations", () => {
    const large = new Box3(new Vector3(-1000, -1, -1000), new Vector3(1000, 0, 1000));
    for (const boxes of [
      new Map([["large", large], ["top", box(0, 0)], ["empty", new Box3()]]),
      new Map([["top", box(0, 0)], ["large", large]]),
    ]) expect(floatingParts(boxes, -1).size).toBe(0);
  });
  it("checks legacy bricks with their rotation and body height", () => {
    const brick: Brick = { id: "a", type: "brick-1x2", color: "#fff", rotation: 90, x: 0, y: 0, z: 0 };
    const bounds = legacyBrickBounds([brick]).get("a")!;
    expect(bounds.min.x).toBeCloseTo(-1);
    expect(bounds.min.z).toBeCloseTo(-0.5);
    expect(bounds.max.y).toBe(1.2);
    expect(floatingParts(legacyBrickBounds([brick, { ...brick, id: "b", x: 4, y: 1.2 }]), 0).has("b")).toBe(true);
  });
  it("handles a large separated model without all-pairs contact work", () => {
    const boxes = new Map(Array.from({ length: 6000 }, (_, i) => [String(i), box((i % 100) * 4, 2, Math.floor(i / 100) * 4)]));
    expect(floatingParts(boxes, 0).size).toBe(6000);
  });
});
