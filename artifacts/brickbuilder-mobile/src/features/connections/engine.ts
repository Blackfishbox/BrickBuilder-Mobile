import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import type { Affine, ImportedInstance, ImportedModel } from "../formats/types";
import type { Position3 } from "../editor/model";
import { stackingBounds, localPartBounds, liftOverlaps } from "../engine/stacking";
import { worldMatrix } from "../engine/ldraw-geometry";
import { affine, describeConnections, matrix4, transformConnector } from "./description";
import { axes, intervals, potentialPair, profileOverlap } from "./profiles";
import type { Connector, Contact, ConnectionTransform } from "./types";
import { matingVolume, surfacesObstruct } from "./obstruction";

const CELL = 80, REACH = 7.2, EPS = 1e-4, MAX_CONTACTS = 64;
interface Entry { id: string; instance: ImportedInstance; connectors: Connector[]; box: Box3 }
interface Index { entries: Map<string, Entry>; cells: Map<string, Set<Entry>>; wide: Entry[] }
const indexes = new WeakMap<ImportedModel, Index>();
const selectedCache = new WeakMap<ImportedModel, Map<string, Contact[]>>();
const lduPoint = (p: Vector3): [number, number, number] => [p.x / 20, -p.y / 20, p.z / 20];
function buckets(box: Box3, visit: (key: string) => void): void {
  for (let x = Math.floor(box.min.x / CELL); x <= Math.floor(box.max.x / CELL); x++)
    for (let y = Math.floor(box.min.y / CELL); y <= Math.floor(box.max.y / CELL); y++)
      for (let z = Math.floor(box.min.z / CELL); z <= Math.floor(box.max.z / CELL); z++) visit(`${x}:${y}:${z}`);
}
function indexFor(model: ImportedModel): Index {
  const cached = indexes.get(model); if (cached) return cached;
  const index: Index = { entries: new Map(), cells: new Map(), wide: [] };
  for (const instance of model.instances) {
    const connectors = instance.part.status === "resolved" ? describeConnections(instance.reference, model).connectors
      .map(c => transformConnector(c, instance.matrix)).filter((c): c is Connector => !!c) : [];
    const box = new Box3();
    for (const c of connectors) {
      const { position, y } = axes(c);
      box.expandByPoint(position);
      box.expandByPoint(position.clone().addScaledVector(y, c.centered ? c.length / 2 : 0));
      box.expandByPoint(position.clone().addScaledVector(y, c.centered ? -c.length / 2 : -c.length));
    }
    const entry = { id: instance.id, instance, connectors, box };
    index.entries.set(instance.id, entry);
    if (box.isEmpty()) continue;
    const size = box.getSize(new Vector3()).divideScalar(CELL).addScalar(2);
    if (size.x * size.y * size.z > 512) index.wide.push(entry);
    else buckets(box, key => { const set = index.cells.get(key) ?? new Set(); set.add(entry); index.cells.set(key, set); });
  }
  indexes.set(model, index); return index;
}
function neighbours(index: Index, box: Box3, id: string): Entry[] {
  const result = new Set<Entry>(index.wide.filter(e => e.id !== id));
  const size = box.getSize(new Vector3()).divideScalar(CELL).addScalar(2);
  // An enormous or malformed part is not a reason to scan the entire model.
  if (size.x * size.y * size.z > 1024) return [...result];
  buckets(box, key => { for (const entry of index.cells.get(key) ?? []) if (entry.id !== id) result.add(entry); });
  return [...result];
}
function contact(a: Connector, b: Connector, movingId: string, targetId: string, state: Contact["state"]): Contact | null {
  if (!potentialPair(a, b)) return null;
  const aa = axes(a), bb = axes(b), delta = aa.position.clone().sub(bb.position);
  const offset = delta.dot(bb.y), direction = aa.y.dot(bb.y);
  if (a.family === "generic" && a.placement === "free" && b.placement === "free") {
    if (delta.length() > EPS) return null;
  } else {
    if (Math.abs(direction) < 1 - EPS || delta.addScaledVector(bb.y, -offset).length() > EPS ||
      !profileOverlap(a, b, offset, direction > 0 ? 1 : -1, aa.x.dot(bb.x))) return null;
    if (a.family === "generic" && aa.x.dot(bb.x) < 1 - EPS) return null;
  }
  const ai = intervals(a), bi = intervals(b);
  const center = bb.position.clone();
  if (ai.length && bi.length) {
    const lo = Math.max(...[Math.min(...ai.map(s => Math.min(s.lo * direction, s.hi * direction) + offset)), Math.min(...bi.map(s => s.lo))]);
    const hi = Math.min(...[Math.max(...ai.map(s => Math.max(s.lo * direction, s.hi * direction) + offset)), Math.max(...bi.map(s => s.hi))]);
    center.addScaledVector(bb.y, (lo + hi) / 2);
  }
  return { id: `${movingId}|${a.id}|${targetId}|${b.id}`, movingId, movingConnectorId: a.id,
    targetId, targetConnectorId: b.id, position: lduPoint(center), orientation: b.frame, family: a.family === "cylinder" ? b.family : a.family,
    state, evidence: [a.evidence, b.evidence] };
}
function occupied(index: Index, target: Connector, targetId: string, movingId: string, proposed?: Connector): boolean {
  const query = new Box3().setFromPoints([axes(target).position]).expandByScalar(target.length + REACH);
  for (const entry of neighbours(index, query, targetId)) {
    if (entry.id === movingId) continue;
    for (const c of entry.connectors) if (contact(c, target, entry.id, targetId, "verified")) {
      if (!proposed || target.family === "generic" || target.family === "fingers") return true;
      const inverse = matrix4(target.frame).invert();
      const range = (connector: Connector) => {
        const m = matrix4(connector.frame).premultiply(inverse);
        const ys = intervals(connector).flatMap(s => [new Vector3(0, s.lo, 0).applyMatrix4(m).y, new Vector3(0, s.hi, 0).applyMatrix4(m).y]);
        return [Math.min(...ys), Math.max(...ys)];
      };
      const a = range(c), b = range(proposed);
      if (Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > EPS) return true;
    }
  }
  return false;
}
function positiveOverlap(a: Box3, b: Box3): boolean {
  return a.min.x < b.max.x - EPS && a.max.x > b.min.x + EPS && a.min.y < b.max.y - EPS &&
    a.max.y > b.min.y + EPS && a.min.z < b.max.z - EPS && a.max.z > b.min.z + EPS;
}
/** Mating volumes are explicitly exempted, never an entire counterpart part.
 * The broad-phase intersection must lie in the connector's axial insertion
 * slab. Non-stud intersections are additionally confined to its radial box.
 * Third-party obstructions never receive this exemption.
 */
function obstructed(model: ImportedModel, id: string, proposed: Affine, contacts: Contact[], moving: Connector[], nearby: Entry[], floor = -Infinity): boolean {
  const instance = indexFor(model).entries.get(id)!.instance;
  const boxes = stackingBounds(model), source = boxes.get(id);
  if (!source) return true;
  const toLdu = new Matrix4().makeScale(20, -20, 20);
  const moved = localPartBounds(model, instance.reference).clone().applyMatrix4(worldMatrix(proposed));
  if (moved.min.y < floor - EPS) return true;
  // Bounds use a separate cached spatial index so parts without connectors
  // remain obstacles, without walking every part on each pointer event.
  const obstacleIndex = boundsIndex(model);
  const candidates = new Set<string>(obstacleIndex.wide);
  const lduBox = moved.clone().applyMatrix4(toLdu).expandByScalar(REACH);
  const size = lduBox.getSize(new Vector3()).divideScalar(CELL).addScalar(2);
  if (size.x * size.y * size.z > 1024) return true;
  buckets(lduBox, key => { for (const other of obstacleIndex.cells.get(key) ?? []) candidates.add(other); });
  for (const otherId of candidates) {
    if (otherId === id) continue;
    const other = boxes.get(otherId);
    if (!other || !positiveOverlap(moved, other)) continue;
    const intersection = moved.clone().intersect(other).applyMatrix4(toLdu);
    const allowed = contacts.filter(c => c.targetId === otherId);
    if (!allowed.length) return true;
    const slabs = allowed.map(c => {
      const a = moving.find(v => v.id === c.movingConnectorId)!;
      const b = nearby.find(v => v.id === otherId)?.connectors.find(v => v.id === c.targetConnectorId)!;
      const inv = matrix4(b.frame).invert(), localA = matrix4(a.frame).premultiply(inv);
      const ys = intervals(a).flatMap(s => [new Vector3(0, s.lo, 0).applyMatrix4(localA).y, new Vector3(0, s.hi, 0).applyMatrix4(localA).y]);
      const bs = intervals(b), low = Math.max(Math.min(...ys), Math.min(...bs.map(s => s.lo))), high = Math.min(Math.max(...ys), Math.max(...bs.map(s => s.hi)));
      const local = intersection.clone().applyMatrix4(inv);
      const radius = Math.max(a.radius, b.radius, ...a.sections.map(s => s.radius), ...b.sections.map(s => s.radius), 0) + 0.1;
      // Repeated ordinary antistuds use S6 holes; the slab is the stud layer,
      // not a body-wide exception for Technic/clip/generic insertion.
      const male = a.gender === "M" ? a : b;
      const stud = male.clearId === "studC" && male.length === 4 && a.family === "cylinder" && b.family === "cylinder";
      if (!bs.length || !ys.length) {
        // Generic bounding boxes describe an explicit mating volume.
        const bound = b.bounding.split(/\s+/), ns = bound.slice(1).map(Number);
        const ext = bound[0] === "box" ? ns : bound[0] === "cyl" ? [ns[0], ns[1] / 2, ns[0]] : [ns[0], ns[0], ns[0]];
        return ext.length === 3 && ext.every(Number.isFinite) && local.min.toArray().every((n, i) => n >= -ext[i] - EPS) && local.max.toArray().every((n, i) => n <= ext[i] + EPS);
      }
      return local.min.y >= low - EPS && local.max.y <= high + EPS &&
        (stud || local.min.x >= -radius && local.max.x <= radius && local.min.z >= -radius && local.max.z <= radius);
    });
    if (!slabs.some(Boolean)) {
      const volumes = allowed.map(c => matingVolume(moving.find(v => v.id === c.movingConnectorId)!,
        nearby.find(e => e.id === otherId)!.connectors.find(v => v.id === c.targetConnectorId)!));
      if (surfacesObstruct(model, id, proposed, otherId, volumes)) return true;
    }
  }
  return false;
}
const boundsCaches = new WeakMap<ImportedModel, { cells: Map<string, string[]>; columns: Map<string, string[]>; wide: string[]; floor: number }>();
function boundsIndex(model: ImportedModel) {
  const old = boundsCaches.get(model); if (old) return old;
  const index = { cells: new Map<string, string[]>(), columns: new Map<string, string[]>(), wide: [] as string[], floor: 0 };
  for (const [id, box] of stackingBounds(model)) {
    index.floor = Math.min(index.floor, box.min.y);
    const b = box.clone().applyMatrix4(new Matrix4().makeScale(20, -20, 20));
    const size = b.getSize(new Vector3()).divideScalar(CELL).addScalar(2);
    if (size.x * size.y * size.z > 512) index.wide.push(id);
    else {
      buckets(b, key => { const ids = index.cells.get(key) ?? []; ids.push(id); index.cells.set(key, ids); });
      for (let x = Math.floor(b.min.x / CELL); x <= Math.floor(b.max.x / CELL); x++)
        for (let z = Math.floor(b.min.z / CELL); z <= Math.floor(b.max.z / CELL); z++) {
          const key = `${x}:${z}`, ids = index.columns.get(key) ?? []; ids.push(id); index.columns.set(key, ids);
        }
    }
  }
  boundsCaches.set(model, index); return index;
}
function localStackedPosition(model: ImportedModel, id: string, desired: Position3): Position3 {
  const entry = indexFor(model).entries.get(id);
  const source = stackingBounds(model).get(id);
  const instance = entry?.instance;
  if (!entry || !source || !instance) return desired;
  const moved = source.clone().translate(new Vector3(desired.x - instance.matrix[3] / 20, desired.y + instance.matrix[7] / 20, desired.z - instance.matrix[11] / 20));
  const bounds = boundsIndex(model), ids = new Set(bounds.wide);
  const loX = Math.floor(moved.min.x * 20 / CELL), hiX = Math.floor(moved.max.x * 20 / CELL);
  const loZ = Math.floor(moved.min.z * 20 / CELL), hiZ = Math.floor(moved.max.z * 20 / CELL);
  if ((hiX - loX + 1) * (hiZ - loZ + 1) > 1024) return desired;
  for (let x = loX; x <= hiX; x++) for (let z = loZ; z <= hiZ; z++)
    for (const otherId of bounds.columns.get(`${x}:${z}`) ?? []) if (otherId !== id) ids.add(otherId);
  ids.delete(id);
  const boxes = stackingBounds(model);
  return { ...desired, y: desired.y + liftOverlaps(moved, [...ids].map(other => boxes.get(other)!).filter(Boolean)) };
}
function allContacts(moving: Connector[], nearby: Entry[], id: string, state: Contact["state"]): Contact[] {
  const result: Contact[] = [];
  for (const entry of nearby) for (const a of moving) for (const b of entry.connectors) {
    const c = contact(a, b, id, entry.id, state);
    if (c) result.push(c);
    if (result.length >= MAX_CONTACTS) return result;
  }
  return result;
}
/** Committed contacts are derived from current transforms, never a last-snap flag. */
export function activeConnections(model: ImportedModel, id: string): Contact[] {
  const cache = selectedCache.get(model) ?? new Map<string, Contact[]>(); selectedCache.set(model, cache);
  const old = cache.get(id); if (old) return old;
  const index = indexFor(model), entry = index.entries.get(id);
  if (!entry || entry.box.isEmpty()) return [];
  const near = neighbours(index, entry.box.clone().expandByScalar(REACH), id);
  const matched = allContacts(entry.connectors, near, id, "verified");
  const result = matched.filter(c => {
    const target = near.find(e => e.id === c.targetId)!.connectors.find(v => v.id === c.targetConnectorId)!;
    const source = entry.connectors.find(v => v.id === c.movingConnectorId)!;
    return !occupied(index, target, c.targetId, id, source);
  });
  const instance = entry.instance;
  if (instance && result.length && obstructed(model, id, instance.matrix, result, entry.connectors, near)) result.length = 0;
  cache.set(id, result); return result;
}
export function hasUsableConnections(model: ImportedModel, id: string): boolean {
  return !!indexFor(model).entries.get(id)?.connectors.length && stackingBounds(model).has(id);
}

export function snapConnection(model: ImportedModel, id: string, desired: Position3): ConnectionTransform | null {
  const index = indexFor(model), original = index.entries.get(id), instance = original?.instance;
  if (!instance) return null;
  if (!original?.connectors.length) return null;
  const desiredMatrix = [...instance.matrix] as Affine;
  desiredMatrix[3] = desired.x * 20; desiredMatrix[7] = -desired.y * 20; desiredMatrix[11] = desired.z * 20;
  const local = describeConnections(instance.reference, model).connectors;
  let floor: number;
  try { floor = Math.min(boundsIndex(model).floor, localPartBounds(model, instance.reference).clone().applyMatrix4(worldMatrix(desiredMatrix)).min.y); }
  catch { return null; } // Import diagnostics own missing/invalid source geometry.
  const moving = local.map(c => transformConnector(c, desiredMatrix)).filter((c): c is Connector => !!c);
  const shift = new Vector3(desiredMatrix[3] - instance.matrix[3], desiredMatrix[7] - instance.matrix[7], desiredMatrix[11] - instance.matrix[11]);
  const query = original.box.clone().translate(shift).expandByScalar(REACH);
  // Preserve collision-driven lifting for ordinary top-down dragging. Search
  // the raised destination as well, but never an unrelated overhead assembly.
  const raised = localStackedPosition(model, id, desired);
  query.expandByPoint(new Vector3(desired.x * 20, -raised.y * 20, desired.z * 20));
  const near = neighbours(index, query, id);
  let best: ConnectionTransform | null = null, score = Infinity;
  const tried = new Set<string>();
  for (const a of moving) for (const entry of near) for (const b of entry.connectors) {
    if (!potentialPair(a, b)) continue;
    const aa = axes(a), bb = axes(b), distance = aa.position.distanceTo(bb.position);
    const planar = aa.position.clone().sub(bb.position); planar.addScaledVector(bb.y, -planar.dot(bb.y));
    if (planar.length() > REACH) continue;
    if (distance > Math.max(a.length, b.length) + REACH + Math.abs(raised.y - desired.y) * 20) continue;
    for (const direction of [1, -1]) {
      let rotation: Matrix4;
      if (a.family === "generic" && a.placement === "free" && b.placement === "free") rotation = new Matrix4();
      else if (a.family === "generic") {
        rotation = matrix4(b.frame).setPosition(0, 0, 0).multiply(matrix4(a.frame).setPosition(0, 0, 0).invert());
      } else rotation = new Matrix4().makeRotationFromQuaternion(new Quaternion().setFromUnitVectors(aa.y, bb.y.clone().multiplyScalar(direction)));
      if (a.sections.some(s => ["A", "S"].includes(s.shape)) && b.sections.some(s => ["A", "S"].includes(s.shape))) {
        const x = aa.x.clone().transformDirection(rotation);
        const angle = Math.atan2(bb.y.dot(x.clone().cross(bb.x)), x.dot(bb.x));
        const correction = angle - Math.round(angle / (Math.PI / 2)) * Math.PI / 2;
        rotation.premultiply(new Matrix4().makeRotationAxis(bb.y, correction));
      }
      const offsets = new Set<number>();
      const ai = intervals(a), bi = intervals(b);
      if (a.family === "generic") offsets.add(0);
      else {
        for (const x of ai.flatMap(s => [s.lo * direction, s.hi * direction])) for (const y of bi.flatMap(s => [s.lo, s.hi])) offsets.add(y - x);
        if (a.slide || b.slide) offsets.add(aa.position.clone().sub(bb.position).dot(bb.y));
      }
      for (const offset of offsets) {
        const roll = aa.x.clone().transformDirection(rotation).dot(bb.x);
        if (!profileOverlap(a, b, offset, direction, roll)) continue;
        const wanted = bb.position.clone().addScaledVector(bb.y, offset);
        const delta = wanted.clone().sub(aa.position);
        const horizontal = Math.hypot(delta.x, delta.z), vertical = Math.abs(delta.y);
        if (horizontal > REACH || vertical > REACH + Math.abs(raised.y - desired.y) * 20) continue;
        // Rotate about the moving connector, never the model origin.
        const sourceConnector = local.find(c => c.id === a.id)!;
        const transform = rotation.clone().multiply(matrix4(desiredMatrix).setPosition(0, 0, 0));
        const anchor = new Vector3(sourceConnector.frame[3], sourceConnector.frame[7], sourceConnector.frame[11]).applyMatrix4(transform);
        // Cancel connector-local offsets before adding the target's original
        // translation. (3.4 + 10) - 10 must not mutate an exact imported 3.4.
        const targetSource = describeConnections(entry.instance.reference, model).connectors.find(c => c.id === b.id)!;
        const targetAnchor = new Vector3(targetSource.frame[3], targetSource.frame[7], targetSource.frame[11])
          .applyMatrix4(matrix4(entry.instance.matrix).setPosition(0, 0, 0));
        transform.setPosition(targetAnchor.addScaledVector(bb.y, offset).sub(anchor)
          .add(new Vector3(entry.instance.matrix[3], entry.instance.matrix[7], entry.instance.matrix[11])));
        const matrix = affine(transform), key = matrix.map(n => n.toFixed(5)).join(",");
        if (tried.has(key)) continue; tried.add(key);
        const transformed = local.map(c => transformConnector(c, matrix)).filter((c): c is Connector => !!c);
        const contacts = allContacts(transformed, near, id, "candidate");
        if (!contacts.length || contacts.some(c => {
          const target = near.find(e => e.id === c.targetId)!.connectors.find(v => v.id === c.targetConnectorId)!;
          const source = transformed.find(v => v.id === c.movingConnectorId)!;
          return occupied(index, target, c.targetId, id, source);
        }) || obstructed(model, id, matrix, contacts, transformed, near, floor)) continue;
        const cost = horizontal + Math.abs(matrix[7] + raised.y * 20) * 0.05 +
          (1 - Math.abs(aa.y.dot(bb.y))) * 0.5 - contacts.length * 0.002;
        if (cost < score) { score = cost; best = { matrix, contacts, status: "candidate" }; }
      }
    }
  }
  return best;
}

export function constructionTransform(model: ImportedModel, id: string, desired: Position3): ConnectionTransform {
  const snap = snapConnection(model, id, desired);
  if (snap) return snap;
  const instance = indexFor(model).entries.get(id)!.instance;
  const position = localStackedPosition(model, id, { ...desired, x: Math.round(desired.x * 2) / 2, z: Math.round(desired.z * 2) / 2 });
  const matrix = [...instance.matrix] as Affine;
  matrix[3] = position.x * 20; matrix[7] = -position.y * 20; matrix[11] = position.z * 20;
  return { matrix, contacts: [], status: hasUsableConnections(model, id) ? "unconnected" : "no-data" };
}
