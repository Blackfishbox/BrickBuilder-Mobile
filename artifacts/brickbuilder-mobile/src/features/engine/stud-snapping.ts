import { Box3, Vector3 } from "three";
import type { ImportedModel } from "../formats/types";
import type { Position3 } from "../editor/model";
import { liftOverlaps, stackedPosition, stackingBounds } from "./stacking";
import { studPart, type StudPart } from "./stud-connectors";

export const STUD_SNAP_RADIUS = 0.36;
const VERTICAL_REACH = 0.45, CELL = 4, EPSILON = 1e-5;
interface Entry { id: string; bounds: Box3; part: StudPart | null }
interface ConnectionIndex { parts: Map<string, StudPart>; cells: Map<string, Entry[]>; wide: Entry[] }
const indexes = new WeakMap<ImportedModel, ConnectionIndex>();

function cells(box: Box3, visit: (key: string) => void): void {
  for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++) {
    for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) visit(`${x}:${z}`);
  }
}

function connectionIndex(model: ImportedModel): ConnectionIndex {
  const cached = indexes.get(model);
  if (cached) return cached;
  const index: ConnectionIndex = { parts: new Map(), cells: new Map(), wide: [] };
  const bounds = stackingBounds(model);
  for (const instance of model.instances) {
    const part = studPart(instance), box = part?.body ?? bounds.get(instance.id);
    if (!box || box.isEmpty()) continue;
    if (part) index.parts.set(instance.id, part);
    const entry = { id: instance.id, bounds: box, part };
    const cellCount = (Math.floor(box.max.x / CELL) - Math.floor(box.min.x / CELL) + 1) *
      (Math.floor(box.max.z / CELL) - Math.floor(box.min.z / CELL) + 1);
    if (!Number.isFinite(cellCount) || cellCount > 256) {
      // Huge imported geometry must not allocate millions of spatial buckets.
      index.wide.push(entry); continue;
    }
    cells(box, key => {
      const bucket = index.cells.get(key) ?? [];
      bucket.push(entry); index.cells.set(key, bucket);
    });
  }
  indexes.set(model, index);
  return index;
}

function overlaps(a: Box3, b: Box3): boolean {
  return a.min.x < b.max.x - EPSILON && a.max.x > b.min.x + EPSILON &&
    a.min.y < b.max.y - EPSILON && a.max.y > b.min.y + EPSILON &&
    a.min.z < b.max.z - EPSILON && a.max.z > b.min.z + EPSILON;
}

export interface ConnectionSnap {
  position: Position3;
  supportId: string;
  connections: number;
}

/** Local X/Z search; all candidates are checked for occupied sockets and bodies. */
export function snapStudConnection(model: ImportedModel, id: string, desired: Position3): ConnectionSnap | null {
  const index = connectionIndex(model), moving = index.parts.get(id);
  if (!moving) return null;
  const delta = new Vector3(desired.x, desired.y, desired.z).sub(moving.origin);
  const desiredBody = moving.body.clone().translate(delta);
  const nearby = new Set<Entry>();
  for (const entry of index.wide) if (entry.id !== id) nearby.add(entry);
  cells(desiredBody.clone().expandByScalar(STUD_SNAP_RADIUS), key => {
    for (const entry of index.cells.get(key) ?? []) if (entry.id !== id) nearby.add(entry);
  });
  // Follow an intersected stack upward, but do not teleport onto an unrelated
  // overhead model. Reviewed rectangular bodies exclude the mating stud volume.
  const neighbours = [...nearby];
  const raisedBottom = desiredBody.min.y + liftOverlaps(desiredBody, neighbours.map(entry => entry.bounds));
  const candidateShifts = new Set<string>();
  let best: ConnectionSnap | null = null, bestScore = Infinity;
  for (const entry of nearby) {
    const target = entry.part;
    if (!target || target.origin.y < desiredBody.min.y - VERTICAL_REACH ||
      target.origin.y > raisedBottom + VERTICAL_REACH) continue;
    for (const stud of target.studs) {
      for (const socket of moving.studs) {
        const dx = stud.x - (socket.x + delta.x), dz = stud.z - (socket.z + delta.z);
        const distance = Math.hypot(dx, dz);
        if (distance > STUD_SNAP_RADIUS) continue;
        const position = {
          x: stud.x - (socket.x - moving.origin.x),
          y: target.origin.y + moving.height,
          z: stud.z - (socket.z - moving.origin.z),
        };
        const key = `${position.x.toFixed(6)}:${position.y.toFixed(6)}:${position.z.toFixed(6)}`;
        if (candidateShifts.has(key)) continue;
        candidateShifts.add(key);
        const shift = new Vector3(position.x, position.y, position.z).sub(moving.origin);
        const body = moving.body.clone().translate(shift);
        if (neighbours.some(other => overlaps(body, other.bounds))) continue;
        let connections = 0, incompatible = false;
        for (const other of nearby) {
          const support = other.part;
          if (!support || support.origin.y < body.min.y - 0.2 + EPSILON || support.origin.y > body.min.y + EPSILON) continue;
          // Studs penetrating a known underside must meet actual socket centers.
          for (const point of support.studs) {
            const edgeX = Math.max(body.min.x, Math.min(body.max.x, point.x));
            const edgeZ = Math.max(body.min.z, Math.min(body.max.z, point.z));
            if (Math.hypot(edgeX - point.x, edgeZ - point.z) >= 0.3 - EPSILON) continue;
            if (Math.abs(support.origin.y - body.min.y) > EPSILON ||
              !moving.studs.some(socket => Math.hypot(socket.x + shift.x - point.x, socket.z + shift.z - point.z) < EPSILON)) {
              incompatible = true; break;
            }
            connections++;
          }
          if (incompatible) break;
        }
        if (incompatible || connections === 0) continue;
        const score = distance + Math.abs(position.y - desired.y) * 0.05 - Math.min(connections, 20) * 0.0001;
        if (score < bestScore) {
          bestScore = score; best = { position, supportId: target.id, connections };
        }
      }
    }
  }
  return best;
}

/** No persisted connection state: moving away immediately releases the magnet. */
export function constructionPosition(model: ImportedModel, id: string, desired: Position3): Position3 {
  const snap = snapStudConnection(model, id, desired);
  if (snap) return snap.position;
  return stackedPosition(model, id, { ...desired, x: Math.round(desired.x * 2) / 2, z: Math.round(desired.z * 2) / 2 });
}
