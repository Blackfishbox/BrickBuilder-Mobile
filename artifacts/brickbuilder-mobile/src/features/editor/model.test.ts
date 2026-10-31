import { describe, expect, it } from "vitest";

import { rotateQuarterTurn, snapPosition } from "./model";

describe("snapPosition", () => {
  it("snaps horizontal positions to half-stud increments", () => {
    expect(snapPosition({ x: 0.26, y: 0, z: -1.24 })).toEqual({
      x: 0.5,
      y: 0,
      z: -1,
    });
  });

  it("snaps vertical placement to brick layers and prevents negative height", () => {
    expect(snapPosition({ x: 0, y: 1.21, z: 0 })).toEqual({
      x: 0,
      y: 1.2,
      z: 0,
    });
    expect(snapPosition({ x: 0, y: -2, z: 0 }).y).toBe(0);
  });
});

describe("rotateQuarterTurn", () => {
  it("advances rotations in quarter turns and wraps to zero", () => {
    expect(rotateQuarterTurn(0)).toBe(90);
    expect(rotateQuarterTurn(270)).toBe(0);
  });
});
