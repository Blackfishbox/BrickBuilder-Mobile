import { Box3, Group, InstancedMesh, Matrix4, Ray, Vector3 } from "three";
import type { SoftwareScene } from "./software-scene";
import { instanceIndex } from "./instance-index";

export function importedSelectionBounds(root: Group, id: string): Box3 | null {
  const index = instanceIndex(root);
  if (index) return index.bounds(id);
  const bounds = new Box3(), instanceMatrix = new Matrix4(), matrix = new Matrix4(), box = new Box3();
  root.updateMatrixWorld(true);
  for (const child of root.children) {
    if (!(child instanceof InstancedMesh)) continue;
    const index = (child.userData.brickIds as string[] | undefined)?.indexOf(id) ?? -1;
    if (index < 0) continue;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    child.getMatrixAt(index, instanceMatrix);
    matrix.multiplyMatrices(child.matrixWorld, instanceMatrix);
    bounds.union(box.copy(child.geometry.boundingBox!).applyMatrix4(matrix));
  }
  return bounds.isEmpty() ? null : bounds;
}

export function pickSoftwareInstance(ray: Ray, scene: SoftwareScene, offset: number): { id: string; point: Vector3 } | null {
  const localRay = ray.clone(); localRay.origin.y -= offset;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), point = new Vector3();
  let distance = Infinity, hit: { id: string; point: Vector3 } | null = null;
  for (const [id, bounds] of scene.instanceBounds) {
    if (!localRay.intersectsBox(bounds)) continue;
    for (const triangle of scene.records.get(id)?.slots ?? []) {
      if (scene.alpha[triangle] === 0) continue;
      const index = triangle * 9;
      a.fromArray(scene.positions, index); b.fromArray(scene.positions, index + 3); c.fromArray(scene.positions, index + 6);
      if (!localRay.intersectTriangle(a, b, c, false, point)) continue;
      const next = localRay.origin.distanceToSquared(point);
      if (next < distance) {
        distance = next;
        hit = { id: scene.triangleIds[triangle], point: point.clone() };
        hit.point.y += offset;
      }
    }
  }
  return hit;
}
