import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { cameraGesture, type GestureStart, type PointerPoint } from "./camera-gesture";

const points = [{ x: 100, y: 150 }, { x: 300, y: 150 }] as const;
const shift = (dx: number, dy: number): [PointerPoint, PointerPoint] =>
  points.map(p => ({ x: p.x + dx, y: p.y + dy })) as [PointerPoint, PointerPoint];
function baseline(theta = 0.72, phi = 0.93, distance = 17): GestureStart {
  return { points, camera: { theta, phi, distance, target: new Vector3(1, 2, 3) } };
}
const viewport = { width: 400, height: 800, fov: 42 };

describe("independent two-finger camera gestures", () => {
  for (const [width, height] of [[400, 800], [800, 400], [600, 600]]) {
    for (const theta of [0, 0.72, Math.PI / 2, -2.4]) {
      for (const phi of [0.25, 0.93, 1.42]) {
        for (const distance of [3, 17, 800]) {
          it(`uses original horizontal and reversed vertical pan at ${width}x${height}, ${theta}/${phi}/${distance}`, () => {
            const start = baseline(theta, phi, distance);
            const camera = new PerspectiveCamera(42, width / height, 0.1, 4000);
            camera.position.copy(start.camera.target).add(new Vector3(
              distance * Math.sin(phi) * Math.sin(theta), distance * Math.cos(phi),
              distance * Math.sin(phi) * Math.cos(theta)));
            camera.lookAt(start.camera.target); camera.updateMatrixWorld(true);
            const origin = start.camera.target.clone().project(camera);
            for (const [dx, dy] of [[30, 0], [-30, 0], [0, 40], [0, -40], [30, 40], [-30, -40]]) {
              const next = cameraGesture(start, shift(dx, dy), { width, height, fov: 42 });
              expect(next.theta).toBe(theta); expect(next.phi).toBe(phi); expect(next.distance).toBe(distance);
              const projected = next.target.clone().project(camera).sub(origin);
              expect(projected.x * width / 2).toBeCloseTo(-dx);
              expect(projected.y * height / 2).toBeCloseTo(dy);
              expect(projected.z).toBeCloseTo(0);
              if (dy > 0) expect(next.target.y).toBeGreaterThan(start.camera.target.y);
              if (dy < 0) expect(next.target.y).toBeLessThan(start.camera.target.y);
            }
            expect(start.camera.target.toArray()).toEqual([1, 2, 3]);
          });
        }
      }
    }
  }
  it("zooms only with span and leaves the target and orbit untouched", () => {
    const start = baseline();
    const next = cameraGesture(start, [{ x: 0, y: 150 }, { x: 400, y: 150 }], viewport);
    expect(next.distance).toBe(8.5);
    expect(next.theta).toBe(start.camera.theta);
    expect(next.phi).toBe(start.camera.phi);
    expect(next.target).toEqual(start.camera.target);
  });
  it("ignores small angular noise and introduces twist continuously", () => {
    const start = baseline();
    const rotate = (angle: number): [PointerPoint, PointerPoint] => [
      { x: 200 - 100 * Math.cos(angle), y: 150 - 100 * Math.sin(angle) },
      { x: 200 + 100 * Math.cos(angle), y: 150 + 100 * Math.sin(angle) },
    ];
    expect(cameraGesture(start, rotate(0.04), viewport).theta).toBe(start.camera.theta);
    expect(cameraGesture(start, rotate(0.060001), viewport).theta).toBeCloseTo(start.camera.theta + 0.000001);
    const next = cameraGesture(start, rotate(0.5), viewport);
    expect(next.theta).toBeCloseTo(start.camera.theta + 0.44);
    expect(next.distance).toBeCloseTo(17);
    expect(next.target).toEqual(start.camera.target);
  });
  it("combines pan, pinch and twist without mixing their inputs", () => {
    const start = baseline(), angle = -0.4;
    const moved: [PointerPoint, PointerPoint] = [-1, 1].map(sign => ({
      x: 230 + sign * 150 * Math.cos(angle), y: 190 + sign * 150 * Math.sin(angle),
    })) as [PointerPoint, PointerPoint];
    const next = cameraGesture(start, moved, viewport);
    expect(next.theta).toBeCloseTo(start.camera.theta - 0.34);
    expect(next.distance).toBeCloseTo(17 * 2 / 3);
    expect(next.target.distanceTo(cameraGesture(start, shift(30, 40), viewport).target)).toBeLessThan(1e-12);
  });
  it("wraps angle differences across the negative X axis", () => {
    const start = baseline();
    start.points = [{ x: 300, y: 149 }, { x: 100, y: 151 }];
    expect(cameraGesture(start, [{ x: 300, y: 151 }, { x: 100, y: 149 }], viewport).theta).toBe(start.camera.theta);
  });
  it("keeps coincident fingers and zero-sized viewports finite", () => {
    const start = baseline(); start.points = [{ x: 1, y: 1 }, { x: 1, y: 1 }];
    const next = cameraGesture(start, [{ x: 1, y: 1 }, { x: 1, y: 1 }], { width: 0, height: 0, fov: 42 });
    expect(next).toEqual(start.camera);
  });
});
