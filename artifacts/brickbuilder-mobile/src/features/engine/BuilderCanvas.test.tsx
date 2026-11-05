// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { engineFixture } from "./engine-fixtures";
import type { SoftwareScene } from "./software-scene";
import * as softwareRendering from "./software-scene";
import * as cameraGestures from "./camera-gesture";
import BuilderCanvas from "./BuilderCanvas";
import * as snapping from "../connections/engine";
import type { Contact } from "../connections/types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "fflate";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
import { createEmptyDocument, type ToolMode } from "../editor/model";
import { moveImported } from "../editor/ldraw-editing";

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
function catalogProjection() {
  const bounds = observed.scene!.bounds.clone(), offset = Math.max(0, -bounds.min.y);
  bounds.translate(new Vector3(0, offset, 0));
  const target = bounds.getCenter(new Vector3()), radius = bounds.getSize(new Vector3()).length() / 2;
  const camera = new PerspectiveCamera(42, 1, 0.1, 4000), phi = 0.93, theta = 0.72;
  const distance = Math.max(8, radius / Math.sin(camera.fov * Math.PI / 360) * 1.08);
  camera.position.set(target.x + distance * Math.sin(phi) * Math.sin(theta), target.y + distance * Math.cos(phi), target.z + distance * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  return (x: number, y: number, z: number) => {
    const p = new Vector3(x, y + offset, z).project(camera);
    return { x: (p.x + 1) * 300, y: (1 - p.y) * 300 };
  };
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
  it("keeps floating diagnostics off by default and enables and clears them on demand", () => {
    const props = { bricks: [{ id: "air", type: "brick-1x2" as const, color: "#fff", x: 0, y: 3, z: 0, rotation: 0 }],
      selectedId: null, selectedType: "brick-1x2" as const, selectedColor: "#fff", toolMode: "select" as const,
      onMove: vi.fn(), onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    const toggle = element.querySelector<HTMLButtonElement>("[aria-label='Schwebewarnung anzeigen']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='floating-warning']")).toBeNull();
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(element.querySelector("[data-testid='floating-warning']")?.textContent).toContain("1 Teil");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(element.querySelector("[data-testid='floating-warning']")).toBeNull();
  });
  it("drags real catalog plate geometry onto both rows with live contacts and identical committed rendering", async () => {
    const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(resolve("public/parts/import-geometry-2026-10-31.bin")))));
    const sourceText = "1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 80 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat";
    const model: ImportedModel = { version: 1, format: "ldr", sourceName: "catalog.ldr", sourceText,
      originalBytes: [...new TextEncoder().encode(sourceText)], ...parseLDraw(sourceText),
      resources: Object.fromEntries(snapshot.files.map((f: { path: string }) => [f.path, f])), legalDocuments: snapshot.legalDocuments };
    model.instances.forEach(instance => { instance.part.status = "resolved"; });
    const id = model.instances[1].id, onMove = vi.fn();
    const props = { projectId: "catalog", bricks: [], imported: model, selectedId: id,
      selectedType: "brick-1x2" as const, selectedColor: "#B40000", toolMode: "select" as const,
      onMove, onSelect: vi.fn(), onPlace: vi.fn() };
    act(() => root.render(<BuilderCanvas {...props} />));
    await act(async () => { await vi.waitFor(() => expect(observed.scene).toBeDefined()); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    const project = catalogProjection(), start = project(4, 0.4, 0), end = project(0.03, 0.4, 0.52);
    const search = vi.spyOn(snapping, "magneticConstructionTransform");
    pointer("pointerdown", start.x, start.y);
    pointer("pointermove", end.x, end.y);
    flushFrame();
    expect(search).toHaveBeenCalledOnce();
    const transform = search.mock.results[0].value.transform;
    expect(transform.contacts).toHaveLength(2);
    expect(transform.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -16, 0, 0, 1, 10]);
    expect(element.querySelector("[data-testid='connection-status']")?.textContent).toContain("2 Verbindungen");
    const preview = observed.scene!.positions.slice();
    pointer("pointerup", end.x, end.y);
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove.mock.calls[0][2]).toEqual(transform.matrix);
    const committed = moveImported({ ...createEmptyDocument(), imported: model }, id, onMove.mock.calls[0][1], false, onMove.mock.calls[0][2]);
    act(() => root.render(<BuilderCanvas {...props} imported={committed.imported} />));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    flushFrame();
    expect(observed.scene!.positions).toEqual(preview);
    expect(snapping.activeConnections(committed.imported!, id)).toHaveLength(2);
  });
  async function mount(toolMode: ToolMode = "select") {
    const model = engineFixture(1, 2), onMove = vi.fn(), onSelect = vi.fn();
    const props = { projectId: "one", bricks: [], imported: model, selectedId: model.instances[0].id,
      selectedType: "brick-2x4" as const, selectedColor: "#B40000", toolMode, onMove, onSelect, onPlace: vi.fn() };
    act(() => { root.render(<BuilderCanvas {...props} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    host = element.querySelector("[data-testid='canvas-3d']")!;
    flushFrame();
    expect(observed.scene).toBeDefined();
    return { model, onMove, props, point: pickPoint() };
  }
  for (const toolMode of ["build", "select", "delete"] as const) {
    it(`takes over touches on parts in ${toolMode} without editor transactions`, async () => {
      const { props, point, model } = await mount(toolMode);
      const original = observed.scene!.positions.slice();
      const gesture = vi.spyOn(cameraGestures, "cameraGesture");
      pointer("pointerdown", point.x, point.y);
      if (toolMode === "delete") expect(props.onSelect).not.toHaveBeenCalled();
      const selections = props.onSelect.mock.calls.length;
      pointer("pointerdown", point.x + 180, point.y, 2);
      pointer("pointermove", point.x + 40, point.y + 30);
      pointer("pointermove", point.x + 220, point.y + 30, 2);
      flushFrame();
      const next = gesture.mock.results.at(-1)!.value;
      const start = gesture.mock.calls[0][0].camera;
      expect(next.theta).toBe(start.theta); expect(next.phi).toBe(start.phi);
      expect(next.distance).toBeCloseTo(start.distance);
      expect(next.target).not.toEqual(start.target);
      pointer("pointerup", point.x + 220, point.y + 30, 2);
      const count = gesture.mock.calls.length;
      pointer("pointermove", point.x + 80, point.y + 80);
      pointer("pointerup", point.x + 80, point.y + 80);
      pointer("pointerup", point.x + 80, point.y + 80);
      expect(gesture).toHaveBeenCalledTimes(count);
      expect(props.onMove).not.toHaveBeenCalled();
      expect(props.onPlace).not.toHaveBeenCalled();
      expect(props.onSelect).toHaveBeenCalledTimes(selections);
      expect(observed.scene!.positions).toEqual(original);
      expect(model.instances[0].matrix).toEqual(props.imported.instances[0].matrix);
    });
  }
  for (const end of ["pointerup", "pointercancel", "lostpointercapture"]) {
    it(`rebases after ${end} with a third finger and starts fresh gestures from the current camera`, async () => {
      const { props } = await mount("build");
      const gesture = vi.spyOn(cameraGestures, "cameraGesture");
      pointer("pointerdown", 20, 30);
      pointer("pointerdown", 220, 30, 2);
      pointer("pointermove", 40, 50);
      pointer("pointermove", 240, 50, 2);
      const before = gesture.mock.results.at(-1)!.value;
      pointer("pointerdown", 400, 400, 3);
      const count = gesture.mock.calls.length;
      pointer("pointermove", 450, 450, 3);
      expect(gesture).toHaveBeenCalledTimes(count);
      pointer(end, 40, 50);
      pointer("pointermove", 240, 50, 2);
      expect(gesture.mock.results.at(-1)!.value).toEqual(before);
      pointer("pointerup", 450, 450, 3);
      pointer("pointermove", 250, 60, 2);
      pointer("pointerdown", 100, 100, 4);
      pointer("pointermove", 100, 100, 4);
      expect(gesture.mock.results.at(-1)!.value).toEqual(before);
      pointer("pointerup", 100, 100, 4);
      pointer("pointerup", 250, 60, 2);
      pointer("pointerdown", 10, 10, 5);
      pointer("pointerdown", 210, 10, 6);
      pointer("pointermove", 210, 10, 6);
      expect(gesture.mock.calls.at(-1)![0].camera).toEqual(before);
      pointer("pointerup", 210, 10, 6); pointer("pointerup", 10, 10, 5);
      expect(props.onPlace).not.toHaveBeenCalled();
      expect(props.onMove).not.toHaveBeenCalled();
    });
  }
  it("clears a queued drag preview before two-finger takeover and still permits a new delete tap", async () => {
    const { props, point } = await mount();
    const original = observed.scene!.positions.slice();
    const preview = vi.spyOn(softwareRendering, "previewSoftware");
    pointer("pointerdown", point.x, point.y);
    pointer("pointermove", point.x + 50, point.y + 10);
    pointer("pointerdown", point.x - 100, point.y, 2);
    flushFrame();
    expect(preview).not.toHaveBeenCalled();
    expect(observed.scene!.positions).toEqual(original);
    pointer("pointerup", point.x + 50, point.y + 10);
    pointer("pointerup", point.x - 100, point.y, 2);
    expect(props.onMove).not.toHaveBeenCalled();
    act(() => root.render(<BuilderCanvas {...props} toolMode="delete" />));
    props.onSelect.mockClear();
    pointer("pointerdown", point.x, point.y);
    expect(props.onSelect).not.toHaveBeenCalled();
    pointer("pointerup", point.x, point.y);
    expect(props.onSelect).toHaveBeenCalledOnce();
  });
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
    const preview = vi.spyOn(softwareRendering, "previewSoftware");
    const snap = vi.spyOn(snapping, "magneticConstructionTransform").mockReturnValue({ transform: { matrix: [1, 0, 0, 4.6, 0, 1, 0, -48, 0, 0, 1, 3.4], contacts: [], status: "candidate" } });
    pointer("pointerdown", point.x, point.y);
    for (let n = 1; n <= 20; n++) pointer("pointermove", point.x + n * 4, point.y + 10);
    expect(snap).not.toHaveBeenCalled();
    flushFrame();
    expect(snap).toHaveBeenCalledOnce();
    expect(preview.mock.calls.at(-1)?.[2]).toEqual(snap.mock.results[0].value.transform.matrix);
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
