import { Matrix4 } from "three";
import type { Affine, ImportedModel } from "../formats/types";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";
import { candidates, normalizeReference } from "@workspace/ldraw-source";

export interface Surface {
  colorCode: string;
  positions: Float32Array;
  normals: Float32Array;
  edges: Float32Array;
}
interface PendingSurface { colorCode: string; positions: number[]; edges: number[] }
const cache = new WeakMap<ImportedModel, Map<string, Surface[]>>();
const MAX_VERTICES = 1_500_000;
export function invalidateGeometry(model: ImportedModel) { cache.delete(model); }
export function hasCompiledPart(model: ImportedModel, reference: string): boolean {
  return cache.get(model)?.has(normalizeReference(reference)) ?? false;
}
export function installCompiledPart(model: ImportedModel, reference: string, surfaces: Surface[]): void {
  let modelCache = cache.get(model);
  if (!modelCache) { modelCache = new Map(); cache.set(model, modelCache); }
  modelCache.set(normalizeReference(reference), surfaces);
}
function point(m: Affine, x: number, y: number, z: number): number[] {
  return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
}
/** Shared original LDU geometry; no procedural substitutions, no external fetches. */
export function compilePart(model: ImportedModel, reference: string, color: string): Surface[] {
  let modelCache = cache.get(model);
  if (!modelCache) { modelCache = new Map(); cache.set(model, modelCache); }
  const key = normalizeReference(reference);
  const cached = modelCache.get(key);
  if (cached) return resolveSurfaces(cached, color);
  const surfaces = new Map<string, PendingSurface>();
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
   visit(root, IDENTITY, "16", []);
  const result: Surface[] = [...surfaces.values()].map(surface => {
    const positions = new Float32Array(surface.positions);
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i + 3] - positions[i], ay = positions[i + 4] - positions[i + 1], az = positions[i + 5] - positions[i + 2];
      const bx = positions[i + 6] - positions[i], by = positions[i + 7] - positions[i + 1], bz = positions[i + 8] - positions[i + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz) || 1;
      for (let vertex = 0; vertex < 9; vertex += 3) {
        normals[i + vertex] = nx / length;
        normals[i + vertex + 1] = ny / length;
        normals[i + vertex + 2] = nz / length;
      }
    }
    return { colorCode: surface.colorCode, positions, normals, edges: new Float32Array(surface.edges) };
  });
  modelCache.set(key, result);
  return resolveSurfaces(result, color);
}
function resolveSurfaces(surfaces: Surface[], color: string): Surface[] {
  if (color === "16") return surfaces;
  // Only lightweight wrappers vary by appearance; vertex buffers are shared.
  return surfaces.map(surface => surface.colorCode === "16" ? { ...surface, colorCode: color } : surface);
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
export { createImportedGroup } from "./imported-scene";
