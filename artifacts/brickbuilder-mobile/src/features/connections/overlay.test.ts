// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { PerspectiveCamera } from "three";
import { ConnectionOverlay, MARKER_LIMIT } from "./overlay";
import type { Contact } from "./types";

afterEach(() => vi.restoreAllMocks());
it("bounds marker work and does not take pointer gestures in either renderer", () => {
  const context = { clearRect: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  const host = document.createElement("div"), overlay = new ConnectionOverlay(host), camera = new PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  overlay.contacts = Array.from({ length: 500 }, (_, i) => ({
    id: String(i), movingId: "a", targetId: "b", movingConnectorId: "a", targetConnectorId: "b",
    family: "cylinder", position: [0, 0, 0], state: "verified",
    orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], evidence: [],
  } satisfies Contact));
  overlay.draw(camera, 0, () => null);
  expect(context.arc).toHaveBeenCalledTimes(MARKER_LIMIT);
  expect(overlay.canvas.style.pointerEvents).toBe("none");
  overlay.visible = false; overlay.draw(camera, 0, () => null);
  expect(context.arc).toHaveBeenCalledTimes(MARKER_LIMIT);
  overlay.dispose();
  expect(host.children).toHaveLength(0); expect(overlay.contacts).toHaveLength(0);
});
