import { Box3, Color, Vector3 } from "three";
import type { Affine, ImportedInstance, ImportedModel } from "../formats/types";
import { resolveColor } from "../formats/colors";
import { compilePart, reuseGeometryCache, sameSceneSources, worldMatrix } from "./ldraw-geometry";
import type { SceneBuildOptions } from "./imported-scene";

export const SOFTWARE_TRIANGLE_BUDGET = 32_000;
export const INTERACTIVE_TRIANGLE_BUDGET = 3_000;
export interface SoftwareScene {
  positions: Float32Array;
  colors: string[];
  alpha: Float32Array;
  bounds: Box3;
  sourceTriangles: number;
  triangleCount: number;
  triangleIds: string[];
  instanceBounds: Map<string, Box3>;
  model: ImportedModel;
  records: Map<string, SoftwareRecord>;
  free: number[];
  perInstance: number;
  updates: number;
  transformedTriangles: number;
}
interface SoftwareRecord {
  instance: ImportedInstance;
  slots: number[];
  local: Float32Array;
  codes: string[];
  localBounds: Box3;
  total: number;
}

/** Prepare a bounded preview from real source triangles, not procedural bricks. */
export async function createSoftwareScene(model: ImportedModel, options: SceneBuildOptions = {}): Promise<SoftwareScene> {
  const instances = model.instances.filter(instance => instance.part.status === "resolved");
  const perInstance = Math.max(1, Math.floor(SOFTWARE_TRIANGLE_BUDGET / Math.max(1, instances.length)));
  const positions = new Float32Array(SOFTWARE_TRIANGLE_BUDGET * 9);
  const alpha = new Float32Array(positions.length / 9);
  const colors: string[] = [];
  const triangleIds: string[] = [];
  const instanceBounds = new Map<string, Box3>();
  const bounds = new Box3(), boxes = new Map<string, Box3>();
  const records = new Map<string, SoftwareRecord>();
  const vertex = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  const light = new Vector3(-0.4, 0.8, 0.5).normalize();
  let triangles = 0, sourceTriangles = 0, slice = performance.now();
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    options.signal?.throwIfAborted();
    const instance = instances[instanceIndex];
    const surfaces = compilePart(model, instance.reference, "16");
    const matrix = worldMatrix(instance.matrix);
    let box = boxes.get(instance.reference);
    if (!box) {
      box = new Box3();
      for (const surface of surfaces) {
        for (let i = 0; i < surface.positions.length; i += 3) box.expandByPoint(vertex.fromArray(surface.positions, i));
        for (let i = 0; i < surface.edges.length; i += 3) box.expandByPoint(vertex.fromArray(surface.edges, i));
      }
      boxes.set(instance.reference, box);
    }
    const worldBounds = box.clone().applyMatrix4(matrix);
    bounds.union(worldBounds);
    instanceBounds.set(instance.id, worldBounds);
    const total = surfaces.reduce((sum, surface) => sum + surface.positions.length / 9, 0);
    sourceTriangles += total;
    const count = Math.min(perInstance, total, SOFTWARE_TRIANGLE_BUDGET - triangles);
    const record: SoftwareRecord = { instance, slots: [], local: new Float32Array(count * 9), codes: [], localBounds: box, total };
    records.set(instance.id, record);
    let surfaceIndex = 0, base = 0;
    for (let sample = 0; sample < count && triangles < positions.length / 9; sample++) {
      const index = Math.floor((sample + 0.5) * total / count);
      while (surfaceIndex < surfaces.length - 1 && index >= base + surfaces[surfaceIndex].positions.length / 9) {
        base += surfaces[surfaceIndex++].positions.length / 9;
      }
      const surface = surfaces[surfaceIndex], offset = (index - base) * 9;
      record.local.set(surface.positions.subarray(offset, offset + 9), sample * 9);
      record.codes.push(surface.colorCode);
      record.slots.push(triangles);
      a.fromArray(surface.positions, offset).applyMatrix4(matrix);
      b.fromArray(surface.positions, offset + 3).applyMatrix4(matrix);
      c.fromArray(surface.positions, offset + 6).applyMatrix4(matrix);
      a.toArray(positions, triangles * 9); b.toArray(positions, triangles * 9 + 3); c.toArray(positions, triangles * 9 + 6);
      const normal = vertex.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
      const mapping = resolveColor(surface.colorCode === "16" ? instance.colorCode : surface.colorCode);
      colors.push(new Color(mapping?.hex ?? "#ff00ff").multiplyScalar(0.6 + 0.4 * Math.abs(normal.dot(light))).getStyle());
      triangleIds.push(instance.id);
      alpha[triangles++] = (mapping?.alpha ?? 255) / 255;
    }
    if (performance.now() - slice > 6) {
      options.onProgress?.(instanceIndex + 1, instances.length);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      slice = performance.now();
    }
  }
  return { positions, colors, alpha, bounds, sourceTriangles, triangleCount: triangles, triangleIds, instanceBounds,
    model, records, free: [], perInstance, updates: 0, transformedTriangles: 0 };
}

/** Rewrite only a part's bounded samples, from original local coordinates (no drift). */
export function previewSoftware(scene: SoftwareScene, id: string, matrix: Affine, code?: string): void {
  const record = scene.records.get(id);
  if (!record) return;
  const transform = worldMatrix(matrix), a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3(), edge = new Vector3();
  const light = new Vector3(-0.4, 0.8, 0.5).normalize();
  record.slots.forEach((slot, sample) => {
    a.fromArray(record.local, sample * 9).applyMatrix4(transform);
    b.fromArray(record.local, sample * 9 + 3).applyMatrix4(transform);
    c.fromArray(record.local, sample * 9 + 6).applyMatrix4(transform);
    a.toArray(scene.positions, slot * 9); b.toArray(scene.positions, slot * 9 + 3); c.toArray(scene.positions, slot * 9 + 6);
    normal.copy(b).sub(a).cross(edge.copy(c).sub(a)).normalize();
    const mapping = resolveColor(record.codes[sample] === "16" ? (code ?? record.instance.colorCode) : record.codes[sample]);
    scene.colors[slot] = new Color(mapping?.hex ?? "#ff00ff").multiplyScalar(0.6 + 0.4 * Math.abs(normal.dot(light))).getStyle();
    scene.alpha[slot] = (mapping?.alpha ?? 255) / 255;
    scene.triangleIds[slot] = id;
  });
  scene.instanceBounds.set(id, record.localBounds.clone().applyMatrix4(transform));
  scene.transformedTriangles += record.slots.length;
}
export function restoreSoftware(scene: SoftwareScene, id: string): void {
  const record = scene.records.get(id);
  if (record) previewSoftware(scene, id, record.instance.matrix);
}
export function updateSoftwareScene(scene: SoftwareScene, next: ImportedModel): boolean {
  if (!sameSceneSources(scene.model, next)) return false;
  reuseGeometryCache(scene.model, next);
  // Compile new references before any mutation. Existing bounded samples stay visible on failure.
  const prepared = new Map<string, SoftwareRecord>();
  for (const instance of next.instances) {
    const old = scene.records.get(instance.id);
    if (instance.part.status !== "resolved" || old?.instance.reference === instance.reference) continue;
    const surfaces = compilePart(next, instance.reference, "16"), localBounds = new Box3(), vertex = new Vector3();
    let total = 0;
    for (const surface of surfaces) {
      total += surface.positions.length / 9;
      for (let i = 0; i < surface.positions.length; i += 3) localBounds.expandByPoint(vertex.fromArray(surface.positions, i));
      for (let i = 0; i < surface.edges.length; i += 3) localBounds.expandByPoint(vertex.fromArray(surface.edges, i));
    }
    const count = Math.min(total, scene.perInstance);
    const local = new Float32Array(count * 9), codes: string[] = [];
    let surfaceIndex = 0, base = 0;
    for (let sample = 0; sample < count; sample++) {
      const index = Math.floor((sample + 0.5) * total / count);
      while (surfaceIndex < surfaces.length - 1 && index >= base + surfaces[surfaceIndex].positions.length / 9) base += surfaces[surfaceIndex++].positions.length / 9;
      const surface = surfaces[surfaceIndex], offset = (index - base) * 9;
      local.set(surface.positions.subarray(offset, offset + 9), sample * 9); codes.push(surface.colorCode);
    }
    prepared.set(instance.id, { instance, slots: [], local, codes, localBounds, total });
  }
  const nextIds = new Set(next.instances.filter(i => i.part.status === "resolved").map(i => i.id));
  for (const [id, record] of scene.records) if (!nextIds.has(id) || prepared.has(id)) {
    for (const slot of record.slots) { scene.alpha[slot] = 0; scene.triangleIds[slot] = ""; scene.free.push(slot); }
    scene.sourceTriangles -= record.total; scene.records.delete(id); scene.instanceBounds.delete(id);
  }
  for (const instance of next.instances) {
    let record = scene.records.get(instance.id);
    if (prepared.has(instance.id)) {
      record = prepared.get(instance.id)!;
      const count = record.codes.length;
      for (let sample = 0; sample < count; sample++) {
        let slot = scene.free.pop() ?? (scene.triangleCount < SOFTWARE_TRIANGLE_BUDGET ? scene.triangleCount++ : undefined);
        // At the display limit, give a new part at least one visible sample.
        // Rebalance one donor only, never re-prepare every source instance.
        if (slot === undefined && sample === 0) {
          const donor = [...scene.records.values()].find(value => value.slots.length > 1) ??
            [...scene.records.values()].find(value => value.slots.length);
          if (donor) {
            slot = donor.slots.pop();
            donor.local = donor.local.slice(0, donor.slots.length * 9);
            donor.codes.length = donor.slots.length;
          }
        }
        if (slot === undefined) break;
        record.slots.push(slot);
      }
      record.local = record.local.slice(0, record.slots.length * 9);
      record.codes.length = record.slots.length;
      scene.records.set(instance.id, record); scene.sourceTriangles += record.total;
    }
    if (!record) continue;
    if (prepared.has(instance.id) || record.instance.colorCode !== instance.colorCode ||
      !record.instance.matrix.every((value, i) => value === instance.matrix[i])) previewSoftware(scene, instance.id, instance.matrix, instance.colorCode);
    record.instance = instance;
  }
  scene.model = next; scene.updates++;
  return true;
}
