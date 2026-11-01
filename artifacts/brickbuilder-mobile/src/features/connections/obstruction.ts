import { Box3, Plane, Triangle, Vector3 } from "three";
import type { Affine, ImportedModel } from "../formats/types";
import { compilePart, type Surface } from "../engine/ldraw-geometry";
import { matrix4 } from "./description";
import type { Connector } from "./types";
import { intervals } from "./profiles";

interface Face { triangle: Triangle; box: Box3 }
const stationaryCaches = new WeakMap<ImportedModel, Map<string, Face[]>>();
const sourceCaches = new WeakMap<ImportedModel["resources"], Map<string, Surface[]>>();
const EPS = 0.002;
function faces(model: ImportedModel, reference: string, matrix: Affine): Face[] | null {
  const sourceCache = sourceCaches.get(model.resources) ?? new Map<string, Surface[]>(); sourceCaches.set(model.resources, sourceCache);
  const surfaces = sourceCache.get(reference) ?? compilePart(model, reference, "16");
  sourceCache.set(reference, surfaces);
  if (surfaces.reduce((n, s) => n + s.positions.length / 9, 0) > 20000) return null;
  const transform = matrix4(matrix), result: Face[] = [];
  for (const surface of surfaces) for (let i = 0; i < surface.positions.length; i += 9) {
    const vertices = [0, 3, 6].map(offset => new Vector3().fromArray(surface.positions, i + offset).applyMatrix4(transform));
    const triangle = new Triangle(vertices[0], vertices[1], vertices[2]);
    result.push({ triangle, box: new Box3().setFromPoints(vertices) });
  }
  return result;
}
/** Returns actual non-coplanar surface intersection points. Coplanar face
 * touching does not establish solid penetration; another crossing must do so.
 */
function crossings(a: Triangle, b: Triangle): Vector3[] {
  const points: Vector3[] = [], plane = new Plane(), normal = new Vector3();
  for (const [source, target] of [[a, b], [b, a]]) {
    target.getNormal(normal);
    if (normal.lengthSq() < 0.5) continue;
    plane.setFromNormalAndCoplanarPoint(normal, target.a);
    const vs = [source.a, source.b, source.c], distances = vs.map(v => plane.distanceToPoint(v));
    if (distances.every(d => d > EPS) || distances.every(d => d < -EPS) || distances.every(d => Math.abs(d) <= EPS)) continue;
    for (let i = 0; i < 3; i++) {
      const next = (i + 1) % 3, d = distances[i], e = distances[next];
      if (d * e > 0 || Math.abs(d - e) < EPS) continue;
      const t = d / (d - e);
      if (t < -EPS || t > 1 + EPS) continue;
      const point = vs[i].clone().lerp(vs[next], t);
      if (target.containsPoint(point)) points.push(point);
    }
  }
  return points;
}
export function matingVolume(a: Connector, b: Connector): (point: Vector3) => boolean {
  const inverse = matrix4(b.frame).invert(), aToB = matrix4(a.frame).premultiply(inverse);
  if (b.family === "generic") {
    const [kind, ...values] = b.bounding.split(/\s+/), ns = values.map(Number);
    return point => {
      const p = point.clone().applyMatrix4(inverse);
      if (kind === "sph") return p.length() <= ns[0] + EPS;
      if (kind === "cube") return p.toArray().every(n => Math.abs(n) <= ns[0] + EPS);
      if (kind === "box") return p.toArray().every((n, i) => Math.abs(n) <= ns[i] + EPS);
      if (kind === "cyl") return Math.hypot(p.x, p.z) <= ns[0] + EPS && Math.abs(p.y) <= ns[1] / 2 + EPS;
      return p.length() <= EPS;
    };
  }
  const ys = intervals(a).flatMap(s => [new Vector3(0, s.lo, 0).applyMatrix4(aToB).y, new Vector3(0, s.hi, 0).applyMatrix4(aToB).y]);
  const bs = intervals(b), low = Math.max(Math.min(...ys), Math.min(...bs.map(s => s.lo)));
  const high = Math.min(Math.max(...ys), Math.max(...bs.map(s => s.hi)));
  const radius = Math.max(a.radius, b.radius, ...a.sections.map(s => s.radius * (s.shape === "S" ? Math.SQRT2 : 1)), ...b.sections.map(s => s.radius * (s.shape === "S" ? Math.SQRT2 : 1))) + 0.05;
  return point => {
    const p = point.clone().applyMatrix4(inverse);
    return p.y >= low - EPS && p.y <= high + EPS && Math.hypot(p.x, p.z) <= radius;
  };
}

/** Bounded narrow phase for a mating counterpart whose whole-part AABB is too
 * conservative. No geometry is invented or rebuilt for the rest of the model.
 * Budget exhaustion rejects the placement instead of assuming it is clear.
 */
export function surfacesObstruct(model: ImportedModel, movingId: string, matrix: Affine, targetId: string, volumes: Array<(p: Vector3) => boolean>): boolean {
  const moving = model.instances.find(i => i.id === movingId)!, target = model.instances.find(i => i.id === targetId)!;
  const cache = stationaryCaches.get(model) ?? new Map<string, Face[]>(); stationaryCaches.set(model, cache);
  let stationary = cache.get(targetId);
  if (!stationary) {
    const prepared = faces(model, target.reference, target.matrix);
    if (!prepared) return true;
    stationary = prepared; cache.set(targetId, stationary);
  }
  const proposed = faces(model, moving.reference, matrix);
  if (!proposed) return true;
  // Spatial triangle buckets are local to this counterpart, not the model.
  const cells = new Map<string, Face[]>(), wide: Face[] = [];
  const visit = (box: Box3, fn: (key: string) => void) => {
    const min = box.min.clone().divideScalar(10).floor(), max = box.max.clone().divideScalar(10).floor();
    if ((max.x - min.x + 1) * (max.y - min.y + 1) * (max.z - min.z + 1) > 512) return false;
    for (let x = min.x; x <= max.x; x++) for (let y = min.y; y <= max.y; y++) for (let z = min.z; z <= max.z; z++) fn(`${x}:${y}:${z}`);
    return true;
  };
  for (const face of stationary) if (!visit(face.box, key => { const bucket = cells.get(key) ?? []; bucket.push(face); cells.set(key, bucket); })) wide.push(face);
  let tested = 0;
  for (const face of proposed) {
    const candidates = new Set(wide);
    if (!visit(face.box, key => { for (const candidate of cells.get(key) ?? []) candidates.add(candidate); })) return true;
    for (const candidate of candidates) {
      if (!face.box.intersectsBox(candidate.box)) continue;
      if (++tested > 100000) return true;
      const points = crossings(face.triangle, candidate.triangle);
      if (points.some(point => !volumes.some(contains => contains(point)))) return true;
    }
  }
  return false;
}
