import type { BuilderDocument } from "@/features/editor/model";
import { importInternal, exportInternal } from "./internal/adapter";
import { importLDraw } from "./ldraw/import";
import { exportLDR } from "./ldraw/export";
import { importMPD } from "./mpd/import";
import { exportMPD } from "./mpd/export";
import { importIO } from "./io/import";
import { exportIO } from "./io/export";
import type { ResolveOptions } from "./online-geometry";

export async function importModelFile(file: File, options: ResolveOptions = {}): Promise<BuilderDocument> {
  if (file.size > 32 * 1024 * 1024) throw new Error("Die Datei überschreitet 32 MiB.");
  const format = file.name.split(".").pop()?.toLowerCase();
  if (!["json", "ldr", "mpd", "io"].includes(format ?? "")) throw new Error("Unterstützte Dateien: JSON, LDR, MPD, IO.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  switch (format) {
    case "json": return importInternal(bytes);
    case "io": return importIO(bytes, file.name, options);
    case "mpd": return importMPD(bytes, file.name, options);
    default: return importLDraw(bytes, file.name, "ldr", bytes, options);
  }
}
export async function exportModel(document: BuilderDocument, format: "json" | "ldr" | "mpd" | "io") {
  const bytes = format === "json" ? exportInternal(document) : format === "ldr" ? exportLDR(document) : format === "mpd" ? exportMPD(document) : exportIO(document);
  return { bytes, filename: `${document.name.replace(/[^a-z0-9äöüß_-]/gi, "_") || "Modell"}.${format}`, mime: format === "json" ? "application/json" : format === "io" ? "application/zip" : "text/plain" };
}
