import { Box3, Vector3 } from "three";
import type { ImportedInstance } from "../formats/types";

export interface StudDefinition {
  /** Stud count along the LDraw X / Z axes, body height in LDU. */
  x: number;
  z: number;
  height: number;
}

// Historical geometry fixtures only, not the engine's coverage boundary.
// Production connection descriptions live in ../connections/description.ts.
// Explicit first-party connection descriptions, checked against the original
// files in the two bundled LDraw packages. No BrickLink-ID guessing or suffix
// stripping: printed, hollow-stud and other variants require their own review.
export const STUD_PARTS: Readonly<Record<string, StudDefinition>> = {
  "3001": { x: 4, z: 2, height: 24 },
  "3002": { x: 3, z: 2, height: 24 },
  "3003": { x: 2, z: 2, height: 24 },
  "3004": { x: 2, z: 1, height: 24 },
  "3005": { x: 1, z: 1, height: 24 },
  "3006": { x: 10, z: 2, height: 24 },
  "3020": { x: 4, z: 2, height: 8 },
  "3021": { x: 3, z: 2, height: 8 },
  "3022": { x: 2, z: 2, height: 8 },
  "3023": { x: 2, z: 1, height: 8 },
  "3023b": { x: 2, z: 1, height: 8 },
  "3024": { x: 1, z: 1, height: 8 },
  "3710": { x: 4, z: 1, height: 8 },
};

export interface StudPart {
  id: string;
  origin: Vector3;
  height: number;
  body: Box3;
  /** Top studs; matching underside sockets have identical X/Z and Y-height. */
  studs: Vector3[];
}

export function studPart(instance: ImportedInstance): StudPart | null {
  const reference = instance.reference.replace(/\\/g, "/").toLowerCase().replace(/^parts\//, "");
  const definition = STUD_PARTS[reference.replace(/\.dat$/, "")];
  if (!definition || instance.part.status !== "resolved") return null;
  const m = instance.matrix, close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // Only unscaled, upright, non-reflected quarter-turns are reviewed here.
  if (![m[1], m[4], m[6], m[9]].every(value => close(value, 0)) || !close(m[5], 1) ||
    ![m[0], m[2], m[8], m[10]].every(value => close(value, Math.round(value)) && Math.abs(value) <= 1.000001) ||
    !close(m[0] ** 2 + m[8] ** 2, 1) || !close(m[2] ** 2 + m[10] ** 2, 1) ||
    !close(m[0] * m[10] - m[2] * m[8], 1)) return null;
  const origin = new Vector3(m[3] / 20, -m[7] / 20, m[11] / 20);
  const height = definition.height / 20, studs: Vector3[] = [], body = new Box3();
  for (const x of [-definition.x / 2, definition.x / 2]) {
    for (const z of [-definition.z / 2, definition.z / 2]) {
      body.expandByPoint(new Vector3(origin.x + m[0] * x + m[2] * z, origin.y, origin.z + m[8] * x + m[10] * z));
    }
  }
  body.min.y -= height;
  for (let x = 0; x < definition.x; x++) {
    for (let z = 0; z < definition.z; z++) {
      const dx = x - (definition.x - 1) / 2, dz = z - (definition.z - 1) / 2;
      studs.push(new Vector3(origin.x + m[0] * dx + m[2] * dz, origin.y, origin.z + m[8] * dx + m[10] * dz));
    }
  }
  return { id: instance.id, origin, height, body, studs };
}
