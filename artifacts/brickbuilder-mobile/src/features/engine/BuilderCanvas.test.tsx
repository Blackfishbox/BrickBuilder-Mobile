// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { engineFixture } from "./engine-fixtures";
import type { SoftwareScene } from "./software-scene";
import BuilderCanvas from "./BuilderCanvas";
import * as snapping from "../connections/engine";
import type { Contact } from "../connections/types";

const observed = vi.hoisted(() => ({ scene: undefined as SoftwareScene | undefined, preparations: 0 }));
vi.mock("./software-scene", async importOriginal => {
  const actual = await importOriginal<typeof import("./software-scene")>();
  return { ...actual, createSoftwareScene: async (...args: Parameters<typeof actual.createSoftwareScene>) => {
    observed.preparations++;
    observed.scene = await actual.createSoftwareScene(...args);
    return observed.scene;
  } };
});
let root: Root, element: HTMLDivElement, host: HTMLElement;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const context = new Proxy({}, { get: () => vi.fn(), set: () => true });
const contact: Contact = {
  id: "moving:socket|target:stud", movingId: "moving", movingConnectorId: "socket", targetId: "target", targetConnectorId: "stud",
  family: "cylinder", position: [0, 0, 0], orientation: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], state: "candidate",
  evidence: [{ path: "p/stud.dat", line: 8, sha256: "a".repeat(64) }],
};
function flushFrame(): void {
  const callbacks = [...frames.values()]; frames.clear();
  act(() => { callbacks.forEach(callback => callback(performance.now())); });
}
function pointer(type: string, x: number, y: number, id = 1): void {
  act(() => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.defineProperty(event, "pointerId", { value: id });
    host.dispatchEvent(event);
  });
}
function pickPoint(): { x: number; y: number } {
  // Reproduce the initial fit used by the canvas, then project the source triangle center.
  const bounds = observed.scene!.bounds.clone();
  const offset = Math.max(0, -bounds.min.y); bounds.min.y += offset; bounds.max.y += offset;
  const target = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000), phi = 0.93, theta = 0.72;
  const distance = Math.max(8, radius / Math.sin(camera.fov * Math.PI / 360) * 1.08);
  camera.position.set(target.x + distance * Math.sin(phi) * Math.sin(theta), target.y + distance * Math.cos(phi), target.z + distance * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  const point = new Vector3(0.25, -0.25 + offset, 0).project(camera);
  return { x: (point.x + 1) * 300, y: (1 - point.y) * 300 };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = new Map(); nextFrame = 0; observed.scene = undefined; observed.preparations = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((kind: string) => kind === "2d" ? context : null) as HTMLCanvasElement["getContext"]);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 600, width: 600, height: 600, toJSON() {} });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("frame-coalesced drag transactions", () => {
  async function mount() {
    const model = engineFixture(1, 2), onMove = vi.fn(), onSelect = vi.fn();
    const props = { projectId: "one", bricks: [], imported: model, selectedId: model.instances[0].id,
      selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode: "select" as const, onMove, onSelect, onPlace: vi.fn() };
    act(() => { root.render(<BuilderCanvas {...props} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    expect(observed.scene).toBeDefined();
    return { model, onMove, props, point: pickPoint() };
  }
  it("previews at most once per frame without saves, then calls the editor exactly once", async () => {
    const { model, onMove, point, props } = await mount();
    const original = observed.scene!.positions.slice(), before = observed.scene!.transformedTriangles;
    pointer("pointerdown", point.x, point.y);
    expect(props.onSelect).toHaveBeenCalledWith(model.instances[0].id);
    for (let n = 1; n <= 20; n++) pointer("pointermove", point.x + n * 4, point.y + 10);
    expect(observed.scene!.transformedTriangles).toBe(before);
    expect(onMove).not.toHaveBeenCalled();
    flushFrame();
    expect(observed.scene!.positions).not.toEqual(original);
    expect(observed.scene!.transformedTriangles - before).toBe(observed.scene!.triangleCount);
    expect(model.instances[0].matrix[3]).toBe(0);
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(onMove).toHaveBeenCalledOnce();
    const destination = onMove.mock.calls[0][1];
    expect(destination.x * 2).toBe(Math.round(destination.x * 2));
    expect(destination.z * 2).toBe(Math.round(destination.z * 2));
    expect(destination.y).toBeCloseTo(0);
    expect(observed.scene!.positions).toEqual(original);
    expect(observed.preparations).toBe(1);
  });
  it("coalesces connection searches and commits the exact off-grid live preview", async () => {
    const { onMove, point } = await mount();
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: { matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [], status: "candidate" } });
    pointer("pointerdown", point.x, point.y);
    for (let n = 1; n <= 20; n++) pointer("pointermove", point.x + n * 4, point.y + 10);
    expect(snap).not.toHaveBeenCalled();
    flushFrame();
    expect(snap).toHaveBeenCalledOnce();
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(snap).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.23);
    expect(onMove.mock.calls[0][1].y).toBeCloseTo(2.4);
    expect(onMove.mock.calls[0][1].z).toBeCloseTo(0.17);
    expect(onMove.mock.calls[0][2]).toEqual(snap.mock.results[0].value.transform.matrix);
  });
  it("resolves a pending connection on release even before the next frame", async () => {
    const { onMove, point } = await mount();
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: { matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [], status: "candidate" } });
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 80, point.y + 10);
    pointer("pointerup", point.x + 80, point.y + 10);
    expect(snap).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][1].x).toBeCloseTo(0.23);
    expect(onMove.mock.calls[0][1].y).toBeCloseTo(2.4);
    expect(onMove.mock.calls[0][1].z).toBeCloseTo(0.17);
    expect(onMove.mock.calls[0][2]).toEqual(snap.mock.results[0].value.transform.matrix);
  });
  it("carries the magnetic latch across live frames without committing until release", async () => {
    const { model, onMove, point } = await mount();
    const transform: snapping.MagneticLatch["transform"] = {
      matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [contact], status: "candidate",
    };
    const latch: snapping.MagneticLatch = { model, id: model.instances[0].id, anchor: { x: 0.23, y: 0, z: 0.17 }, transform };
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform, latch });
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 40, point.y + 10);
    flushFrame();
    expect(snap.mock.calls[0][3]).toBeUndefined();
    const preview = observed.scene!.positions.slice();
    pointer("pointermove", point.x + 45, point.y + 10);
    flushFrame();
    expect(snap.mock.calls[1][3]).toBe(latch);
    expect(observed.scene!.positions).toEqual(preview);
    expect(onMove).not.toHaveBeenCalled();
    pointer("pointerup", point.x + 45, point.y + 10);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][2]).toEqual(transform.matrix);
  });
  for (const cancellation of ["pointercancel", "lostpointercapture", "multitouch", "project", "blur"]) {
    it(`rolls back ${cancellation} without changing the document`, async () => {
      const { onMove, point, props } = await mount(), original = observed.scene!.positions.slice();
      vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: {
        matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [contact], status: "candidate",
      } });
      pointer("pointerdown", point.x, point.y);
      pointer("pointermove", point.x + 80, point.y + 10);
      flushFrame();
      expect(observed.scene!.positions).not.toEqual(original);
      expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("Magnetisch eingerastet");
      if (cancellation === "multitouch") pointer("pointerdown", point.x - 50, point.y, 2);
      else if (cancellation === "project") await act(async () => { root.render(<BuilderCanvas {...props} projectId="two" imported={undefined} />); });
      else if (cancellation === "blur") act(() => window.dispatchEvent(new Event("blur")));
      else pointer(cancellation, point.x, point.y);
      pointer("pointerup", point.x + 80, point.y + 10);
      expect(onMove).not.toHaveBeenCalled();
      expect(props.onSelect).toHaveBeenCalledTimes(1);
      expect(observed.scene!.positions).toEqual(original);
      expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    });
  }
  it("refreshes committed markers after edits, history, selection and project changes", async () => {
    const { model, props } = await mount();
    const active = vi.spyOn(snapping, "activeConnections").mockImplementation((current, id) =>
      current.instances[0].matrix[3] === 0 && id === model.instances[0].id ? [{ ...contact, state: "verified" }] : []);
    const changed = { ...model, instances: model.instances.map(i => ({ ...i, matrix: [...i.matrix] as typeof i.matrix })) };
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    // Browsers dispatch capture loss after pointerup. No active pointer means
    // the committed selection must keep its verified contacts.
    pointer("lostpointercapture", 0, 0);
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    const shifted = { ...changed, instances: changed.instances.map(i => ({ ...i, matrix: [1, 0, 0, 20, 0, 1, 0, 0, 0, 0, 1, 0] as typeof i.matrix })) };
    await act(async () => root.render(<BuilderCanvas {...props} imported={shifted} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).not.toContain("geprüfte Verbindung");
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} />));
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("geprüfte Verbindung");
    const button = element.querySelector("[aria-label='Verbindungen anzeigen']")!;
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(element.querySelector("[data-testid='connection-status']")).not.toBeNull();
    await act(async () => root.render(<BuilderCanvas {...props} imported={changed} selectedId={null} />));
    expect(element.querySelector("[data-testid='connection-status']")).toBeNull();
    expect(active).toHaveBeenCalled();
  });
});
