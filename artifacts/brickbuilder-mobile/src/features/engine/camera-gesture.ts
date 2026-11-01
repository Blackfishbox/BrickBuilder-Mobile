import { Vector3 } from "three";

export interface PointerPoint { x: number; y: number }
export interface GestureCamera {
  theta: number;
  phi: number;
  distance: number;
  target: Vector3;
}
export interface GestureStart {
  points: readonly [PointerPoint, PointerPoint];
  camera: GestureCamera;
}

/** Use a fixed camera-plane baseline, so pan, pinch and twist remain independent. */
export function cameraGesture(
  start: GestureStart,
  points: readonly [PointerPoint, PointerPoint],
  viewport: { width: number; height: number; fov: number },
): GestureCamera {
  const [a, b] = start.points, [c, d] = points;
  const initialSpan = Math.hypot(b.x - a.x, b.y - a.y);
  const span = Math.hypot(d.x - c.x, d.y - c.y);
  const angle = Math.atan2(d.y - c.y, d.x - c.x) - Math.atan2(b.y - a.y, b.x - a.x);
  const delta = Math.atan2(Math.sin(angle), Math.cos(angle));
  // Ignore small touch noise, including sequential delivery of parallel moves.
  // Subtract the threshold to avoid a jump when a deliberate twist starts.
  const threshold = Math.max(0.06, Math.atan2(6, Math.max(1, initialSpan)));
  const twist = initialSpan >= 12 && span >= 12
    ? Math.sign(delta) * Math.max(0, Math.abs(delta) - threshold) : 0;
  const { theta, phi, distance, target } = start.camera;
  const height = Math.max(1, viewport.height), width = Math.max(1, viewport.width);
  const visibleHeight = 2 * distance * Math.tan(viewport.fov * Math.PI / 360);
  const dx = ((c.x + d.x - a.x - b.x) / 2) * (visibleHeight * width / height) / width;
  const dy = ((c.y + d.y - a.y - b.y) / 2) * visibleHeight / height;
  const right = new Vector3(Math.cos(theta), 0, -Math.sin(theta));
  const up = new Vector3(-Math.cos(phi) * Math.sin(theta), Math.sin(phi), -Math.cos(phi) * Math.cos(theta));
  return {
    theta: theta + twist,
    phi,
    distance: initialSpan >= 12 ? distance * initialSpan / Math.max(12, span) : distance,
    // Restore the original horizontal pan; retain the requested vertical direction.
    target: target.clone().addScaledVector(right, -dx).addScaledVector(up, dy),
  };
}
