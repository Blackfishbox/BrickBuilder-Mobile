import { gunzipSync } from "fflate";
import { builderDatabase } from "@/storage/database";
import type { LibraryFile, PackagePayload } from "../parts/types";
import type { ImportedModel } from "./types";
import manifest from "./geometry-manifest.json";
import { resolveColor } from "./colors";
import { referenceLine } from "./ldraw/parser";
import { compilePart } from "../engine/ldraw-geometry";

interface Snapshot {
  files: LibraryFile[];
  parts: { ldrawId: string; name: string; file: string }[];
  legalDocuments: PackagePayload["legalDocuments"];
}
export async function resolveGeometry(model: ImportedModel): Promise<void> {
  const local = await builderDatabase.libraryFiles.toArray();
  const parts = await builderDatabase.libraryParts.toArray();
  const packages = await builderDatabase.partPackages.toArray();
  const available: Record<string, LibraryFile> = Object.create(null);
  for (const file of local) available[file.path] = file;
  const needed = [...new Set(model.instances.map(i => i.reference.toLowerCase()))];
  let snapshot: Snapshot | undefined;
  if (needed.some(ref => !available[`parts/${ref}`])) {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}${manifest.url}`);
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
  const included = new Set<string>();
  function collect(path: string, chain: string[]): void {
    if (chain.includes(path) || chain.length > 48) throw new Error(`Zyklische/zu tiefe Geometrie: ${path}`);
    if (included.has(path)) return;
    const file = available[path];
    if (!file) throw new Error(`LDraw-Datei fehlt: ${path}`);
    for (const line of file.content.split(/\r?\n/)) {
      if (!/^1\s/.test(line)) continue;
      const ref = referenceLine(line).reference.toLowerCase();
      const child = available[`parts/${ref}`] ? `parts/${ref}` : `p/${ref}`;
      collect(child, [...chain, path]);
    }
    included.add(path);
  }
  for (const reference of needed) {
    let error: string | undefined;
    try { collect(`parts/${reference}`, []); }
    catch (caught) { error = caught instanceof Error ? caught.message : String(caught); }
    const matching = model.instances.filter(i => i.reference.toLowerCase() === reference);
    const entry = parts.find(p => `${p.ldrawId.toLowerCase()}.dat` === reference);
    const snapPart = snapshot?.parts.find(p => p.file === `parts/${reference}`);
    for (const instance of matching) {
      instance.part = {
        ldrawId: instance.part.ldrawId,
        // Studio part namespace is not inferred from the LDraw filename.
        name: entry?.name ?? snapPart?.name,
        ...(entry?.brickLinkId ? { brickLinkId: entry.brickLinkId } : {}),
        status: error ? "missing" : "resolved",
      };
    }
    if (error) model.issues.push({ code: "missing-part", reference, count: matching.length, message: `${reference}: ${error}. Nicht gerendert, Quelldaten erhalten.` });
  }
  for (const path of included) model.resources[path] = available[path];
  // Geometry compilation is part of validation, not a late canvas crash.
  for (const reference of needed) {
    const instances = model.instances.filter(i => i.reference.toLowerCase() === reference && i.part.status === "resolved");
    for (const code of new Set(instances.map(i => i.colorCode))) {
      try {
        const surfaces = compilePart(model, reference, code);
        for (const surface of surfaces) {
          if (!resolveColor(surface.colorCode)) model.issues.push({ code: "geometry-color", reference: surface.colorCode, message: `Feste Geometriefarbe ${surface.colorCode} nicht zugeordnet; Warnfarbe Magenta.` });
        }
      } catch (error) {
        for (const instance of instances) instance.part.status = "missing";
        model.issues.push({ code: "geometry-invalid", reference, message: `${reference}: ${error instanceof Error ? error.message : String(error)}. Quelldaten erhalten, nicht gerendert.` });
      }
    }
  }
  model.legalDocuments = [...packages.flatMap(p => p.legalDocuments), ...(snapshot?.legalDocuments ?? [])]
    .filter((doc, index, all) => all.findIndex(d => d.name === doc.name) === index);
  for (const code of new Set(model.instances.map(i => i.colorCode))) {
    const color = resolveColor(code);
    const matching = model.instances.filter(i => i.colorCode === code);
    for (const instance of matching) instance.color = color;
    if (!color) model.issues.push({ code: "missing-color", reference: code, count: matching.length, message: `LDraw-Farbe ${code} nicht zugeordnet. Als magentafarbene Warngeometrie dargestellt, Quellfarbcode bleibt erhalten.` });
    else if (color.brickLinkId === undefined) model.issues.push({ code: "missing-bl-color", reference: code, message: `Für ${color.name} (LDraw ${code}) ist keine bestätigte BrickLink-Farbnummer hinterlegt.` });
  }
  const unmapped = new Set(model.instances.filter(i => !i.part.brickLinkId).map(i => i.reference)).size;
  if (unmapped) model.issues.push({ code: "missing-bl-part", count: unmapped, message: `${unmapped} verschiedene Teile ohne bestätigte BrickLink-Teilenummer. LDraw-Nummern werden nicht als BrickLink-Nummern ausgegeben.` });
  if (Object.values(model.resources).some(f => /!TEXMAP/.test(f.content))) model.issues.push({ code: "textures", message: "LDraw-TEXMAP-Texturen werden nicht dargestellt; Basisflächen bleiben sichtbar." });
}
