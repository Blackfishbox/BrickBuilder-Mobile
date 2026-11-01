import { builderDatabase } from "./database";

export interface StorageEntry {
  id: string;
  name: string;
  bytes: number;
  detail: string;
}

export interface StorageOverview {
  projects: StorageEntry[];
  packages: StorageEntry[];
  snapshots: StorageEntry[];
  browser: { usage?: number; quota?: number; error?: string };
}

/** Logical UTF-8 payload size, not the browser's IndexedDB allocation size. */
export function estimateRecordBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

async function browserEstimate(): Promise<StorageOverview["browser"]> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
      return { error: "Dieser Browser stellt keine Speicherschätzung bereit." };
    }
    const estimate = await navigator.storage.estimate();
    const valid = (value?: number) =>
      value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
    const usage = valid(estimate.usage);
    const quota = valid(estimate.quota);
    return {
      usage, quota,
      ...(usage === undefined || quota === undefined
        ? { error: "Der Browser liefert nur eine unvollständige Speicherschätzung." } : {}),
    };
  } catch {
    return { error: "Die Browser-Speicherschätzung ist momentan nicht verfügbar." };
  }
}

export async function getStorageOverview(): Promise<StorageOverview> {
  const browser = await browserEstimate();
  return builderDatabase.transaction("r", [
    builderDatabase.projects, builderDatabase.partPackages, builderDatabase.libraryParts,
    builderDatabase.libraryFiles, builderDatabase.geometrySnapshots,
  ], async () => {
    const projects = await builderDatabase.projects.orderBy("updatedAt").reverse().toArray();
    const packages = await builderDatabase.partPackages.toArray();
    const snapshots = await builderDatabase.geometrySnapshots.orderBy("createdAt").reverse().toArray();
    const packageEntries = await Promise.all(packages.map(async pkg => {
      const parts = await builderDatabase.libraryParts.where("packageId").equals(pkg.id).toArray();
      const files = await builderDatabase.libraryFiles.where("packageId").equals(pkg.id).toArray();
      return {
        id: pkg.id, name: pkg.title,
        bytes: estimateRecordBytes(pkg) + parts.reduce((sum, p) => sum + estimateRecordBytes(p), 0)
          + files.reduce((sum, f) => sum + estimateRecordBytes(f), 0),
        detail: `${parts.length} Teile · ${files.length} Dateien · Version ${pkg.version}`,
      };
    }));
    return {
      browser,
      projects: projects.map(project => ({
        id: project.id, name: project.name || "Neues Modell",
        bytes: estimateRecordBytes(project),
        detail: `${project.bricks.length + (project.imported?.instances.length ?? 0)} Steine${project.imported ? " · mit Originaldatei und Import-Ressourcen" : ""}`,
      })),
      packages: packageEntries,
      snapshots: snapshots.map(snapshot => ({
        id: snapshot.id, name: snapshot.roots.join(", ") || "Import-Geometrie",
        bytes: estimateRecordBytes(snapshot),
        detail: `${snapshot.files.length} Dateien · ${new Date(snapshot.createdAt).toLocaleString("de-DE")}`,
      })),
    };
  });
}

/** Only the reusable copy is removed; project-owned resources are independent. */
export async function removeGeometrySnapshot(id: string): Promise<void> {
  await builderDatabase.geometrySnapshots.delete(id);
}

/** Explicit user action only. Package files are never quota-evicted. */
export async function removeInstalledPackage(id: string): Promise<void> {
  await builderDatabase.transaction("rw", [
    builderDatabase.partPackages, builderDatabase.libraryParts, builderDatabase.libraryFiles,
  ], async () => {
    await builderDatabase.libraryParts.where("packageId").equals(id).delete();
    await builderDatabase.libraryFiles.where("packageId").equals(id).delete();
    await builderDatabase.partPackages.delete(id);
  });
}

export async function removeStoredProject(id: string, currentProjectId: string): Promise<void> {
  await builderDatabase.transaction("rw", builderDatabase.projects, builderDatabase.metadata, async () => {
    const active = await builderDatabase.metadata.get("activeProjectId");
    // Protect both the mounted editor and the persisted pointer (including another tab).
    if (id === currentProjectId || id === active?.value) {
      throw new Error("Dieses Projekt ist geöffnet. Öffne zuerst ein anderes Projekt, bevor du es löschst.");
    }
    await builderDatabase.projects.delete(id);
    await builderDatabase.metadata.delete("project-summary:" + id);
  });
}
