import Dexie, { type Table } from "dexie";

import type { BuilderDocument } from "@/features/editor/model";
import type { InstalledPackage, LibraryPart, StoredLibraryFile } from "@/features/parts/types";

interface AppMetadata {
  key: string;
  value: string;
}

class BuilderDatabase extends Dexie {
  projects!: Table<BuilderDocument, string>;
  metadata!: Table<AppMetadata, string>;
  partPackages!: Table<InstalledPackage, string>;
  libraryParts!: Table<LibraryPart, string>;
  libraryFiles!: Table<StoredLibraryFile, string>;

  constructor() {
    super("brickbuilder-mobile");
    this.version(1).stores({
      projects: "id, name, updatedAt",
      metadata: "key",
    });
    this.version(2).stores({
      projects: "id, name, updatedAt",
      metadata: "key",
      partPackages: "id",
      libraryParts: "id, packageId, ldrawId, category",
      libraryFiles: "id, packageId",
    });
  }
}

export const builderDatabase = new BuilderDatabase();

export async function saveProject(document: BuilderDocument): Promise<void> {
  const savedDocument = { ...document, updatedAt: new Date().toISOString() };
  await builderDatabase.transaction("rw", builderDatabase.projects, builderDatabase.metadata, async () => {
    await builderDatabase.projects.put(savedDocument);
    await builderDatabase.metadata.put({
      key: "activeProjectId",
      value: savedDocument.id,
    });
  });
}

export async function loadCurrentProject(): Promise<BuilderDocument | null> {
  const active = await builderDatabase.metadata.get("activeProjectId");
  if (active) {
    const project = await builderDatabase.projects.get(active.value);
    if (project) return project;
  }
  return (await builderDatabase.projects.orderBy("updatedAt").last()) ?? null;
}

export async function loadProject(id: string): Promise<BuilderDocument | null> {
  return (await builderDatabase.projects.get(id)) ?? null;
}

export async function listProjects(): Promise<BuilderDocument[]> {
  return builderDatabase.projects.orderBy("updatedAt").reverse().toArray();
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
