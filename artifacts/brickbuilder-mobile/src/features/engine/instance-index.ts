import {
  Box3, Color, Group, InstancedBufferAttribute, InstancedBufferGeometry,
  InstancedMesh, LineSegments, Matrix4, Mesh, Raycaster, Sphere, Vector3,
} from "three";
import type { Affine, ImportedInstance, ImportedModel } from "../formats/types";
import { resolveColor } from "../formats/colors";
import { compilePart, installCompiledPart, reuseGeometryCache, sameSceneSources, worldMatrix } from "./ldraw-geometry";
import { createImportedGroup, disposeImportedScene, measureImportedScene, DEFAULT_GEOMETRY_BUDGET, SceneBudgetExceeded } from "./imported-scene";

type Draw = InstancedMesh | LineSegments<InstancedBufferGeometry>;
interface Slot { draw: Draw; index: number }
interface RecordEntry { instance: ImportedInstance; slots: Slot[]; bounds: Box3 }
export interface UpdateCounters {
  updates: number; transforms: number; colors: number; inserts: number; deletes: number;
  batchCreates: number; capacityGrowths: number; triangleTests: number; boundsTests: number;
}
const indices = new WeakMap<Group, InstanceIndex>();
const scratchMatrix = new Matrix4(), scratchColor = new Color();
const scratchBounds = new Box3(), scratchSphere = new Sphere();
const hitMesh = new Mesh();

function ids(draw: Draw): string[] { return draw.userData.brickIds as string[]; }
function capacity(draw: Draw): number {
  return draw instanceof InstancedMesh ? draw.instanceMatrix.count : draw.geometry.getAttribute("instanceRow0").count;
}
function markMatrix(draw: Draw, slot: number, matrix: Matrix4): void {
  if (draw instanceof InstancedMesh) {
    draw.setMatrixAt(slot, matrix);
    draw.instanceMatrix.addUpdateRange(slot * 16, 16);
    draw.instanceMatrix.needsUpdate = true;
    // Three also reads this sphere for render sorting even with culling disabled.
    // Nulling it would make the renderer traverse every instance on the next draw.
    scratchBounds.copy(localBounds(draw)).applyMatrix4(matrix);
    if (draw.boundingBox) draw.boundingBox.union(scratchBounds);
    else draw.boundingBox = scratchBounds.clone();
    scratchBounds.getBoundingSphere(scratchSphere);
    if (draw.boundingSphere) draw.boundingSphere.union(scratchSphere);
    else draw.boundingSphere = scratchSphere.clone();
  } else {
    const e = matrix.elements;
    for (let row = 0; row < 3; row++) {
      const attribute = draw.geometry.getAttribute(`instanceRow${row}`) as InstancedBufferAttribute;
      attribute.setXYZW(slot, e[row], e[4 + row], e[8 + row], e[12 + row]);
      attribute.addUpdateRange(slot * 4, 4); attribute.needsUpdate = true;
    }
  }
}
function markColor(draw: Draw, slot: number, code: string): void {
  if (!(draw instanceof InstancedMesh) || !draw.userData.inherited) return;
  draw.setColorAt(slot, scratchColor.set(resolveColor(code)?.hex ?? "#ff00ff"));
  draw.instanceColor!.addUpdateRange(slot * 3, 3); draw.instanceColor!.needsUpdate = true;
}
function drawCount(draw: Draw, count: number): void {
  if (draw instanceof InstancedMesh) draw.count = count;
  else draw.geometry.instanceCount = count;
}
function localBounds(draw: Draw): Box3 {
  if (draw.userData.localBounds) return draw.userData.localBounds;
  if (!draw.geometry.boundingBox) draw.geometry.computeBoundingBox();
  return draw.geometry.boundingBox!;
}
function sameMatrix(a: Affine, b: Affine): boolean { return a === b || a.every((value, i) => value === b[i]); }

/** Stable IDs own all face/edge slots. No scene traversal or GPU allocation on a move. */
export class InstanceIndex {
  readonly records = new Map<string, RecordEntry>();
  readonly batches = new Map<string, Draw>();
  private readonly recipes = new Map<string, string[]>();
  readonly counters: UpdateCounters = {
    updates: 0, transforms: 0, colors: 0, inserts: 0, deletes: 0,
    batchCreates: 0, capacityGrowths: 0, triangleTests: 0, boundsTests: 0,
  };
  model: ImportedModel;
  constructor(readonly root: Group, model: ImportedModel, readonly maxBytes = DEFAULT_GEOMETRY_BUDGET) {
    this.model = model;
    for (const instance of model.instances) this.records.set(instance.id, { instance, slots: [], bounds: new Box3() });
    for (const child of root.children) {
      if (!(child instanceof InstancedMesh || child instanceof LineSegments) || !child.userData.batchKey) continue;
      const draw = child as Draw;
      this.batches.set(draw.userData.batchKey, draw);
      ids(draw).forEach((id, index) => this.records.get(id)?.slots.push({ draw, index }));
    }
    for (const entry of this.records.values()) this.refreshBounds(entry, entry.instance.matrix);
    for (const entry of this.records.values()) {
      if (entry.instance.part.status === "resolved") this.recipes.set(this.recipeKey(entry.instance), entry.slots.map(slot => slot.draw.userData.batchKey as string));
    }
    indices.set(root, this);
  }
  private refreshBounds(entry: RecordEntry, matrix: Affine): void {
    entry.bounds.makeEmpty();
    const transform = worldMatrix(matrix);
    for (const slot of entry.slots) entry.bounds.union(localBounds(slot.draw).clone().applyMatrix4(transform));
  }
  bounds(id: string): Box3 | null {
    const entry = this.records.get(id);
    if (!entry || entry.bounds.isEmpty()) return null;
    this.root.updateMatrixWorld();
    return entry.bounds.clone().applyMatrix4(this.root.matrixWorld);
  }
  preview(id: string, matrix: Affine): void {
    const entry = this.records.get(id);
    if (!entry) return;
    const transform = worldMatrix(matrix);
    for (const slot of entry.slots) markMatrix(slot.draw, slot.index, transform);
    this.refreshBounds(entry, matrix);
    this.counters.transforms++;
  }
  restore(id: string): void {
    const entry = this.records.get(id);
    if (entry) this.preview(id, entry.instance.matrix);
  }
  private recipeKey(instance: ImportedInstance): string {
    return `${instance.reference.toLowerCase()}|${resolveColor(instance.colorCode)?.alpha ?? 255}`;
  }
  private grow(draw: Draw, required: number): Draw {
    let nextCapacity = capacity(draw);
    while (nextCapacity < required) nextCapacity = Math.max(4, Math.ceil(nextCapacity * 1.5));
    const bytes = (nextCapacity - capacity(draw)) * (draw instanceof InstancedMesh ? (draw.instanceColor ? 76 : 64) : 48);
    if (measureImportedScene(this.root).bufferBytes + bytes > this.maxBytes) throw new SceneBudgetExceeded();
    let next: Draw;
    if (draw instanceof InstancedMesh) {
      next = new InstancedMesh(draw.geometry, draw.material, nextCapacity);
      next.count = draw.count;
      next.boundingBox = draw.boundingBox?.clone() ?? null;
      next.boundingSphere = draw.boundingSphere?.clone() ?? null;
      next.instanceMatrix.array.set(draw.instanceMatrix.array);
      if (draw.instanceColor) {
        next.setColorAt(0, new Color());
        next.instanceColor!.array.set(draw.instanceColor.array);
      }
      draw.dispose(); // Only the replaced instancing buffers, not shared geometry/material.
    } else {
      const geometry = new InstancedBufferGeometry();
      geometry.setAttribute("position", draw.geometry.getAttribute("position"));
      for (let row = 0; row < 3; row++) {
        const old = draw.geometry.getAttribute(`instanceRow${row}`);
        const array = new Float32Array(nextCapacity * 4); array.set(old.array);
        geometry.setAttribute(`instanceRow${row}`, new InstancedBufferAttribute(array, 4));
      }
      geometry.instanceCount = draw.geometry.instanceCount;
      next = new LineSegments(geometry, draw.material);
      draw.geometry.dispose();
    }
    next.name = draw.name; next.userData = { ...draw.userData };
    next.frustumCulled = false;
    next.visible = draw.visible;
    this.root.remove(draw); this.root.add(next);
    this.batches.set(next.userData.batchKey, next);
    for (const id of ids(next)) for (const slot of this.records.get(id)?.slots ?? []) if (slot.draw === draw) slot.draw = next;
    this.counters.capacityGrowths++;
    return next;
  }
  private removeSlot(entry: RecordEntry, slot: Slot): void {
    const draw = slot.draw, list = ids(draw), last = list.length - 1;
    if (slot.index !== last) {
      const movedId = list[last];
      if (draw instanceof InstancedMesh) {
        draw.getMatrixAt(last, scratchMatrix); markMatrix(draw, slot.index, scratchMatrix);
        if (draw.instanceColor) {
          draw.getColorAt(last, scratchColor); draw.setColorAt(slot.index, scratchColor);
          draw.instanceColor.addUpdateRange(slot.index * 3, 3); draw.instanceColor.needsUpdate = true;
        }
      } else {
        for (let row = 0; row < 3; row++) {
          const attribute = draw.geometry.getAttribute(`instanceRow${row}`) as InstancedBufferAttribute;
          attribute.array.copyWithin(slot.index * 4, last * 4, last * 4 + 4);
          attribute.addUpdateRange(slot.index * 4, 4); attribute.needsUpdate = true;
        }
      }
      list[slot.index] = movedId;
      const movedSlot = this.records.get(movedId)!.slots.find(value => value.draw === draw)!;
      movedSlot.index = slot.index;
    }
    list.pop(); drawCount(draw, list.length);
    entry.slots.splice(entry.slots.indexOf(slot), 1);
    // Empty batches are retained for undo/repeated placement; capacity never shrinks.
  }
  /** Staging new batch geometry happens before changing any existing slot. */
  update(next: ImportedModel): boolean {
    if (!sameSceneSources(this.model, next)) return false;
    reuseGeometryCache(this.model, next);
    const desired = new Map<string, Draw[]>();
    const staged = new Group();
    try {
      for (const instance of next.instances) {
        const old = this.records.get(instance.id)?.instance;
        if (old && old.reference === instance.reference && old.part.status === instance.part.status &&
          (resolveColor(old.colorCode)?.alpha ?? 255) === (resolveColor(instance.colorCode)?.alpha ?? 255)) continue;
        if (instance.part.status !== "resolved") { desired.set(instance.id, []); continue; }
        const recipe = this.recipes.get(this.recipeKey(instance));
        if (recipe) {
          const draws = recipe.map(key => this.batches.get(key) ?? staged.children.find(value => value.userData.batchKey === key) as Draw | undefined);
          if (draws.every((draw): draw is Draw => !!draw)) { desired.set(instance.id, draws); continue; }
        }
        const templateModel = { ...next, instances: [instance] };
        reuseGeometryCache(next, templateModel);
        const template = createImportedGroup(templateModel);
        installCompiledPart(next, instance.reference, compilePart(templateModel, instance.reference, "16"));
        const draws: Draw[] = [];
        for (const child of [...template.children] as Draw[]) {
          const key = child.userData.batchKey;
          const existing = this.batches.get(key) ?? staged.children.find(value => value.userData.batchKey === key) as Draw | undefined;
          if (existing) draws.push(existing);
          else {
            child.userData.brickIds = []; drawCount(child, 0);
            staged.add(child); draws.push(child);
          }
        }
        disposeImportedScene(template);
        desired.set(instance.id, draws);
        this.recipes.set(this.recipeKey(instance), draws.map(draw => draw.userData.batchKey as string));
      }
      if (desired.size) {
        const additions = new Map<Draw, number>();
        for (const [id, draws] of desired) for (const draw of draws) {
          if (!this.records.get(id)?.slots.some(slot => slot.draw === draw)) additions.set(draw, (additions.get(draw) ?? 0) + 1);
        }
        let reservedBytes = measureImportedScene(this.root).bufferBytes + measureImportedScene(staged).bufferBytes;
        for (const [draw, count] of additions) {
          let size = capacity(draw);
          while (size < ids(draw).length + count) size = Math.max(4, Math.ceil(size * 1.5));
          reservedBytes += (size - capacity(draw)) * (draw instanceof InstancedMesh ? (draw.instanceColor ? 76 : 64) : 48);
        }
        if (reservedBytes > this.maxBytes) throw new SceneBudgetExceeded();
        // Budget rejection happens before touching a single live batch.
        for (const child of [...staged.children] as Draw[]) {
          this.root.add(child); this.batches.set(child.userData.batchKey, child); this.counters.batchCreates++;
        }
        for (const [draw, count] of additions) {
          let current = draw;
          if (capacity(current) < ids(current).length + count) current = this.grow(current, ids(current).length + count);
          if (current !== draw) for (const draws of desired.values()) {
            const i = draws.indexOf(draw); if (i >= 0) draws[i] = current;
          }
        }
      }
    } catch (error) { disposeImportedScene(staged); throw error; }
    const nextIds = new Set(next.instances.map(instance => instance.id));
    for (const [id, entry] of this.records) {
      if (nextIds.has(id)) continue;
      for (const slot of [...entry.slots]) this.removeSlot(entry, slot);
      this.records.delete(id); this.counters.deletes++;
    }
    for (const instance of next.instances) {
      let entry = this.records.get(instance.id);
      if (!entry) {
        entry = { instance, slots: [], bounds: new Box3() }; this.records.set(instance.id, entry); this.counters.inserts++;
      }
      const draws = desired.get(instance.id);
      if (draws) {
        for (const slot of [...entry.slots]) if (!draws.includes(slot.draw)) this.removeSlot(entry, slot);
        for (const draw of draws) if (!entry.slots.some(slot => slot.draw === draw)) {
          const index = ids(draw).length; ids(draw).push(instance.id); drawCount(draw, index + 1);
          entry.slots.push({ draw, index });
          markMatrix(draw, index, worldMatrix(instance.matrix)); markColor(draw, index, instance.colorCode);
        }
      }
      if (draws || !sameMatrix(entry.instance.matrix, instance.matrix)) this.preview(instance.id, instance.matrix);
      if (entry.instance.colorCode !== instance.colorCode) {
        for (const slot of entry.slots) markColor(slot.draw, slot.index, instance.colorCode);
        this.counters.colors++;
      }
      entry.instance = instance;
    }
    this.model = next; this.counters.updates++;
    return true;
  }
  pick(raycaster: Raycaster): { id: string; point: Vector3 } | null {
    this.root.updateMatrixWorld();
    const localRay = raycaster.ray.clone().applyMatrix4(this.root.matrixWorld.clone().invert());
    const point = new Vector3();
    const candidates: { id: string; entry: RecordEntry; distance: number }[] = [];
    for (const [id, entry] of this.records) {
      this.counters.boundsTests++;
      if (!entry.bounds.isEmpty() && localRay.intersectBox(entry.bounds, point)) candidates.push({ id, entry, distance: raycaster.ray.origin.distanceToSquared(point.applyMatrix4(this.root.matrixWorld)) });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let nearest: { id: string; point: Vector3; distance: number } | undefined;
    for (const { id, entry, distance } of candidates) {
      if (nearest && distance > nearest.distance * nearest.distance) break;
      for (const slot of entry.slots) {
        if (!(slot.draw instanceof InstancedMesh)) continue;
        if ((slot.draw.material as { opacity?: number }).opacity === 0) continue;
        slot.draw.getMatrixAt(slot.index, scratchMatrix);
        hitMesh.geometry = slot.draw.geometry; hitMesh.material = slot.draw.material;
        hitMesh.matrixWorld.multiplyMatrices(this.root.matrixWorld, scratchMatrix);
        const hits: Parameters<Mesh["raycast"]>[1] = [];
        this.counters.triangleTests++;
        hitMesh.raycast(raycaster, hits);
        for (const hit of hits) if (!nearest || hit.distance < nearest.distance) nearest = { id, point: hit.point.clone(), distance: hit.distance };
      }
    }
    return nearest ?? null;
  }
}
export function instanceIndex(root: Group): InstanceIndex | undefined { return indices.get(root); }
