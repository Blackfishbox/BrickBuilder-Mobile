import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Color, InstancedBufferGeometry, InstancedMesh, LineSegments, SRGBColorSpace } from "three";
import type { ImportedModel } from "../formats/types";
import { parseLDraw } from "../formats/ldraw/parser";
import { compilePart, createImportedGroup, hasCompiledPart } from "./ldraw-geometry";
import { createImportedGroupAsync, disposeImportedScene, measureImportedScene, SceneBudgetExceeded } from "./imported-scene";
import { prepareGeometry } from "./prepare-geometry";
import { createSoftwareScene, SOFTWARE_TRIANGLE_BUDGET } from "./software-scene";
import { importIO } from "../formats/io/import";
import { hashBytes } from "../formats/online-geometry";
import { builderDatabase } from "@/storage/database";

function fixture(count = 1): ImportedModel {
  const source = Array.from({ length: count }, (_, index) =>
    `1 ${["4", "14", "43"][index % 3]} ${(index % 100) * 20} 0 ${Math.floor(index / 100) * 20} 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: "synthetic.ldr",
    originalBytes: [], sourceText: source, ...parseLDraw(source),
    resources: { "parts/test.dat": {
      path: "parts/test.dat", author: "Synthetic test author", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
      content: `${"3 16 0 0 0 20 0 0 0 20 0\n".repeat(200)}3 2 0 0 0 0 20 0 0 0 20\n2 24 0 0 0 20 0 0`,
    } }, legalDocuments: [],
  };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("bounded large-model rendering", () => {
  it("shares typed geometry buffers across different inherited colors", () => {
    const model = fixture();
    const red = compilePart(model, "test.dat", "4");
    const yellow = compilePart(model, "TEST.DAT", "14");
    expect(red[0].positions).toBeInstanceOf(Float32Array);
    expect(red[0].positions).toBe(yellow[0].positions);
    expect(red[0].normals).toBe(yellow[0].normals);
    expect(red[0].colorCode).toBe("4");
    expect(yellow[0].colorCode).toBe("14");
    expect(red.find(surface => surface.colorCode === "2")).toBe(yellow.find(surface => surface.colorCode === "2"));
  });
  it("renders 10,000 multicolor instances using four draws, including one instanced edge object", () => {
    const model = fixture(10_000), started = performance.now();
    const root = createImportedGroup(model);
    const stats = measureImportedScene(root);
    expect(stats.drawObjects).toBe(4); // Two inherited alpha groups, fixed paint, edges.
    expect(stats.bufferBytes).toBeLessThan(2 * 1024 * 1024);
    const edges = root.children.filter(child => child instanceof LineSegments);
    expect(edges).toHaveLength(1);
    expect(edges[0].geometry).toBeInstanceOf(InstancedBufferGeometry);
    expect((edges[0].geometry as InstancedBufferGeometry).instanceCount).toBe(10_000);
    const inherited = root.children.filter(child => child instanceof InstancedMesh && child.instanceColor) as InstancedMesh[];
    expect(inherited[0].geometry.getAttribute("position")).toBe(inherited[1].geometry.getAttribute("position"));
    const color = new Color(); inherited[0].getColorAt(0, color);
    expect(color.getHexString(SRGBColorSpace)).toBe("b40000");
    console.info(JSON.stringify({ syntheticRenderer: { ...stats, sceneMilliseconds: Math.round(performance.now() - started) } }));
    const disposals = root.children.filter(child => child instanceof InstancedMesh).map(mesh => vi.spyOn(mesh, "dispose"));
    disposeImportedScene(root);
    disposals.forEach(dispose => expect(dispose).toHaveBeenCalledOnce());
    expect(root.children).toHaveLength(0);
  });
  it("aborts partial builds and rejects an over-budget scene before GPU upload", async () => {
    const model = fixture(100);
    await expect(createImportedGroupAsync(model, { maxGeometryBytes: 128 })).rejects.toBeInstanceOf(SceneBudgetExceeded);
    const controller = new AbortController();
    await expect(createImportedGroupAsync(model, {
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toMatchObject({ name: "AbortError" });
    const root = await createImportedGroupAsync(model);
    expect(root.children).toHaveLength(4);
    disposeImportedScene(root);
  });
  it("bounds the software preview while preserving the full model and source", async () => {
    const model = fixture(10_000);
    const source = model.sourceText, started = performance.now();
    const scene = await createSoftwareScene(model);
    expect(scene.sourceTriangles).toBe(2_010_000);
    expect(scene.triangleCount).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET);
    expect(scene.positions.byteLength).toBeLessThanOrEqual(SOFTWARE_TRIANGLE_BUDGET * 9 * 4);
    expect(scene.colors).toHaveLength(scene.triangleCount);
    expect(scene.bounds.isEmpty()).toBe(false);
    expect(model.instances).toHaveLength(10_000);
    expect(model.sourceText).toBe(source);
    console.info(JSON.stringify({ syntheticSoftware: {
      sourceTriangles: scene.sourceTriangles, previewTriangles: scene.triangleCount,
      prepareMilliseconds: Math.round(performance.now() - started),
    } }));
  });
  it("sends only source resources and unique references to the compiler worker", async () => {
    const model = fixture(100);
    const terminate = vi.fn(), payloads: unknown[] = [];
    class CompilerWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = terminate;
      postMessage(payload: { references: string[]; resources: ImportedModel["resources"] }) {
        payloads.push(payload);
        queueMicrotask(() => {
          const workerModel = { resources: payload.resources } as ImportedModel;
          for (const reference of payload.references) this.onmessage?.({
            data: { kind: "part", reference, surfaces: compilePart(workerModel, reference, "16") },
          } as MessageEvent);
          this.onmessage?.({ data: { kind: "done" } } as MessageEvent);
        });
      }
    }
    vi.stubGlobal("Worker", CompilerWorker);
    await prepareGeometry(model);
    expect(Object.keys(payloads[0] as object).sort()).toEqual(["references", "resources"]);
    expect((payloads[0] as { references: string[] }).references).toEqual(["test.dat"]);
    expect(hasCompiledPart(model, "test.dat")).toBe(true);
    expect(terminate).toHaveBeenCalledOnce();
  });
});

const privateReference = new URL("../../../../../attached_assets/40649-size_1793502923137.io", import.meta.url);
describe.skipIf(!process.env.BRICKBUILDER_BENCH_URL || !existsSync(privateReference))("private reference performance", () => {
  it("measures the real encrypted 8,590-instance IO model with verified archive geometry", async () => {
    const nativeFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      nativeFetch(new URL(String(input), process.env.BRICKBUILDER_BENCH_URL), init));
    await builderDatabase.open();
    try {
      const bytes = new Uint8Array(await readFile(privateReference));
      const document = await importIO(bytes, "private-reference.io", { retry: true });
      const model = document.imported!;
      expect(model.instances).toHaveLength(8590);
      expect(model.originalBytes).toHaveLength(bytes.length);
      const start = performance.now();
      const root = await createImportedGroupAsync(model);
      const stats = measureImportedScene(root);
      const resolved = model.instances.filter(instance => instance.part.status === "resolved");
      const legacyBatches = new Map<string, typeof resolved>();
      for (const instance of resolved) {
        const key = `${instance.reference.toLowerCase()}|${instance.colorCode}`;
        const batch = legacyBatches.get(key) ?? [];
        batch.push(instance); legacyBatches.set(key, batch);
      }
      let previousDrawObjects = 0, previousBufferBytes = 0, renderedTriangles = 0;
      for (const instances of legacyBatches.values()) {
        const surfaces = compilePart(model, instances[0].reference, instances[0].colorCode);
        const paints = new Map<string, { vertices: number; edges: number }>();
        for (const surface of surfaces) {
          const paint = paints.get(surface.colorCode) ?? { vertices: 0, edges: 0 };
          paint.vertices += surface.positions.length; paint.edges += surface.edges.length;
          paints.set(surface.colorCode, paint);
        }
        for (const paint of paints.values()) {
          if (paint.vertices) previousDrawObjects++;
          if (paint.edges) previousDrawObjects += instances.length;
          previousBufferBytes += paint.vertices * 8 + paint.edges * 4 + (paint.vertices ? instances.length * 64 : 0);
          renderedTriangles += paint.vertices / 9 * instances.length;
        }
      }
      expect(resolved.length).toBeGreaterThan(8000);
      expect(stats.drawObjects).toBeLessThan(resolved.length / 3);
      expect(stats.bufferBytes).toBeLessThan(96 * 1024 * 1024);
      console.info(JSON.stringify({ privateReferenceRenderer: {
        instances: model.instances.length, resolved: resolved.length, ...stats,
        previousDrawObjects, previousBufferBytes, renderedTriangles,
        sceneMilliseconds: Math.round(performance.now() - start),
      } }));
      expect(await hashBytes(Uint8Array.from(model.originalBytes))).toBe(await hashBytes(bytes));
      expect(model.instances).toHaveLength(8590);
      disposeImportedScene(root);
    } finally { await builderDatabase.delete(); }
  }, 120000);
});
