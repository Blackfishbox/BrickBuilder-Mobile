import {
  Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Group,
  InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh,
  LineSegments, Material, Mesh, MeshLambertMaterial, ShaderMaterial,
} from "three";
import type { ImportedInstance, ImportedModel } from "../formats/types";
import { resolveColor } from "../formats/colors";
import { compilePart, worldMatrix, type Surface } from "./ldraw-geometry";
const sharedAttributes = new WeakMap<Float32Array, BufferAttribute>();
function sharedAttribute(array: Float32Array): BufferAttribute {
  let attribute = sharedAttributes.get(array);
  if (!attribute) { attribute = new BufferAttribute(array, 3); sharedAttributes.set(array, attribute); }
  return attribute;
}

export interface SceneBuildOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  maxGeometryBytes?: number;
}
export const DEFAULT_GEOMETRY_BUDGET = 96 * 1024 * 1024;
export class SceneBudgetExceeded extends Error {
  constructor() { super("Das Modell überschreitet das mobile Grafik-Speicherbudget."); }
}

export function measureImportedScene(root: Group): { bufferBytes: number; drawObjects: number; instanceRecords: number } {
  const buffers = new Set<ArrayBufferLike>();
  let bufferBytes = 0, instances = 0;
  for (const object of root.children) {
    if (!(object instanceof Mesh || object instanceof LineSegments)) continue;
    const attributes = [...Object.values(object.geometry.attributes), ...(object.geometry.index ? [object.geometry.index] : [])];
    if (object instanceof InstancedMesh) {
      attributes.push(object.instanceMatrix);
      if (object.instanceColor) attributes.push(object.instanceColor);
      instances += object.count;
    }
    for (const attribute of attributes) {
      const buffer = attribute.array.buffer;
      if (!buffers.has(buffer)) { buffers.add(buffer); bufferBytes += buffer.byteLength; }
    }
  }
  return { bufferBytes, drawObjects: root.children.length, instanceRecords: instances };
}

function material(alpha: number, vertexColors = false): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color: "#ffffff", side: DoubleSide, vertexColors,
    transparent: alpha < 255, opacity: alpha / 255, depthWrite: alpha === 255,
  });
}

function addFaces(root: Group, surfaces: Surface[], instances: ImportedInstance[], alpha: number, inherited: boolean): void {
  const length = surfaces.reduce((sum, surface) => sum + surface.positions.length, 0);
  if (!length || !instances.length) return;
  const geometry = new BufferGeometry();
  if (surfaces.length === 1) {
    geometry.setAttribute("position", sharedAttribute(surfaces[0].positions));
    geometry.setAttribute("normal", sharedAttribute(surfaces[0].normals));
  } else {
    const positions = new Float32Array(length), normals = new Float32Array(length);
    let offset = 0;
    for (const surface of surfaces) {
      positions.set(surface.positions, offset); normals.set(surface.normals, offset);
      offset += surface.positions.length;
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  }
  if (!inherited) {
    const colors = new Float32Array(length);
    let offset = 0;
    for (const surface of surfaces) {
      const color = new Color(resolveColor(surface.colorCode)?.hex ?? "#ff00ff");
      for (let i = 0; i < surface.positions.length; i += 3) {
        colors[offset++] = color.r; colors[offset++] = color.g; colors[offset++] = color.b;
      }
    }
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
  }
  const mesh = new InstancedMesh(geometry, material(alpha, !inherited), instances.length);
  const color = new Color();
  instances.forEach((instance, index) => {
    mesh.setMatrixAt(index, worldMatrix(instance.matrix));
    if (inherited) mesh.setColorAt(index, color.set(resolveColor(instance.colorCode)?.hex ?? "#ff00ff"));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.name = `ldraw:${instances[0].reference}`;
  mesh.userData.brickIds = instances.map(instance => instance.id);
  root.add(mesh);
}

/** One instanced line draw per part, never one Object3D per brick. */
function addEdges(root: Group, surfaces: Surface[], instances: ImportedInstance[]): void {
  const length = surfaces.reduce((sum, surface) => sum + surface.edges.length, 0);
  if (!length) return;
  const positions = new Float32Array(length);
  let offset = 0;
  for (const surface of surfaces) { positions.set(surface.edges, offset); offset += surface.edges.length; }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  const rows = [new Float32Array(instances.length * 4), new Float32Array(instances.length * 4), new Float32Array(instances.length * 4)];
  const bounds = new Box3(), transformed = new Box3();
  geometry.computeBoundingBox();
  const local = geometry.boundingBox!.clone();
  instances.forEach((instance, index) => {
    const matrix = worldMatrix(instance.matrix);
    const e = matrix.elements;
    for (let row = 0; row < 3; row++) rows[row].set([e[row], e[4 + row], e[8 + row], e[12 + row]], index * 4);
    bounds.union(transformed.copy(local).applyMatrix4(matrix));
  });
  rows.forEach((row, index) => geometry.setAttribute(`instanceRow${index}`, new InstancedBufferAttribute(row, 4)));
  geometry.instanceCount = instances.length;
  geometry.boundingBox = bounds;
  geometry.computeBoundingSphere();
  const lines = new LineSegments(geometry, new ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec4 instanceRow0;
      attribute vec4 instanceRow1;
      attribute vec4 instanceRow2;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 transformed = vec3(dot(instanceRow0, p), dot(instanceRow1, p), dot(instanceRow2, p));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: `
      void main() {
        gl_FragColor = vec4(vec3(0.03310477), 0.25);
        #include <colorspace_fragment>
      }`,
  }));
  // The shader's per-instance transform is not represented by Object3D.matrix.
  lines.frustumCulled = false;
  lines.name = "ldraw:instanced-edges";
  root.add(lines);
}

function* sceneSteps(model: ImportedModel, root: Group, signal?: AbortSignal): Generator<number> {
  const parts = new Map<string, ImportedInstance[]>();
  for (const instance of model.instances) {
    if (instance.part.status !== "resolved") continue;
    const key = instance.reference.toLowerCase();
    const batch = parts.get(key) ?? [];
    batch.push(instance); parts.set(key, batch);
  }
  root.userData.partCount = parts.size;
  let completed = 0;
  for (const [reference, instances] of parts) {
    signal?.throwIfAborted();
    const surfaces = compilePart(model, reference, "16");
    const inherited = surfaces.filter(surface => surface.colorCode === "16" && surface.positions.length);
    const variants = new Map<number, ImportedInstance[]>();
    for (const instance of instances) {
      const alpha = resolveColor(instance.colorCode)?.alpha ?? 255;
      const batch = variants.get(alpha) ?? [];
      batch.push(instance); variants.set(alpha, batch);
    }
    for (const [alpha, batch] of variants) addFaces(root, inherited, batch, alpha, true);
    const fixed = new Map<number, Surface[]>();
    for (const surface of surfaces) {
      if (surface.colorCode === "16" || !surface.positions.length) continue;
      const alpha = resolveColor(surface.colorCode)?.alpha ?? 255;
      const batch = fixed.get(alpha) ?? [];
      batch.push(surface); fixed.set(alpha, batch);
    }
    for (const [alpha, batch] of fixed) addFaces(root, batch, instances, alpha, false);
    addEdges(root, surfaces, instances);
    yield ++completed;
  }
}

export function createImportedGroup(model: ImportedModel): Group {
  const root = new Group();
  try { for (const _ of sceneSteps(model, root)) { /* Synchronous adapter for small fixtures. */ } }
  catch (error) { disposeImportedScene(root); throw error; }
  return root;
}

export async function createImportedGroupAsync(model: ImportedModel, options: SceneBuildOptions = {}): Promise<Group> {
  const root = new Group();
  let slice = performance.now();
  try {
    for (const completed of sceneSteps(model, root, options.signal)) {
      options.signal?.throwIfAborted();
      if (measureImportedScene(root).bufferBytes > (options.maxGeometryBytes ?? DEFAULT_GEOMETRY_BUDGET)) throw new SceneBudgetExceeded();
      options.onProgress?.(completed, root.userData.partCount);
      if (performance.now() - slice >= 6) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        options.signal?.throwIfAborted();
        slice = performance.now();
      }
    }
    options.signal?.throwIfAborted();
    return root;
  } catch (error) { disposeImportedScene(root); throw error; }
}

/** Dispose instancing buffers as well as shared geometry/materials exactly once. */
export function disposeImportedScene(root: Group): void {
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>();
  root.traverse(object => {
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Mesh || object instanceof LineSegments) {
      geometries.add(object.geometry);
      for (const value of Array.isArray(object.material) ? object.material : [object.material]) materials.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(value => value.dispose());
  root.clear();
}
