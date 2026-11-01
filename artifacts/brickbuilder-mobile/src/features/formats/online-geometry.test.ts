import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidates, inspectFile, normalizePath, normalizeReference } from "@workspace/ldraw-source";
import { builderDatabase, loadProject, saveProject } from "@/storage/database";
import { createEmptyDocument } from "@/features/editor/model";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
import { resolveGeometry } from "./geometry-resolver";
import { hashBytes, OnlineGeometry } from "./online-geometry";
import { importLDraw } from "./ldraw/import";
import { importIO } from "./io/import";
import { importInternal, exportInternal } from "./internal/adapter";
import { getImportPartFailures } from "./import-failures";
import manifest from "./geometry-manifest.json";
import { prepareLibraryPart } from "../editor/ldraw-editing";

const encode = (text: string) => new TextEncoder().encode(text);
const licensed = (body = "3 16 0 0 0 20 0 0 0 20 0") =>
  `0 Synthetic fixture\n0 Author: Test Author\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n${body}\n`;
const ref = (name: string) => `1 4 12 24 36 -1 0 0 0 1 0 0 0 1 ${name}`;
const legal = "Creative Commons Legal Code\n" + "Original legal fixture for standalone tests. ".repeat(10);
const snapshotBytes = new Uint8Array(await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url)));
async function sourceResponse(bytes: Uint8Array, snapshot = "official-live-v1") {
  return new Response(bytes as BodyInit, { headers: {
    "X-LDraw-SHA256": await hashBytes(bytes), "X-LDraw-Snapshot": snapshot,
    "Content-Type": "application/octet-stream",
  } });
}
function serve(files: Record<string, string | number>, calls: string[] = []) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(manifest.url)) return new Response(snapshotBytes);
    const path = new URL(url, "https://test.invalid").searchParams.get("path")!;
    calls.push(path);
    if (/^(CAreadme|CAlicense4|CC0-1.0)\.txt$/.test(path)) return sourceResponse(encode(legal));
    const data = files[path] ?? 404;
    return typeof data === "number" ? new Response("", { status: data }) : sourceResponse(encode(data));
  });
}
beforeEach(async () => { await builderDatabase.open(); });
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await builderDatabase.delete(); });

describe("approved recursive acquisition", () => {
  const inventoryPart = (ldrawId: string) => ({
    id: `inventory:${ldrawId}`, packageId: "catalog", ldrawId, name: ldrawId,
    category: "Teileliste", keywords: [], file: `parts/${ldrawId}.dat`,
  });
  it("prepares inventory part 3004 and its complete bundled closure again without any network", async () => {
    vi.stubGlobal("fetch", serve({}));
    const prepared = await prepareLibraryPart(inventoryPart("3004"));
    expect(prepared.model.instances[0].part.status).toBe("resolved");
    const stored = await builderDatabase.geometrySnapshots.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].files.length).toBeGreaterThan(1);
    expect(stored[0].files.every(file => file.sha256 && file.byteLength)).toBe(true);
    const offline = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", offline);
    const restored = await prepareLibraryPart(inventoryPart("3004"));
    expect(restored.model.instances[0].part.status).toBe("resolved");
    expect(Object.keys(restored.model.resources).sort()).toEqual(Object.keys(prepared.model.resources).sort());
    for (const [path, file] of Object.entries(prepared.model.resources)) {
      expect(restored.model.resources[path].content).toBe(file.content);
      expect(restored.model.resources[path].sourceUrl).toBe(file.sourceUrl);
    }
    expect(offline).not.toHaveBeenCalled();
  });
  it("downloads an inventory root and recursive dependencies, then reuses them offline", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", serve({
      "parts/inventory-download.dat": licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 inventory-child.dat"),
      "p/inventory-child.dat": licensed(),
    }, calls));
    const prepared = await prepareLibraryPart(inventoryPart("inventory-download"));
    expect(prepared.model.resources["p/inventory-child.dat"]).toBeDefined();
    expect(calls).toContain("parts/inventory-download.dat");
    expect(calls).toContain("p/inventory-child.dat");
    const offline = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", offline);
    expect((await prepareLibraryPart(inventoryPart("inventory-download"))).model.instances[0].part.status).toBe("resolved");
    expect(offline).not.toHaveBeenCalled();
  });
  it("retries ordinary inventory download failures on the next explicit selection", async () => {
    vi.stubGlobal("fetch", serve({ "parts/inventory-retry.dat": 404 }));
    await expect(prepareLibraryPart(inventoryPart("inventory-retry"))).rejects.toThrow("inventory-retry.dat");
    vi.stubGlobal("fetch", serve({ "parts/inventory-retry.dat": licensed() }));
    expect((await prepareLibraryPart(inventoryPart("inventory-retry"))).model.instances[0].part.status).toBe("resolved");
  });
  it("normalizes without accepting URLs, traversal, encoded paths or arbitrary namespaces", () => {
    expect(normalizeReference(" S\\Test.DAT ")).toBe("s/test.dat");
    expect(candidates("48\\edge.dat")).toEqual(["parts/48/edge.dat", "p/48/edge.dat"]);
    expect(candidates("parts/s/test.dat")).toEqual(["parts/s/test.dat"]);
    for (const path of ["../test.dat", "parts//x.dat", "/parts/x.dat", "https://host/x.dat", "parts/%2e.dat", "parts/./x.dat"]) {
      expect(() => normalizePath(path)).toThrow();
    }
    expect(() => normalizePath("textures/a.dat")).toThrow();
  });
  it("requires original accepted licenses and credits, finite geometry, and safe dependencies", () => {
    for (const text of [licensed().replace("CC BY 4.0", "CC BY 2.0"), "<html>error</html>",
      licensed().replace("Test Author", ""), licensed("3 16 NaN 0 0 1 0 0 0 1 0"),
      licensed(ref("../bad.dat")), licensed("9 nonsense")]) {
      expect(() => inspectFile("parts/test.dat", encode(text))).toThrow();
    }
    expect(inspectFile("parts/test.dat", encode(licensed())).author).toBe("Test Author");
  });
  it("deduplicates normalized instances, resolves primitives, compiles colors/transforms, caches atomically and reuses offline", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", serve({
      "parts/network-root.dat": licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/network-child.dat"),
      "parts/s/network-child.dat": licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 network-primitive.dat"),
      "p/network-primitive.dat": licensed(),
    }, calls));
    const doc = await importLDraw(encode(ref("NETWORK-ROOT.DAT") + "\n" + ref("network-root.dat")), "fixture.ldr");
    const model = doc.imported!;
    expect(model.instances.map(i => i.part.status)).toEqual(["resolved", "resolved"]);
    expect(calls.filter(p => p === "parts/network-root.dat")).toHaveLength(1);
    expect(model.instances[0].part.brickLinkId).toBeUndefined();
    expect(compilePart(model, "network-root.dat", "4")[0].colorCode).toBe("4");
    const matrix = worldMatrix(model.instances[0].matrix);
    expect(matrix.elements[12]).toBeCloseTo(0.6);
    expect(matrix.elements[13]).toBeCloseTo(-1.2);
    expect(model.resources["p/network-primitive.dat"].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await builderDatabase.geometrySnapshots.count()).toBe(1);
    await saveProject(doc);
    builderDatabase.close(); await builderDatabase.open();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    const reopened = (await loadProject(doc.id))!;
    expect(compilePart(reopened.imported!, "network-root.dat", "4")[0].positions).toHaveLength(9);
    const next = await importLDraw(encode(ref("network-root.dat")), "next.ldr");
    expect(next.imported!.instances[0].part.status).toBe("resolved");
    const roundtrip = importInternal(exportInternal(reopened)).imported!;
    expect(roundtrip.resources["parts/network-root.dat"].sha256).toBe(model.resources["parts/network-root.dat"].sha256);
    expect(roundtrip.retrievalSnapshots![0].graph).toEqual(model.retrievalSnapshots![0].graph);
    expect(roundtrip.originalBytes).toEqual(model.originalBytes);
  });
  it("never overwrites installed or project geometry and needs no service for complete local roots", async () => {
    const doc = createEmptyDocument();
    doc.imported = (await importLDraw(encode(ref("3001.dat")), "local.ldr", "ldr", undefined, { online: false })).imported;
    const original = { path: "parts/local-only.dat", sourceUrl: "https://library.ldraw.org/library/official/parts/local-only.dat",
      author: "Test Author", license: "CC-BY-4.0" as const, content: licensed() };
    doc.imported!.resources = { [original.path]: original };
    doc.imported!.instances[0].reference = "local-only.dat";
    const fetcher = vi.fn(() => { throw new Error("must not fetch"); }); vi.stubGlobal("fetch", fetcher);
    await resolveGeometry(doc.imported!);
    expect(fetcher).not.toHaveBeenCalled();
    expect(doc.imported!.resources[original.path]).toEqual(original);
  });
  it("rejects cycles, incomplete graphs, unsupported licenses and malformed bytes without cache admission", async () => {
    vi.stubGlobal("fetch", serve({
      "parts/cycle-root.dat": licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 cycle-root.dat"),
      "parts/incomplete-root.dat": licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 absent-child.dat"),
      "parts/license-root.dat": licensed().replace("CC BY 4.0", "CC BY 2.0"),
      "parts/malformed-root.dat": licensed("3 16 1 2 NaN"),
    }));
    for (const name of ["cycle-root", "incomplete-root", "license-root", "malformed-root"]) {
      const doc = await importLDraw(encode(ref(name + ".dat")), "bad.ldr");
      expect(getImportPartFailures(doc.imported)).toHaveLength(1);
      expect(doc.imported!.originalBytes).toEqual([...encode(ref(name + ".dat"))]);
    }
    expect(await builderDatabase.geometrySnapshots.count()).toBe(0);
  });
  it("exhausts the bundled snapshot for dependencies even when the root already exists locally", async () => {
    const doc = await importLDraw(encode(ref("3001.dat")), "local.ldr", "ldr", undefined, { online: false });
    const model = doc.imported!;
    model.instances[0].reference = "local-with-bundled-child.dat";
    model.resources = { "parts/local-with-bundled-child.dat": {
      path: "parts/local-with-bundled-child.dat",
      sourceUrl: "https://library.ldraw.org/library/official/parts/local-with-bundled-child.dat",
      author: "Test Author", license: "CC-BY-4.0", content: licensed("1 16 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat"),
    } };
    const fetcher = serve({}); vi.stubGlobal("fetch", fetcher);
    await resolveGeometry(model);
    expect(model.instances[0].part.status).toBe("resolved");
    expect(fetcher.mock.calls.every(([url]) => String(url).includes(manifest.url))).toBe(true);
  });
  it("preserves BOM and CRLF in source hashes and supports in-flight deduplication", async () => {
    const text = "\uFEFF" + licensed().replaceAll("\n", "\r\n");
    const calls: string[] = [];
    vi.stubGlobal("fetch", serve({ "parts/byte-fixture.dat": text }, calls));
    const first = new OnlineGeometry({}), second = new OnlineGeometry({});
    const [a, b] = await Promise.all([first.get("parts/byte-fixture.dat"), second.get("parts/byte-fixture.dat")]);
    expect(a.content).toBe(text); expect(a.sha256).toBe(await hashBytes(encode(text)));
    expect(a).toEqual(b);
    expect(calls.filter(p => p === "parts/byte-fixture.dat")).toHaveLength(1);
  });
  it("keeps original project and source data on quota failure while reporting the failed cache write", async () => {
    const previous = createEmptyDocument("Previous");
    await saveProject(previous);
    vi.stubGlobal("fetch", serve({ "parts/quota-root.dat": licensed() }));
    vi.spyOn(builderDatabase.geometrySnapshots, "add").mockRejectedValue(new DOMException("Quota exceeded", "QuotaExceededError"));
    const doc = await importLDraw(encode(ref("quota-root.dat")), "quota.ldr");
    expect(doc.imported!.instances[0].part.status).toBe("resolved");
    expect(doc.imported!.issues.some(i => i.code === "geometry-cache")).toBe(true);
    expect(await builderDatabase.geometrySnapshots.count()).toBe(0);
    expect((await loadProject(previous.id))!.name).toBe("Previous");
    expect(doc.imported!.originalBytes).toEqual([...encode(ref("quota-root.dat"))]);
  });
  it("cancels acquisition without destroying the current project or dropping original bytes, then retries", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", serve({ "parts/cancel-root.dat": licensed() }));
    const doc = await importLDraw(encode(ref("cancel-root.dat")), "cancel.ldr", "ldr", undefined, {
      signal: controller.signal, onProgress: () => controller.abort(),
    });
    expect(doc.imported!.issues.some(i => i.code === "geometry-cancelled")).toBe(true);
    expect(await builderDatabase.geometrySnapshots.count()).toBe(0);
    const original = doc.imported!.originalBytes;
    await resolveGeometry(doc.imported!, { retry: true });
    expect(doc.imported!.instances[0].part.status).toBe("resolved");
    expect(doc.imported!.originalBytes).toEqual(original);
    expect(doc.imported!.issues.some(i => i.code === "geometry-cancelled")).toBe(false);
  });
  it("negative-caches a 404 and does not retry a timeout indefinitely", async () => {
    const fetcher = serve({}); vi.stubGlobal("fetch", fetcher);
    await expect(new OnlineGeometry({}).get("parts/negative-fixture.dat")).rejects.toThrow(/404/);
    const count = fetcher.mock.calls.length;
    await expect(new OnlineGeometry({}).get("parts/negative-fixture.dat")).rejects.toThrow(/404/);
    expect(fetcher.mock.calls.length).toBe(count);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("Timeout", "TimeoutError"); }));
    await expect(new OnlineGeometry({}).get("parts/timeout-fixture.dat")).rejects.toThrow(/Timeout/);
  });
});

const privateModel = new URL("../../../../../attached_assets/40649-size_1793502923137.io", import.meta.url);
const archiveDir = new URL("../../../../../generated-artifacts/ldraw-approved/", import.meta.url);
describe.skipIf(!existsSync(privateModel) || !existsSync(new URL("manifest.json", archiveDir)))("private approved-archive coverage", () => {
  it("measures complete compilable closures and preserves all 8,590 external instances", async () => {
    // Use the real approved raw archive bytes, not invented geometry or catalog mappings.
    const archive = JSON.parse(await readFile(new URL("manifest.json", archiveDir), "utf8"));
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      if (String(input).includes(manifest.url)) return new Response(snapshotBytes);
      const path = new URL(input, "https://test.invalid").searchParams.get("path")!;
      if (!archive.files[path]) return new Response("", { status: 404 });
      return sourceResponse(new Uint8Array(await readFile(new URL(path, archiveDir))), `official-archive-sha256:${archive.sha256}`);
    }));
    const bytes = new Uint8Array(await readFile(privateModel));
    const doc = await importIO(bytes, "reference.io", { retry: true });
    const model = doc.imported!;
    expect(model.instances).toHaveLength(8590);
    expect(new Set(model.instances.map(i => i.reference.toLowerCase())).size).toBe(517);
    const resolved = model.instances.filter(i => i.part.status === "resolved");
    const failures = getImportPartFailures(model);
    expect(new Set(resolved.map(i => i.reference.toLowerCase())).size).toBeGreaterThan(400);
    expect(await hashBytes(Uint8Array.from(model.originalBytes))).toBe(await hashBytes(bytes));
    // Printed counts are evidence, not a promise of universal Studio compatibility.
    console.info(JSON.stringify({ referenceCoverage: {
      instances: model.instances.length, resolvedInstances: resolved.length,
      resolvedReferences: new Set(resolved.map(i => i.reference.toLowerCase())).size,
      missingReferences: failures.map(f => ({ reference: f.reference, count: f.count, reason: f.reasons[0] })),
      resources: Object.keys(model.resources).length,
    } }));
    await saveProject(doc);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    expect((await loadProject(doc.id))!.imported!.instances.filter(i => i.part.status === "resolved")).toHaveLength(resolved.length);
  }, 120000);
});
