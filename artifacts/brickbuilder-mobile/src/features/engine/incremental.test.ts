import { describe, expect, it, vi } from "vitest";
import { Color, InstancedMesh, Matrix4, Ray, Raycaster, Vector3 } from "three";
import { engineFixture } from "./engine-fixtures";
import { InstanceIndex } from "./instance-index";
import { createImportedGroup, disposeImportedScene, measureImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { createSoftwareScene, previewSoftware, restoreSoftware, updateSoftwareScene, SOFTWARE_TRIANGLE_BUDGET } from "./software-scene";
import { importedSelectionBounds, pickSoftwareInstance } from "./imported-selection";
import { worldMatrix } from "./ldraw-geometry";
import type { Affine, ImportedInstance, ImportedModel } from "../formats/types";

function edit(model: ImportedModel, position: number, patch: Partial<ImportedInstance>): ImportedModel {
  return { ...model, instances: model.instances.map((instance, i) => i === position ? { ...instance, ...patch } : instance) };
}
function moved(model: ImportedModel, position = 0, x = 60): ImportedModel {
  const matrix = [...model.instances[position].matrix] as Affine; matrix[3] = x;
  return edit(model, position, { matrix });
}
function matrices(index: InstanceIndex, id: string): void {
  const entry = index.records.get(id)!;
  const expected = worldMatrix(entry.instance.matrix).elements;
  for (const slot of entry.slots) {
    if (slot.draw instanceof InstancedMesh) {
      const actual = new Matrix4(); slot.draw.getMatrixAt(slot.index, actual);
      actual.elements.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 5));
    } else {
      for (let row = 0; row < 3; row++) {
        const array = slot.draw.geometry.getAttribute(`instanceRow${row}`).array;
        [row, 4 + row, 8 + row, 12 + row].forEach((element, i) => expect(array[slot.index * 4 + i]).toBeCloseTo(expected[element], 5));
      }
    }
  }
}
describe("persistent imported drawing batches", () => {
  it("moves/rotates reflected and sheared instances without allocations, disposal or recompilation", () => {
    const model = engineFixture(4000), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const objects = [...root.children], geometries = objects.map(child => (child as InstancedMesh).geometry);
    const disposal = geometries.map(geometry => vi.spyOn(geometry, "dispose"));
    const spheres = objects.filter((child): child is InstancedMesh => child instanceof InstancedMesh).map(mesh => vi.spyOn(mesh, "computeBoundingSphere"));
    const before = measureImportedScene(root);
    const matrix: Affine = [-1, 0.25, 0, 130, 0, 1, 0, -20, 0, 0, 1, 50];
    const next = edit(model, 0, { matrix });
    expect(index.update(next)).toBe(true);
    expect(root.children).toEqual(objects);
    expect(measureImportedScene(root)).toEqual(before);
    matrices(index, model.instances[0].id);
    expect(index.counters).toMatchObject({ transforms: 1, batchCreates: 0, capacityGrowths: 0 });
    disposal.forEach(spy => expect(spy).not.toHaveBeenCalled());
    // Match Three's render-sorting branch: it computes the whole batch if null.
    objects.filter((child): child is InstancedMesh => child instanceof InstancedMesh).forEach(mesh => {
      if (mesh.boundingSphere === null) mesh.computeBoundingSphere();
    });
    spheres.forEach(spy => expect(spy).not.toHaveBeenCalled());
    const bounds = importedSelectionBounds(root, model.instances[0].id)!;
    expect(bounds.min.x).toBeGreaterThan(5);
    index.update(model); matrices(index, model.instances[0].id);
    disposeImportedScene(root);
  });
  it("changes only inherited colors and migrates only the inherited opacity batch", () => {
    const model = engineFixture(10), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const id = model.instances[0].id, slots = [...index.records.get(id)!.slots];
    const fixed = slots.find(slot => slot.draw instanceof InstancedMesh && !slot.draw.instanceColor)!.draw;
    const edges = slots.find(slot => !(slot.draw instanceof InstancedMesh))!.draw;
    const opaque = slots.find(slot => slot.draw instanceof InstancedMesh && slot.draw.instanceColor)!.draw as InstancedMesh;
    index.update(edit(model, 0, { colorCode: "14" }));
    const color = new Color(); opaque.getColorAt(slots.find(slot => slot.draw === opaque)!.index, color);
    expect(color.getHexString()).toBe("fac80a");
    expect(index.counters.batchCreates).toBe(0);
    index.update(edit(model, 0, { colorCode: "43" }));
    expect(index.records.get(id)!.slots.some(slot => slot.draw === fixed)).toBe(true);
    expect(index.records.get(id)!.slots.some(slot => slot.draw === edges)).toBe(true);
    expect(index.records.get(id)!.slots.some(slot => slot.draw === opaque)).toBe(false);
    const transparent = index.records.get(id)!.slots.find(slot => slot.draw instanceof InstancedMesh && slot.draw.instanceColor)!.draw as InstancedMesh;
    expect((transparent.material as { opacity: number }).opacity).toBeCloseTo(128 / 255);
    for (const entry of index.records.values()) matrices(index, entry.instance.id);
    index.update(model); matrices(index, id);
    disposeImportedScene(root);
  });
  it("swap-deletes, reuses capacity on undo and adds new geometry without replacing unrelated draws", () => {
    const model = engineFixture(5), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const removed = { ...model, instances: model.instances.slice(1) };
    index.update(removed);
    expect(index.records.has(model.instances[0].id)).toBe(false);
    for (const entry of index.records.values()) matrices(index, entry.instance.id);
    index.update(model);
    const additions = Array.from({ length: 20 }, (_, i) => ({ ...model.instances[1], id: `new:${i}` }));
    const next = { ...model, instances: [...model.instances, ...additions] };
    index.update(next);
    for (const draw of index.batches.values()) {
      const ids = draw.userData.brickIds as string[];
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeLessThanOrEqual(draw instanceof InstancedMesh ? draw.instanceMatrix.count : draw.geometry.getAttribute("instanceRow0").count);
    }
    const objects = [...root.children];
    const novel = { ...model.instances[0], id: "new-geometry", reference: "new.dat" };
    const enriched = { ...next, resources: { ...model.resources, "parts/new.dat": { ...model.resources["parts/test.dat"], path: "parts/new.dat" } }, instances: [...next.instances, novel] };
    index.update(enriched);
    objects.forEach(object => expect(root.children).toContain(object));
    expect(index.records.get(novel.id)!.slots.length).toBe(3);
    index.update(next); expect(index.records.has(novel.id)).toBe(false);
    index.update(enriched); matrices(index, novel.id);
    disposeImportedScene(root);
  });
  it("enriches missing source instances without losing edits or existing draws", () => {
    const model = engineFixture(2);
    model.instances[1].part.status = "missing";
    const root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const faceGeometry = root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh).map(child => child.geometry);
    const next = edit(model, 1, { part: { ...model.instances[1].part, status: "resolved" } });
    index.update(next);
    expect(index.records.get(model.instances[1].id)!.slots).toHaveLength(3);
    expect(root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh).map(child => child.geometry)).toEqual(faceGeometry);
    disposeImportedScene(root);
  });
  it("keeps a valid scene unchanged when new geometry fails or exceeds the budget", () => {
    const model = engineFixture(20), root = createImportedGroup(model), index = new InstanceIndex(root, model, measureImportedScene(root).bufferBytes);
    const objects = [...root.children], snapshot = [...index.records.keys()];
    const missing = { ...model, instances: [...model.instances, { ...model.instances[0], id: "bad", reference: "absent.dat" }] };
    expect(() => index.update(missing)).toThrow("Geometrie fehlt");
    const added = { ...model, instances: [...model.instances, { ...model.instances[0], id: "added" }] };
    expect(() => index.update(added)).toThrow(SceneBudgetExceeded);
    expect(root.children).toEqual(objects); expect([...index.records.keys()]).toEqual(snapshot);
    for (const entry of index.records.values()) matrices(index, entry.instance.id);
    disposeImportedScene(root);
  });
  it("reserves full replacement for actual source changes, not undo of unused acquired files", () => {
    const model = engineFixture(2), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const appended = { ...model, resources: { ...model.resources, "unused.dat": { ...model.resources["parts/test.dat"], path: "unused.dat" } } };
    expect(index.update(appended)).toBe(true);
    expect(index.update(model)).toBe(true);
    expect(index.update({ ...model, resources: {} })).toBe(false);
    expect(index.update({ ...model, sourceText: "0 Different source" })).toBe(false);
    expect(index.model).toBe(model);
    disposeImportedScene(root);
  });
  it("picks by cached bounds with exact triangles, invalidated by previews and rollback", () => {
    const model = engineFixture(4000), root = createImportedGroup(model), index = new InstanceIndex(root, model);
    const raycaster = new Raycaster(new Vector3(0.2, -0.2, 1), new Vector3(0, 0, -1));
    const hit = index.pick(raycaster);
    expect(hit?.id).toBe(model.instances[0].id);
    expect(index.counters.triangleTests).toBeLessThan(10);
    const matrix = [...model.instances[0].matrix] as Affine; matrix[3] = 50000;
    index.preview(model.instances[0].id, matrix);
    expect(index.pick(raycaster)?.id).not.toBe(model.instances[0].id);
    index.restore(model.instances[0].id);
    expect(index.pick(raycaster)?.id).toBe(model.instances[0].id);
    expect(model.instances[0].matrix[3]).toBe(0);
    disposeImportedScene(root);
  });
});

describe("incremental reduced-detail scene", () => {
  it("matches fresh fixed/inherited shading, transparency and reflected rotations", async () => {
    const model = engineFixture(2, 4), scene = await createSoftwareScene(model);
    const matrix: Affine = [-1, 0.25, 0, 60, 0, 1, 0, -20, 0, 0, 1, 40];
    const next = edit(model, 0, { matrix, colorCode: "43" });
    updateSoftwareScene(scene, next);
    const fresh = await createSoftwareScene(next);
    expect(scene.positions).toEqual(fresh.positions);
    expect(scene.colors).toEqual(fresh.colors);
    expect(scene.alpha).toEqual(fresh.alpha);
    expect([...scene.instanceBounds]).toEqual([...fresh.instanceBounds]);
  });
  it("keeps insertions visible at the sample limit without growing buffers", async () => {
    const model = engineFixture(160, 200), scene = await createSoftwareScene(model), positions = scene.positions;
    const added = { ...model.instances[0], id: "new-at-budget" };
    updateSoftwareScene(scene, { ...model, instances: [...model.instances, added] });
    expect(scene.positions).toBe(positions);
    expect(scene.records.get(added.id)!.slots.length).toBeGreaterThan(0);
    expect(scene.triangleCount).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET);
    expect([...scene.records.values()].reduce((sum, entry) => sum + entry.local.length / 9, 0)).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET);
  });
  it("updates and restores only affected samples with original fixed colors and correct bounds", async () => {
    const model = engineFixture(4000), scene = await createSoftwareScene(model);
    const buffer = scene.positions, before = scene.positions.slice(), untouched = scene.records.get(model.instances[1].id)!;
    const count = scene.records.get(model.instances[0].id)!.slots.length;
    const next = moved(model);
    updateSoftwareScene(scene, next);
    expect(scene.positions).toBe(buffer);
    expect(scene.transformedTriangles).toBe(count);
    for (const slot of untouched.slots) expect([...scene.positions.subarray(slot * 9, slot * 9 + 9)]).toEqual([...before.subarray(slot * 9, slot * 9 + 9)]);
    updateSoftwareScene(scene, model);
    expect([...scene.positions]).toEqual([...before]);
    const matrix = [...model.instances[0].matrix] as Affine; matrix[3] = 100;
    previewSoftware(scene, model.instances[0].id, matrix);
    restoreSoftware(scene, model.instances[0].id);
    expect([...scene.positions]).toEqual([...before]);
    const ray = new Ray(new Vector3(0.2, -0.2, 1), new Vector3(0, 0, -1));
    expect(pickSoftwareInstance(ray, scene, 0)?.id).toBe(model.instances[0].id);
    const removed = { ...model, instances: model.instances.slice(1) };
    updateSoftwareScene(scene, removed);
    expect(pickSoftwareInstance(ray, scene, 0)?.id).not.toBe(model.instances[0].id);
    updateSoftwareScene(scene, model);
    expect(scene.triangleCount).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET);
    expect(scene.free.length).toBe(0);
    expect(pickSoftwareInstance(ray, scene, 0)?.id).toBe(model.instances[0].id);
  });
});

describe("reproducible Node edit benchmark (not physical device certification)", () => {
  for (const count of [100, 4000, 10000]) it(`measures ${count} instances`, async () => {
    const model = engineFixture(count), iterations = 12;
    const updates = Array.from({ length: iterations }, (_, i) => moved(model, 0, 20 + i * 10));
    let start = performance.now();
    for (const next of updates) { const rebuilt = createImportedGroup(next); disposeImportedScene(rebuilt); }
    const rebuildMs = (performance.now() - start) / iterations;
    const root = createImportedGroup(model), index = new InstanceIndex(root, model), bytes = measureImportedScene(root).bufferBytes;
    start = performance.now();
    for (const next of updates) index.update(next);
    const updateMs = (performance.now() - start) / iterations;
    const raycaster = new Raycaster(new Vector3(0.2, -0.2, 10), new Vector3(0, 0, -1));
    index.update(model); root.updateMatrixWorld(true);
    const meshes = root.children.filter((child): child is InstancedMesh => child instanceof InstancedMesh);
    start = performance.now(); raycaster.intersectObjects(meshes, false);
    const legacyPickMs = performance.now() - start;
    start = performance.now(); index.pick(raycaster);
    const indexedPickMs = performance.now() - start;
    start = performance.now(); const software = await createSoftwareScene(model);
    const softwarePrepareMs = performance.now() - start;
    start = performance.now(); updateSoftwareScene(software, updates[0]);
    const softwareUpdateMs = performance.now() - start;
    expect(index.counters.batchCreates).toBe(0); expect(index.counters.capacityGrowths).toBe(0);
    expect(measureImportedScene(root).bufferBytes).toBe(bytes);
    const placements: ImportedModel[] = [];
    let placed = model;
    for (let i = 0; i < iterations; i++) {
      placed = { ...placed, instances: [...placed.instances, { ...model.instances[0], id: `placed:${i}` }] };
      placements.push(placed);
    }
    start = performance.now();
    for (const next of placements) { const rebuilt = createImportedGroup(next); disposeImportedScene(rebuilt); }
    const placementRebuildMs = (performance.now() - start) / iterations;
    const placedRoot = createImportedGroup(model), placedIndex = new InstanceIndex(placedRoot, model);
    start = performance.now();
    for (const next of placements) placedIndex.update(next);
    const placementUpdateMs = (performance.now() - start) / iterations;
    const placementBytes = measureImportedScene(placedRoot).bufferBytes;
    start = performance.now(); placedIndex.update(model);
    const deleteUpdateMs = performance.now() - start;
    const previewMatrix = [...model.instances[0].matrix] as Affine; previewMatrix[3] = 240;
    start = performance.now();
    for (let i = 0; i < 100; i++) index.preview(model.instances[0].id, previewMatrix);
    const previewMs = (performance.now() - start) / 100;
    console.info(JSON.stringify({ incrementalBenchmark: { count, iterations, rebuildMs, updateMs, legacyPickMs, indexedPickMs,
      softwarePrepareMs, softwareUpdateMs, bufferBytes: bytes, allocatedDrawBuffersOnMove: 0,
      legacyFullBuilds: iterations, incrementalFullBuilds: 0, workerRequestsOnMove: 0, ...index.counters,
      previewMs, placementRebuildMs, placementUpdateMs, deleteUpdateMs, placementBytes,
      placementCapacityGrowths: placedIndex.counters.capacityGrowths, placementBatchCreates: placedIndex.counters.batchCreates } }));
    disposeImportedScene(root);
    disposeImportedScene(placedRoot);
  });
});
