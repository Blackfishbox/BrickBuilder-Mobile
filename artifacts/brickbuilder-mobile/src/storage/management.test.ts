import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@/features/editor/model";
import { parseLDraw } from "@/features/formats/ldraw/parser";
import { resolveGeometry } from "@/features/formats/geometry-resolver";
import { compilePart } from "@/features/engine/ldraw-geometry";
import { exportInternal, importInternal } from "@/features/formats/internal/adapter";
import type { RetrievalSnapshot } from "@/features/formats/types";
import type { LibraryFile } from "@/features/parts/types";
import { builderDatabase, loadCurrentProject, loadProject, saveProject } from "./database";
import {
  estimateRecordBytes, getStorageOverview, removeGeometrySnapshot,
  removeInstalledPackage, removeStoredProject,
} from "./management";

const file: LibraryFile = {
  path: "parts/storage-test.dat", author: "Fixture author", license: "CC-BY-4.0",
  sourceUrl: "https://library.ldraw.org/library/official/parts/storage-test.dat",
  content: "0 Storage fixture\n0 Author: Fixture author\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n3 16 0 0 0 20 0 0 0 20 0\n",
};
const legalDocuments = [{
  name: "CAreadme.txt", sourceUrl: "https://library.ldraw.org/library/official/CAreadme.txt",
  content: "Unmodified legal fixture — attribution retained.",
}];
const snapshot: RetrievalSnapshot = {
  version: 1, id: "snapshot-one", createdAt: "2026-11-01T00:00:00Z",
  roots: ["storage-test.dat"], graph: { [file.path]: [] }, files: [file], legalDocuments,
};

async function seed() {
  const project = createEmptyDocument("Original upload");
  const sourceText = "0 Original upload\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 storage-test.dat\n";
  project.imported = {
    version: 1, format: "ldr", sourceName: "original.ldr", sourceText,
    originalBytes: Array.from(new TextEncoder().encode(sourceText)),
    ...parseLDraw(sourceText), resources: {}, legalDocuments: [],
  };
  project.imported.resources[file.path] = file;
  project.imported.legalDocuments = legalDocuments;
  project.imported.instances[0].part.status = "resolved";
  project.imported.retrievalSnapshots = [{ ...snapshot, files: [] }];
  await saveProject(project);
  await builderDatabase.geometrySnapshots.add(snapshot);
  await builderDatabase.partPackages.add({
    id: "fixture-package", title: "Installed fixture", version: "1", description: "",
    url: "", sha256: "", bytes: 1, partCount: 1, fileCount: 1, sourceUrl: "",
    licenseUrl: "", licenses: ["CC-BY-4.0"], attribution: "Fixture author", changes: "",
    installedAt: snapshot.createdAt, legalDocuments,
  });
  await builderDatabase.libraryFiles.add({ ...file, id: `fixture-package:${file.path}`, packageId: "fixture-package" });
  await builderDatabase.libraryParts.add({
    id: "fixture-package:storage-test", packageId: "fixture-package", ldrawId: "storage-test",
    name: "Fixture", category: "Test", keywords: [], file: file.path,
  });
  return (await loadProject(project.id))!;
}

beforeEach(async () => { await builderDatabase.open(); });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await builderDatabase.delete();
});

describe("user-controlled offline storage", () => {
  it("separates logical payload estimates from whole-origin browser usage", async () => {
    const project = await seed();
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn().mockResolvedValue({ usage: 50000, quota: 100000 }) } });
    const overview = await getStorageOverview();
    expect(overview.browser).toEqual({ usage: 50000, quota: 100000 });
    expect(overview.projects[0].bytes).toBe(estimateRecordBytes(project));
    expect(overview.snapshots[0].bytes).toBe(estimateRecordBytes(snapshot));
    expect(overview.packages[0].bytes).toBeGreaterThan(1); // Not compressed download size.
    expect(estimateRecordBytes("ä")).toBe(4);
  });

  it("still lists records when browser storage estimates are unsupported or rejected", async () => {
    await seed();
    vi.stubGlobal("navigator", {});
    expect((await getStorageOverview()).browser).toEqual({ error: expect.any(String) });
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn().mockRejectedValue(new Error("denied")) } });
    const overview = await getStorageOverview();
    expect(overview.browser.usage).toBeUndefined();
    expect(overview.browser.error).toBeTruthy();
    expect(overview.projects).toHaveLength(1);
    vi.stubGlobal("navigator", { storage: { estimate: vi.fn().mockResolvedValue({ quota: NaN }) } });
    expect((await getStorageOverview()).browser.error).toBeTruthy();
  });

  it("removes only the selected reusable snapshot and keeps project uploads, credits and legal bytes unchanged", async () => {
    const project = await seed();
    await builderDatabase.geometrySnapshots.add({ ...snapshot, id: "keep" });
    await removeGeometrySnapshot(snapshot.id);
    expect(await builderDatabase.geometrySnapshots.toArray()).toEqual([{ ...snapshot, id: "keep" }]);
    expect(await loadProject(project.id)).toEqual(project);
    expect(await builderDatabase.partPackages.count()).toBe(1);
    expect(await builderDatabase.libraryFiles.count()).toBe(1);
  });

  it("keeps retained projects renderable, re-resolvable offline and exportable after removing all external copies", async () => {
    const project = await seed();
    await removeGeometrySnapshot(snapshot.id);
    await removeInstalledPackage("fixture-package");
    const retained = (await loadProject(project.id))!;
    expect(retained).toEqual(project);
    const fetch = vi.fn().mockRejectedValue(new Error("Must not fetch"));
    vi.stubGlobal("fetch", fetch);
    await resolveGeometry(retained.imported!, { online: false });
    expect(retained.imported!.instances[0].part.status).toBe("resolved");
    expect(compilePart(retained.imported!, "storage-test.dat", "4")[0].positions.length).toBeGreaterThan(0);
    expect(fetch).not.toHaveBeenCalled();
    const restored = importInternal(exportInternal(retained));
    expect(restored.imported!.originalBytes).toEqual(project.imported!.originalBytes);
    expect(restored.imported!.resources).toEqual(project.imported!.resources);
    expect(restored.imported!.legalDocuments).toEqual(expect.arrayContaining(legalDocuments));
    expect(await builderDatabase.partPackages.count()).toBe(0);
    expect(await builderDatabase.libraryParts.count()).toBe(0);
    expect(await builderDatabase.libraryFiles.count()).toBe(0);
  });

  it("rolls package deletion back on failure and leaves unrelated packages and snapshots alone", async () => {
    await seed();
    const before = await builderDatabase.libraryFiles.toArray();
    vi.spyOn(builderDatabase.partPackages, "delete").mockRejectedValueOnce(new Error("write failed"));
    await expect(removeInstalledPackage("fixture-package")).rejects.toThrow("write failed");
    expect(await builderDatabase.libraryFiles.toArray()).toEqual(before);
    expect(await builderDatabase.libraryParts.count()).toBe(1);
    const pkg = (await builderDatabase.partPackages.toArray())[0];
    await builderDatabase.partPackages.add({ ...pkg, id: "other" });
    await removeInstalledPackage("fixture-package");
    expect((await builderDatabase.partPackages.toArray()).map(p => p.id)).toEqual(["other"]);
    expect(await builderDatabase.geometrySnapshots.count()).toBe(1);
  });

  it("protects both mounted and persisted active projects, deletes only the selected inactive project", async () => {
    const retained = await seed();
    const active = createEmptyDocument("Active");
    await saveProject(active);
    await expect(removeStoredProject(retained.id, retained.id)).rejects.toThrow("geöffnet");
    await expect(removeStoredProject(active.id, retained.id)).rejects.toThrow("geöffnet");
    await removeStoredProject(retained.id, active.id);
    expect(await loadProject(retained.id)).toBeNull();
    expect((await loadCurrentProject())!.id).toBe(active.id);
    expect(await builderDatabase.geometrySnapshots.count()).toBe(1);
    expect(await builderDatabase.partPackages.count()).toBe(1);
  });
});
