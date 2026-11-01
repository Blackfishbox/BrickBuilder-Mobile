import { Box3, Color, Vector3 } from "three";
import type { ImportedModel } from "../formats/types";
import { resolveColor } from "../formats/colors";
import { compilePart, worldMatrix } from "./ldraw-geometry";
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
}

/** Prepare a bounded preview from real source triangles, not procedural bricks. */
export async function createSoftwareScene(model: ImportedModel, options: SceneBuildOptions = {}): Promise<SoftwareScene> {
  const instances = model.instances.filter(instance => instance.part.status === "resolved");
  const perInstance = Math.max(1, Math.floor(SOFTWARE_TRIANGLE_BUDGET / Math.max(1, instances.length)));
  const positions = new Float32Array(Math.min(SOFTWARE_TRIANGLE_BUDGET, perInstance * instances.length) * 9);
  const alpha = new Float32Array(positions.length / 9);
  const colors: string[] = [];
  const bounds = new Box3(), boxes = new Map<string, Box3>();
  const vertex = new Vector3(), a = new Vector3(), b = new Vector3(), c = new Vector3();
  const light = new Vector3(-0.4, 0.8, 0.5).normalize();
  let triangles = 0, sourceTriangles = 0, slice = performance.now();
  for (let instanceIndex = 0; instanceIndex < instances.length; instanceIndex++) {
    options.signal?.throwIfAborted();
    const instance = instances[instanceIndex];
    const surfaces = compilePart(model, instance.reference, instance.colorCode);
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
    bounds.union(box.clone().applyMatrix4(matrix));
    const total = surfaces.reduce((sum, surface) => sum + surface.positions.length / 9, 0);
    sourceTriangles += total;
    const count = Math.min(perInstance, total);
    let surfaceIndex = 0, base = 0;
    for (let sample = 0; sample < count && triangles < positions.length / 9; sample++) {
      const index = Math.floor((sample + 0.5) * total / count);
      while (surfaceIndex < surfaces.length - 1 && index >= base + surfaces[surfaceIndex].positions.length / 9) {
        base += surfaces[surfaceIndex++].positions.length / 9;
      }
      const surface = surfaces[surfaceIndex], offset = (index - base) * 9;
      a.fromArray(surface.positions, offset).applyMatrix4(matrix);
      b.fromArray(surface.positions, offset + 3).applyMatrix4(matrix);
      c.fromArray(surface.positions, offset + 6).applyMatrix4(matrix);
      a.toArray(positions, triangles * 9); b.toArray(positions, triangles * 9 + 3); c.toArray(positions, triangles * 9 + 6);
      const normal = vertex.copy(b).sub(a).cross(c.clone().sub(a)).normalize();
      const mapping = resolveColor(surface.colorCode);
      colors.push(new Color(mapping?.hex ?? "#ff00ff").multiplyScalar(0.6 + 0.4 * Math.abs(normal.dot(light))).getStyle());
      alpha[triangles++] = (mapping?.alpha ?? 255) / 255;
    }
    if (performance.now() - slice > 6) {
      options.onProgress?.(instanceIndex + 1, instances.length);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      slice = performance.now();
    }
  }
  return { positions, colors, alpha, bounds, sourceTriangles, triangleCount: triangles };
}
