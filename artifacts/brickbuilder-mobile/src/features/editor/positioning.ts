import type { Affine, ImportedModel } from "../formats/types";
import type { Position3 } from "./model";
import { localPartBounds, stackingBounds } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";

/** Keep the imported coordinate origin; the viewer raises negative source floors. */
export function modelGround(model: ImportedModel): number {
  let floor = 0;
  for (const box of stackingBounds(model).values()) floor = Math.min(floor, box.min.y);
  return floor;
}

export function groundedTransform(model: ImportedModel, id: string, position: Position3, floor: number, transform?: Affine): Affine {
  if (![position.x, position.y, position.z, floor].every(Number.isFinite)) throw new Error("Ungültige Position.");
  const instance = model.instances.find(value => value.id === id);
  if (!instance) throw new Error("Stein nicht gefunden.");
  const matrix = [...(transform ?? instance.matrix)] as Affine;
  if (matrix.length !== 12 || !matrix.every(Number.isFinite)) throw new Error("Ungültige Transformation.");
  if (!transform) {
    matrix[3] = position.x * 20; matrix[7] = -position.y * 20; matrix[11] = position.z * 20;
  }
  const box = localPartBounds(model, instance.reference).clone().applyMatrix4(worldMatrix(matrix));
  if (box.isEmpty()) throw new Error("Die Unterkante dieses Teils kann ohne Geometrie nicht bestimmt werden.");
  if (box.min.y < floor) matrix[7] -= (floor - box.min.y) * 20;
  return matrix;
}
