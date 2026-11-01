import Dexie, { type Table } from "dexie";

import type { BuilderDocument } from "@/features/editor/model";
import type { InstalledPackage, LibraryPart, StoredLibraryFile } from "@/features/parts/types";
import type { RetrievalSnapshot } from "@/features/formats/types";

interface AppMetadata {
  key: string;
  value: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  brickCount: number;
}
const SUMMARY_PREFIX = "project-summary:";
function summaryMetadata(document: BuilderDocument): AppMetadata {
  const summary: ProjectSummary = {
    id: document.id, name: document.name, updatedAt: document.updatedAt,
    brickCount: document.bricks.length + (document.imported?.instances.length ?? 0),
  };
  return { key: SUMMARY_PREFIX + document.id, value: JSON.stringify(summary) };
}

class BuilderDatabase extends Dexie {
  projects!: Table<BuilderDocument, string>;
  metadata!: Table<AppMetadata, string>;
  partPackages!: Table<InstalledPackage, string>;
  libraryParts!: Table<LibraryPart, string>;
  libraryFiles!: Table<StoredLibraryFile, string>;
  geometrySnapshots!: Table<RetrievalSnapshot, string>;
  catalogSnapshots!: Table<{ id: string; bytes: Uint8Array }, string>;

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
    this.version(3).stores({ geometrySnapshots: "id, createdAt" });
    this.version(4).stores({ catalogSnapshots: "id" });
  }
}

export const builderDatabase = new BuilderDatabase();

export async function saveProject(document: BuilderDocument): Promise<void> {
  const savedDocument = { ...document, updatedAt: new Date().toISOString() };
  await builderDatabase.transaction("rw", builderDatabase.projects, builderDatabase.metadata, async () => {
    await builderDatabase.projects.put(savedDocument);
    await builderDatabase.metadata.put(summaryMetadata(savedDocument));
    await builderDatabase.metadata.put({
      key: "activeProjectId",
      value: savedDocument.id,
    });
  });
}

/** Single transaction protects both the previous model and active project pointer. */
export async function createImportedProject(previous: BuilderDocument, imported: BuilderDocument): Promise<void> {
  if (previous.id === imported.id) throw new Error("Import muss ein neues Projekt anlegen.");
  await builderDatabase.transaction("rw", builderDatabase.projects, builderDatabase.metadata, async () => {
    if (await builderDatabase.projects.get(imported.id)) throw new Error("Projekt-ID bereits vorhanden.");
    await builderDatabase.projects.put(previous);
    await builderDatabase.projects.add(imported);
    await builderDatabase.metadata.bulkPut([summaryMetadata(previous), summaryMetadata(imported)]);
    await builderDatabase.metadata.put({ key: "activeProjectId", value: imported.id });
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

/** Lists never retain a second full copy of every imported model and archive. */
export async function listProjectSummaries(): Promise<ProjectSummary[]> {
  const ids = await builderDatabase.projects.toCollection().primaryKeys();
  const cached = await builderDatabase.metadata.bulkGet(ids.map(id => SUMMARY_PREFIX + id));
  const result: ProjectSummary[] = [];
  for (let index = 0; index < ids.length; index++) {
    let summary: ProjectSummary | undefined;
    if (cached[index]) {
      try {
        const parsed = JSON.parse(cached[index]!.value) as ProjectSummary;
        if (parsed.id === ids[index] && typeof parsed.name === "string" &&
            typeof parsed.updatedAt === "string" && Number.isFinite(parsed.brickCount)) summary = parsed;
      } catch { /* Rebuild missing or malformed derived metadata from its project. */ }
    }
    if (!summary) {
      // Legacy projects are visited one at a time, never loaded into one array.
      summary = await builderDatabase.transaction("rw", builderDatabase.projects, builderDatabase.metadata, async () => {
        const document = await builderDatabase.projects.get(ids[index]);
        if (!document) return undefined;
        const metadata = summaryMetadata(document);
        await builderDatabase.metadata.put(metadata);
        return JSON.parse(metadata.value) as ProjectSummary;
      });
    }
    if (summary) result.push(summary);
  }
  return result.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
