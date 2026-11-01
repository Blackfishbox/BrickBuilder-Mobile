import { gunzipSync } from "fflate";
import { builderDatabase } from "@/storage/database";
import type { LibraryFile, PackagePayload } from "../parts/types";
import type { ImportedModel } from "./types";
import manifest from "./geometry-manifest.json";
import { resolveColor } from "./colors";
import { refreshModelColors } from "./model-colors";
import { compilePart, invalidateGeometry } from "../engine/ldraw-geometry";
import { MAPPING_LEGAL_DOCUMENT, resolvePartMapping } from "../parts/bricklink-evidence";
import { candidates, dependencies, inspectFile, normalizeReference } from "@workspace/ldraw-source";
import { findOnline, hashBytes, OnlineGeometry, type ResolveOptions } from "./online-geometry";
import type { RetrievalSnapshot } from "./types";
import { ensureCatalog, catalogManifest, getCatalogState } from "../catalog/client";

interface Snapshot {
  files: LibraryFile[];
  parts: { ldrawId: string; name: string; file: string }[];
  legalDocuments: PackagePayload["legalDocuments"];
}
export async function resolveGeometry(model: ImportedModel, options: ResolveOptions = {}): Promise<void> {
  if (typeof Worker !== "undefined") await ensureCatalog().catch(() => undefined);
  const managedIssues = new Set(["geometry-download", "missing-part", "geometry-invalid", "geometry-color",
    "missing-color", "missing-bl-color", "missing-bl-part", "ambiguous-bl-part", "textures", "geometry-cache", "geometry-cancelled"]);
  model.issues = model.issues.filter(issue => !managedIssues.has(issue.code));
  invalidateGeometry(model);
  const local = await builderDatabase.libraryFiles.toArray();
  const parts = await builderDatabase.libraryParts.toArray();
  const packages = await builderDatabase.partPackages.toArray();
  const cached = await builderDatabase.geometrySnapshots.toArray();
  const available: Record<string, LibraryFile> = Object.create(null);
  for (const file of Object.values(model.resources)) available[file.path] = file;
  for (const file of local) available[file.path] ??= file;
  for (const cache of cached) for (const file of cache.files) {
    if (available[file.path]) continue;
    try {
      // Unchanged UTF-8 encoding preserves BOM/CRLF, so hashes still cover the acquired bytes.
      if (file.sha256) {
        const bytes = new TextEncoder().encode(file.content);
        if (await hashBytes(bytes) !== file.sha256 || bytes.length !== file.byteLength) throw new Error("Cache-Prüfsumme ungültig.");
        const inspected = inspectFile(file.path, bytes);
        if (inspected.sourceUrl !== file.sourceUrl || inspected.license !== file.license || inspected.author !== file.author) throw new Error("Cache-Herkunft ungültig.");
      }
      available[file.path] = file;
    } catch {
      if (!model.issues.some(issue => issue.code === "geometry-cache")) model.issues.push({
        code: "geometry-cache", message: "Ein beschädigter Cache-Eintrag wurde nicht verwendet; Originalprojekte bleiben unverändert.",
      });
    }
  }
  const key = (ref: string) => { try { return normalizeReference(ref); } catch { return ref.toLowerCase(); } };
  const needed = [...new Set(model.instances.map(i => key(i.reference)))];
  let snapshot: Snapshot | undefined;
  let snapshotAttempted = false;
  async function loadSnapshot() {
    if (snapshotAttempted) return;
    snapshotAttempted = true;
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${manifest.url}`, { signal: options.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== manifest.bytes) throw new Error("Paketgröße stimmt nicht.");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      if (Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("") !== manifest.sha256) throw new Error("Prüfsumme stimmt nicht.");
      snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bytes))) as Snapshot;
      for (const file of snapshot.files) available[file.path] ??= file;
    } catch (error) {
      model.issues.push({ code: "geometry-download", message: `Geometriepaket nicht verfügbar: ${error instanceof Error ? error.message : String(error)}. Fehlende Teile bleiben erhalten; Import später mit Netzwerk erneut versuchen.` });
    }
  }
  if (needed.some(ref => {
    try { return !candidates(ref).some(path => available[path]); } catch { return false; }
  })) await loadSnapshot();
  const included = new Set<string>();
  const graph: Record<string, string[]> = Object.create(null);
  const online = new OnlineGeometry(options);
  const downloaded = new Set<string>();
  let completed = 0;
  const progress = (reference?: string) => options.onProgress?.({
    files: online.files, bytes: online.bytes, roots: completed, total: needed.length, reference,
  });
  async function locate(reference: string): Promise<string> {
    const paths = candidates(reference);
    const found = paths.find(path => available[path]);
    if (found) return found;
    // A locally known root can still need a bundled primitive or subpart.
    await loadSnapshot();
    const bundled = paths.find(path => available[path]);
    if (bundled) return bundled;
    if (options.online === false || options.signal?.aborted) throw new Error("Keine lokale Geometrie verfügbar.");
    const file = await findOnline(reference, online);
    available[file.path] ??= file;
    downloaded.add(file.path);
    progress(reference);
    return file.path;
  }
  async function collect(path: string, chain: string[], closure: Set<string>): Promise<void> {
    if (chain.includes(path) || chain.length > 48) throw new Error(`Zyklische/zu tiefe Geometrie: ${path}`);
    if (closure.has(path)) return;
    if (closure.size > 3000) throw new Error("Geometrie-Dateibudget überschritten.");
    const file = available[path];
    if (!file) throw new Error(`LDraw-Datei fehlt: ${path}`);
    graph[path] = [];
    for (const ref of dependencies(file.content)) {
      const child = await locate(ref);
      graph[path].push(child);
      await collect(child, [...chain, path], closure);
    }
    closure.add(path);
  }
  for (const reference of needed) {
    let error: string | undefined;
    try {
      const closure = new Set<string>();
      await collect(await locate(reference), [], closure);
      for (const path of closure) included.add(path);
    }
    catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    completed++; progress(reference);
    const matching = model.instances.filter(i => key(i.reference) === reference);
    const entry = parts.find(p => `${p.ldrawId.toLowerCase()}.dat` === reference);
    const snapPart = snapshot?.parts.find(p => p.file === `parts/${reference}`);
    const mapping = resolvePartMapping(reference, parts, matching.flatMap(instance => instance.part.mapping?.candidates ?? []));
    const confirmed = mapping.status === "confirmed" ? mapping.candidates[0] : undefined;
    for (const instance of matching) {
      instance.part = {
        ...instance.part,
        ldrawId: instance.part.ldrawId,
        // Studio part namespace is not inferred from the LDraw filename.
        name: confirmed?.name ?? entry?.name ?? snapPart?.name,
        mapping,
        brickLinkId: confirmed?.brickLinkId,
        status: error ? "missing" : "resolved",
      };
    }
    if (mapping.status === "ambiguous") model.issues.push({
      code: "ambiguous-bl-part", reference, count: matching.length,
      message: `${reference}: widersprüchliche BrickLink-Nachweise (${[...new Set(mapping.candidates.map(c => c.brickLinkId))].join(", ")}). Keine Teilenummer ausgewählt; Varianten und Quellen im Zuordnungsbericht.`,
    });
    if (error) model.issues.push({ code: "missing-part", reference, count: matching.length, message: `${reference}: ${error}. Nicht gerendert, Quelldaten erhalten.` });
  }
  for (const path of included) model.resources[path] = available[path];
  // Geometry compilation is part of validation, not a late canvas crash.
  for (const reference of needed) {
    const instances = model.instances.filter(i => key(i.reference) === reference && i.part.status === "resolved");
    for (const code of new Set(instances.map(i => i.colorCode))) {
      try {
        const surfaces = compilePart(model, reference, code);
        if (!surfaces.some(surface => surface.positions.length)) throw new Error("Keine darstellbaren Flächen.");
        for (const surface of surfaces) {
          if (!resolveColor(surface.colorCode)) model.issues.push({ code: "geometry-color", reference: surface.colorCode, message: `Feste Geometriefarbe ${surface.colorCode} nicht zugeordnet; Warnfarbe Magenta.` });
        }
      } catch (error) {
        for (const instance of instances) instance.part.status = "missing";
        model.issues.push({ code: "geometry-invalid", reference, message: `${reference}: ${error instanceof Error ? error.message : String(error)}. Quelldaten erhalten, nicht gerendert.` });
      }
    }
  }
  let onlineLegal: Snapshot["legalDocuments"] = [];
  if (downloaded.size) {
    try { onlineLegal = await online.documents(); } catch { /* Failed legal validation never admits a downloaded file. */ }
  }
  model.legalDocuments = [...model.legalDocuments, ...cached.flatMap(p => p.legalDocuments),
    ...packages.flatMap(p => p.legalDocuments), ...(snapshot?.legalDocuments ?? []), ...onlineLegal, MAPPING_LEGAL_DOCUMENT]
    .filter((doc, index, all) => all.findIndex(d =>
      d.name === doc.name && d.sourceUrl === doc.sourceUrl && d.content === doc.content) === index);
  refreshModelColors(model);
  if (getCatalogState().status === "ready" && !model.legalDocuments.some(document => document.name === `Rebrickable catalog ${catalogManifest.version}`)) {
    model.legalDocuments.push({ name: `Rebrickable catalog ${catalogManifest.version}`, sourceUrl: catalogManifest.termsUrl,
      content: `${catalogManifest.attribution}\nSnapshot SHA-256: ${catalogManifest.sha256}\n${JSON.stringify(catalogManifest.sources, null, 2)}` });
  }
  const unmapped = new Set(model.instances.filter(i => !i.part.brickLinkId).map(i => i.reference)).size;
  if (unmapped) model.issues.push({ code: "missing-bl-part", count: unmapped, message: `Für ${unmapped} Teilearten fehlt unserer App noch eine bestätigte BrickLink-Katalogzuordnung. Das bedeutet nicht, dass diese LEGO-Teile ungültig sind oder ihre LDraw-Geometrie fehlt. LDraw- und BrickLink-Teilenummern bleiben getrennt.` });
  if (Object.values(model.resources).some(f => /!TEXMAP/.test(f.content))) model.issues.push({ code: "textures", message: "LDraw-TEXMAP-Texturen werden nicht dargestellt; Basisflächen bleiben sichtbar." });
  if (options.signal?.aborted) model.issues.push({ code: "geometry-cancelled",
    message: "Nachladen abgebrochen. Geprüfte Teile und Originaldaten bleiben in der Vorschau; fehlende Teile können erneut geladen werden." });
  if (downloaded.size || snapshot) {
    // Only complete, compiled root closures enter the reusable cache, in one transaction.
    const valid = new Set<string>();
    const roots = [...new Set(model.instances.filter(i => i.part.status === "resolved").map(i => key(i.reference)))];
    const add = (path: string) => {
      if (valid.has(path)) return;
      valid.add(path);
      // Rebuild from complete compiled resources, not a later failed root's partial traversal.
      graph[path] = dependencies(available[path].content).map(reference => {
        const child = candidates(reference).find(candidate => available[candidate]);
        if (!child) throw new Error(`Geometrie fehlt: ${reference}`);
        return child;
      });
      for (const child of graph[path]) add(child);
    };
    for (const root of roots) {
      const path = candidates(root).find(path => available[path]);
      if (path) add(path);
    }
    if (valid.size && (snapshot || [...valid].some(path => downloaded.has(path)))) {
      const retrieval: RetrievalSnapshot = {
        version: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(), roots,
        graph: Object.fromEntries([...valid].map(path => [path, graph[path] ?? []])),
        files: await Promise.all([...valid].map(async path => {
          const file = available[path];
          const bytes = new TextEncoder().encode(file.content);
          return { ...file, sha256: await hashBytes(bytes), byteLength: bytes.length };
        })), legalDocuments: model.legalDocuments,
      };
      model.retrievalSnapshots = [...(model.retrievalSnapshots ?? []), { ...retrieval, files: [] }];
      if (options.signal?.aborted) return;
      try {
        await builderDatabase.transaction("rw", builderDatabase.geometrySnapshots, async () => {
          options.signal?.throwIfAborted();
          await builderDatabase.geometrySnapshots.add(retrieval);
        });
      } catch (error) {
        model.issues.push({ code: "geometry-cache", message: `Offline-Cache konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}. Originaldaten bleiben erhalten. Projekt erst nach erfolgreichem Speichern schließen.` });
      }
    }
  }
}
