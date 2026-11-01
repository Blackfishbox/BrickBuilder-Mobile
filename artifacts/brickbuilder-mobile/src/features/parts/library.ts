import { z } from "zod";
import { builderDatabase } from "@/storage/database";
import catalog from "./catalog.json";
import type { PackageManifest, PackagePayload, LibraryPart } from "./types";
import { mappingEvidenceSchema } from "./mapping-schema";

export const PART_PACKAGES = catalog as PackageManifest[];
const safePath = z.string().regex(/^(parts|p)\/[a-z0-9_/-]+\.dat$/);
const payloadSchema = z.object({
  id: z.string(),
  version: z.string(),
  parts: z.array(z.object({
    id: z.string(), packageId: z.string(), ldrawId: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(), category: z.string(), keywords: z.array(z.string()), file: safePath,
    mappings: z.array(mappingEvidenceSchema).optional(),
  })),
  files: z.array(z.object({
    path: safePath, sourceUrl: z.string().url(), author: z.string().min(1),
    license: z.enum(["CC-BY-4.0", "CC0-1.0"]), content: z.string().min(1),
  })),
  legalDocuments: z.array(z.object({
    name: z.string(), sourceUrl: z.string().url(), content: z.string().min(1),
  })),
});

export function validatePayload(input: unknown, manifest: PackageManifest): PackagePayload {
  const payload = payloadSchema.parse(input);
  if (payload.id !== manifest.id || payload.version !== manifest.version ||
      payload.parts.length !== manifest.partCount || payload.files.length !== manifest.fileCount) {
    throw new Error("Paket stimmt nicht mit dem Katalog überein.");
  }
  const paths = new Set(payload.files.map(file => file.path));
  for (const name of ["CAreadme.txt", "CAlicense4.txt"]) {
    if (!payload.legalDocuments.some(doc => doc.name === name &&
      doc.sourceUrl === `https://library.ldraw.org/library/official/${name}`)) {
      throw new Error("Lizenztext fehlt im Paket.");
    }
  }
  if (paths.size !== payload.files.length ||
      new Set(payload.parts.map(part => part.id)).size !== payload.parts.length) {
    throw new Error("Doppelte Einträge im Teilepaket.");
  }
  for (const part of payload.parts) {
    if (part.packageId !== payload.id || part.id !== `${payload.id}:${part.ldrawId}` ||
        part.file !== `parts/${part.ldrawId}.dat` || !paths.has(part.file)) {
      throw new Error("Ungültige Teilezuordnung.");
    }
    for (const evidence of part.mappings ?? []) {
      const file = payload.files.find(f => f.path === part.file)!;
      const explicitIds = [...evidence.sourceLine.matchAll(/\bBrickLink\s+([a-z0-9_-]+)/gi)].map(m => m[1]);
      if (evidence.ldrawId !== part.ldrawId || evidence.sourceUrl !== file.sourceUrl ||
          evidence.author !== file.author || evidence.license !== file.license ||
          !/^0 !KEYWORDS /i.test(evidence.sourceLine) ||
          !file.content.split(/\r?\n/).includes(evidence.sourceLine) ||
          !explicitIds.includes(evidence.brickLinkId)) throw new Error("Unbelegte BrickLink-Zuordnung.");
    }
  }
  for (const file of payload.files) {
    const licenseHeader = file.license === "CC-BY-4.0"
      ? "0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt"
      : "0 !LICENSE Licensed under CC0 : see CAreadme.txt";
    const licensed = file.content.split(/\r?\n/).some(line => line === licenseHeader ||
      (file.license === "CC-BY-4.0" &&
       line === "0 !LICENSE Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt"));
    if (file.sourceUrl !== `https://library.ldraw.org/library/official/${file.path}` ||
        !licensed) throw new Error("Lizenz oder Quelle nicht freigegeben.");
    for (const line of file.content.split(/\r?\n/)) {
      if (!/^1\s/.test(line)) continue;
      const ref = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
      if (ref.includes("..") || !(paths.has(`parts/${ref}`) || paths.has(`p/${ref}`))) {
        throw new Error(`Fehlendes Unterteil: ${ref}`);
      }
    }
  }
  return payload;
}

export async function installPackage(id: string, signal?: AbortSignal): Promise<void> {
  const manifest = PART_PACKAGES.find(pkg => pkg.id === id);
  if (!manifest) throw new Error("Unbekanntes Teilepaket.");
  const response = await fetch(`${import.meta.env.BASE_URL}${manifest.url}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Download fehlgeschlagen (HTTP ${response.status}).`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== manifest.bytes) throw new Error("Unvollständiger Paketdownload.");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (hash !== manifest.sha256) throw new Error("Die Prüfsumme des Pakets ist ungültig.");
  const payload = validatePayload(JSON.parse(new TextDecoder().decode(bytes)), manifest);
  for (const part of payload.parts) {
    for (const evidence of part.mappings ?? []) {
      const file = payload.files.find(f => f.path === part.file)!;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file.content));
      const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      if (actual !== evidence.sourceSha256) throw new Error("Zuordnungsquelle: Prüfsumme stimmt nicht.");
    }
  }
  signal?.throwIfAborted();
  await builderDatabase.transaction("rw",
    builderDatabase.partPackages, builderDatabase.libraryParts, builderDatabase.libraryFiles, async () => {
      await builderDatabase.libraryParts.where("packageId").equals(id).delete();
      await builderDatabase.libraryFiles.where("packageId").equals(id).delete();
      await builderDatabase.libraryParts.bulkPut(payload.parts);
      await builderDatabase.libraryFiles.bulkPut(payload.files.map(file => ({
        ...file, id: `${id}:${file.path}`, packageId: id,
      })));
      await builderDatabase.partPackages.put({
        ...manifest, installedAt: new Date().toISOString(), legalDocuments: payload.legalDocuments,
      });
    });
}

export async function listInstalledPackages() {
  return builderDatabase.partPackages.toArray();
}

export async function searchLocalParts(query = "", category = ""): Promise<LibraryPart[]> {
  // No network path here: installed catalogue remains available offline.
  const normalize = (text: string) => text.toLocaleLowerCase("de")
    .replaceAll("×", "x").replace(/(\d+)\s*x\s*(\d+)/g, "$1x$2");
  const terms = normalize(query.trim()).split(/\s+/).filter(Boolean);
  const parts = await builderDatabase.libraryParts.toArray();
  return parts.filter(part => {
    const text = normalize(`${part.name} ${part.ldrawId} ${part.category} ${part.keywords.join(" ")}`);
    return (!category || part.category === category) && terms.every(term => text.includes(term));
  }).sort((a, b) => a.name.localeCompare(b.name, "de", { numeric: true }));
}

export async function getLocalPartFiles(packageId: string) {
  return builderDatabase.libraryFiles.where("packageId").equals(packageId).toArray();
}
