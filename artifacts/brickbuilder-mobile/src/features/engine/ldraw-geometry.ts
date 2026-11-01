import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, InstancedMesh,
  LineBasicMaterial, LineSegments, Matrix4, MeshLambertMaterial,
} from "three";
import type { Affine, ImportedModel } from "../formats/types";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";
import { resolveColor } from "../formats/colors";
import { candidates, normalizeReference } from "@workspace/ldraw-source";

export interface Surface { colorCode: string; positions: number[]; edges: number[] }
const cache = new WeakMap<ImportedModel, Map<string, Surface[]>>();
const MAX_VERTICES = 1_500_000;
export function invalidateGeometry(model: ImportedModel) { cache.delete(model); }
function point(m: Affine, x: number, y: number, z: number): number[] {
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
}
/** Shared original LDU geometry; no procedural substitutions, no external fetches. */
export function compilePart(model: ImportedModel, reference: string, color: string): Surface[] {
  let modelCache = cache.get(model);
  if (!modelCache) { modelCache = new Map(); cache.set(model, modelCache); }
   const key = `${normalizeReference(reference)}|${color}`;
  const cached = modelCache.get(key);
  if (cached) return cached;
  const surfaces = new Map<string, Surface>();
  let vertices = 0, visits = 0;
  function visit(path: string, matrix: Affine, currentColor: string, stack: string[]) {
    if (stack.includes(path) || stack.length > 48 || ++visits > 50000) throw new Error(`Geometriehierarchie ungültig: ${path}`);
    const file = model.resources[path];
    if (!file) throw new Error(`Geometrie fehlt: ${path}`);
    for (const line of file.content.split(/\r?\n/)) {
      const tokens = line.trim().split(/\s+/);
      const type = tokens[0];
      if (type === "1") {
        const ref = referenceLine(line);
        const child = candidates(ref.reference).find(path => Object.hasOwn(model.resources, path));
        if (!child) throw new Error(`Geometrie fehlt: ${ref.reference}`);
        visit(child, multiply(matrix, ref.matrix), ref.color === "16" ? currentColor : ref.color, [...stack, path]);
      } else if (["2", "3", "4"].includes(type)) {
        const expected = type === "2" ? 6 : type === "3" ? 9 : 12;
        const values = tokens.slice(2).map(Number);
        if (values.length !== expected || values.some(v => !Number.isFinite(v))) throw new Error(`Ungültige Geometriezeile: ${path}`);
        const code = tokens[1] === "16" || tokens[1] === "24" ? currentColor : tokens[1];
        let surface = surfaces.get(code);
        if (!surface) { surface = { colorCode: code, positions: [], edges: [] }; surfaces.set(code, surface); }
        const points = [];
        for (let index = 0; index < values.length; index += 3) points.push(point(matrix, values[index], values[index + 1], values[index + 2]));
        if (type === "2") surface.edges.push(...points[0], ...points[1]);
        else {
          surface.positions.push(...points[0], ...points[1], ...points[2]);
          if (type === "4") surface.positions.push(...points[0], ...points[2], ...points[3]);
        }
        vertices += type === "4" ? 6 : Number(type);
        if (vertices > MAX_VERTICES) throw new Error("Teil überschreitet das sichere Geometriebudget.");
      }
    }
  }
   const root = candidates(reference).find(path => Object.hasOwn(model.resources, path));
   if (!root) throw new Error(`Geometrie fehlt: ${reference}`);
   visit(root, IDENTITY, color, []);
  const result = [...surfaces.values()];
  modelCache.set(key, result);
  return result;
}
/** LDraw: 20 LDU per stud, Y down. Preserve all 12 source coefficients. */
export function worldMatrix(m: Affine): Matrix4 {
  return new Matrix4().set(
    m[0] / 20, m[1] / 20, m[2] / 20, m[3] / 20,
    -m[4] / 20, -m[5] / 20, -m[6] / 20, -m[7] / 20,
    m[8] / 20, m[9] / 20, m[10] / 20, m[11] / 20,
    0, 0, 0, 1,
  );
}
export function createImportedGroup(model: ImportedModel): Group {
  const root = new Group();
  const batches = new Map<string, typeof model.instances>();
  for (const instance of model.instances) {
    if (instance.part.status !== "resolved") continue;
    const key = instance.reference.toLowerCase() + "|" + instance.colorCode;
    const list = batches.get(key) ?? [];
    list.push(instance); batches.set(key, list);
  }
  for (const instances of batches.values()) {
    const first = instances[0];
    for (const surface of compilePart(model, first.reference, first.colorCode)) {
      const color = resolveColor(surface.colorCode);
      if (surface.positions.length) {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(surface.positions, 3));
        geometry.computeVertexNormals();
        const mesh = new InstancedMesh(geometry, new MeshLambertMaterial({
          color: color?.hex ?? "#ff00ff", side: DoubleSide,
          transparent: (color?.alpha ?? 255) < 255, opacity: (color?.alpha ?? 255) / 255,
          depthWrite: (color?.alpha ?? 255) === 255,
        }), instances.length);
        instances.forEach((instance, index) => mesh.setMatrixAt(index, worldMatrix(instance.matrix)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.name = `ldraw:${first.reference}`;
        root.add(mesh);
      }
      if (surface.edges.length) {
        // Explicit type-2 edges, not conditional type-5 edges.
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute(surface.edges, 3));
        const material = new LineBasicMaterial({ color: "#333333", transparent: true, opacity: 0.25 });
        for (const instance of instances) {
          const edge = new LineSegments(geometry, material);
          edge.applyMatrix4(worldMatrix(instance.matrix));
          root.add(edge);
        }
      }
    }
  }
  return root;
}
