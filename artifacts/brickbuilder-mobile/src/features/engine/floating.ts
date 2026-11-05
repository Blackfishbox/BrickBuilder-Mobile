import { Box3, Matrix4, Vector3 } from "three";
import { BRICK_DEFINITIONS, BRICK_HEIGHT, type Brick } from "../editor/model";

const CONTACT_TOLERANCE = 0.005; // 0.1 LDU: numerical tolerance, not a snapping radius.
const CELL = 4;

/** Conservative geometric contact graph, not a connector or structural-strength proof.
 * Spatial buckets avoid all-pairs comparisons for ordinary large models.
 * A whole disconnected assembly floats, not just its bottom-most member.
 */
export function floatingParts(boxes: ReadonlyMap<string, Box3>, floor: number): Map<string, Box3> {
  const entries = [...boxes].filter(([, box]) => !box.isEmpty());
  const parent = entries.map((_, i) => i), grounded = entries.map(([, b]) => b.min.y <= floor + CONTACT_TOLERANCE);
  const root = (index: number): number => {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  };
  const join = (a: number, b: number) => {
    a = root(a); b = root(b);
    if (a !== b) { parent[b] = a; grounded[a] ||= grounded[b]; }
  };
  const buckets = new Map<string, number[]>(), wide: number[] = [];
  const expanded = new Box3();
  entries.forEach(([, box], index) => {
    expanded.copy(box).expandByScalar(CONTACT_TOLERANCE);
    const lo = expanded.min.clone().divideScalar(CELL).floor(), hi = expanded.max.clone().divideScalar(CELL).floor();
    const volume = (hi.x - lo.x + 1) * (hi.y - lo.y + 1) * (hi.z - lo.z + 1);
    const candidates = new Set(wide), keys: string[] = [];
    if (volume <= 512) {
      for (let x = lo.x; x <= hi.x; x++) for (let y = lo.y; y <= hi.y; y++) for (let z = lo.z; z <= hi.z; z++) {
        const key = `${x}:${y}:${z}`; keys.push(key);
        for (const other of buckets.get(key) ?? []) candidates.add(other);
      }
    } else {
      // Large baseplates/long beams must not populate millions of cells.
      for (let other = 0; other < index; other++) candidates.add(other);
    }
    for (const other of candidates) if (expanded.intersectsBox(entries[other][1])) join(index, other);
    if (volume > 512) wide.push(index);
    else for (const key of keys) {
      const bucket = buckets.get(key) ?? []; bucket.push(index); buckets.set(key, bucket);
    }
  });
  return new Map(entries.filter((_, index) => !grounded[root(index)]));
}

export function legacyBrickBounds(bricks: Brick[]): Map<string, Box3> {
  return new Map(bricks.map(brick => {
    const definition = BRICK_DEFINITIONS[brick.type];
    const box = new Box3(
      new Vector3(-definition.studsX / 2, 0, -definition.studsZ / 2),
      new Vector3(definition.studsX / 2, BRICK_HEIGHT, definition.studsZ / 2),
    );
    box.applyMatrix4(new Matrix4().makeRotationY(brick.rotation * Math.PI / 180));
    box.translate(new Vector3(brick.x, brick.y, brick.z));
    return [brick.id, box];
  }));
}
