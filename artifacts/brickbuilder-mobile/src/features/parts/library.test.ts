import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builderDatabase, loadCurrentProject, saveProject } from "@/storage/database";
import { createEmptyDocument } from "@/features/editor/model";
import {
  getLocalPartFiles, installPackage, listInstalledPackages,
  PART_PACKAGES, searchLocalParts, validatePayload,
} from "./library";

async function packageBytes(index = 0) {
  return readFile(new URL(`../../../public/${PART_PACKAGES[index].url}`, import.meta.url));
}

function mockPackageDownload(bytes: Uint8Array) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(new Uint8Array(bytes))));
}

describe("offline LDraw packages", () => {
  beforeEach(async () => {
    await builderDatabase.open();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await builderDatabase.delete();
  });

  it("ships complete packages with verified hashes, attribution, and original license headers", async () => {
    for (let index = 0; index < PART_PACKAGES.length; index++) {
      const manifest = PART_PACKAGES[index];
      const bytes = await packageBytes(index);
      expect(bytes.byteLength).toBe(manifest.bytes);
      const hash = Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex");
      expect(hash).toBe(manifest.sha256);
      const payload = validatePayload(JSON.parse(bytes.toString()), manifest);
      expect(payload.legalDocuments.map(doc => doc.name)).toEqual(["CAreadme.txt", "CAlicense4.txt"]);
      for (const file of payload.files) {
        expect(manifest.attribution).toContain(file.author);
        expect(file.content).toContain("0 !LICENSE Licensed under CC BY 4.0");
      }
      expect(payload.parts.every(part => !("brickLinkId" in part))).toBe(true);
    }
  });

  it("downloads packages separately and searches persisted parts with no network after reopening", async () => {
    mockPackageDownload(await packageBytes());
    await installPackage("ldraw-bricks");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(PART_PACKAGES[0].url), expect.anything());
    expect((await listInstalledPackages()).map(pkg => pkg.id)).toEqual(["ldraw-bricks"]);
    expect(await searchLocalParts("", "Platten")).toHaveLength(0);
    expect(await getLocalPartFiles("ldraw-bricks")).toHaveLength(PART_PACKAGES[0].fileCount);
    builderDatabase.close();
    await builderDatabase.open();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect((await searchLocalParts("3001"))[0]).toMatchObject({
      id: "ldraw-bricks:3001", ldrawId: "3001", packageId: "ldraw-bricks",
    });
    expect(await searchLocalParts("bRiCk 2 x 4", "Steine")).toHaveLength(1);
    expect((await listInstalledPackages())[0].legalDocuments[1].content).toContain("Attribution");
    expect(fetch).not.toHaveBeenCalled();
    mockPackageDownload(await packageBytes(1));
    await installPackage("ldraw-plates");
    expect(await searchLocalParts()).toHaveLength(12);
    expect(await searchLocalParts("Platten")).toHaveLength(6);
    expect(await searchLocalParts("nonexistent")).toHaveLength(0);
    expect(await listInstalledPackages()).toHaveLength(2);
  });

  it("keeps existing installations and projects intact on interrupted, corrupt, or failed downloads", async () => {
    const bytes = await packageBytes();
    const project = createEmptyDocument("Nicht verlieren");
    await saveProject(project);
    mockPackageDownload(bytes);
    await installPackage("ldraw-bricks");
    mockPackageDownload(bytes.subarray(0, 100));
    await expect(installPackage("ldraw-bricks")).rejects.toThrow("Unvollständiger");
    const corrupt = new Uint8Array(bytes);
    corrupt[0] ^= 1;
    mockPackageDownload(corrupt);
    await expect(installPackage("ldraw-bricks")).rejects.toThrow("Prüfsumme");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(installPackage("ldraw-plates")).rejects.toThrow("503");
    mockPackageDownload(bytes);
    const controller = new AbortController();
    controller.abort();
    await expect(installPackage("ldraw-bricks", controller.signal)).rejects.toThrow();
    expect(await searchLocalParts()).toHaveLength(6);
    expect(await listInstalledPackages()).toHaveLength(1);
    expect((await loadCurrentProject())?.id).toBe(project.id);
  });

  it("rolls back all package changes when IndexedDB fails mid-transaction", async () => {
    mockPackageDownload(await packageBytes());
    await installPackage("ldraw-bricks");
    const before = await getLocalPartFiles("ldraw-bricks");
    vi.spyOn(builderDatabase.libraryFiles, "bulkPut").mockRejectedValueOnce(new Error("QuotaExceededError"));
    await expect(installPackage("ldraw-bricks")).rejects.toThrow("QuotaExceededError");
    expect(await searchLocalParts()).toHaveLength(6);
    expect(await getLocalPartFiles("ldraw-bricks")).toEqual(before);
    expect(await listInstalledPackages()).toHaveLength(1);
  });

  it("rejects wrong package identities, unknown licenses and missing dependencies", async () => {
    const payload = JSON.parse((await packageBytes()).toString());
    expect(() => validatePayload({ ...payload, id: "other" }, PART_PACKAGES[0])).toThrow();
    const invalidLicense = structuredClone(payload);
    invalidLicense.files[0].license = "proprietary";
    expect(() => validatePayload(invalidLicense, PART_PACKAGES[0])).toThrow();
    const missing = structuredClone(payload);
    missing.files[0].content += "\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 missing.dat\n";
    expect(() => validatePayload(missing, PART_PACKAGES[0])).toThrow("Fehlendes Unterteil");
    expect(() => validatePayload({ ...payload, legalDocuments: [] }, PART_PACKAGES[0])).toThrow("Lizenztext");
    await expect(installPackage("unknown")).rejects.toThrow("Unbekanntes");
  });

  it("upgrades v1 storage without losing a project or its active selection", async () => {
    await builderDatabase.delete();
    const oldDatabase = new Dexie("brickbuilder-mobile");
    oldDatabase.version(1).stores({ projects: "id, name, updatedAt", metadata: "key" });
    const project = createEmptyDocument("Vor dem Upgrade");
    await oldDatabase.table("projects").put(project);
    await oldDatabase.table("metadata").put({ key: "activeProjectId", value: project.id });
    oldDatabase.close();
    await builderDatabase.open();
    expect((await loadCurrentProject())?.id).toBe(project.id);
    expect(await listInstalledPackages()).toEqual([]);
  });
});
