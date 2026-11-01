import { readZip } from "../zip";
import { importLDraw } from "../ldraw/import";
import type { ResolveOptions } from "../online-geometry";

export async function importIO(bytes: Uint8Array, filename: string, options: ResolveOptions = {}) {
  const entries = readZip(bytes, { names: ["model.ldr"], studioEncryption: true });
  const modelName = Object.keys(entries).find(name => name.toLowerCase() === "model.ldr");
  if (!modelName) throw new Error("IO-Variante ohne model.ldr wird nicht unterstützt.");
  const document = await importLDraw(entries[modelName], filename, "io", bytes, options);
  document.imported!.issues.push({
    code: "io-scope", message: "IO: model.ldr wird ausgewertet. Anleitung, LXFML, Studio-Metadaten und eingebettete Studio-Geometrien bleiben unverändert im Originalarchiv erhalten, sind aber keine bearbeitbaren Funktionen.",
  });
  return document;
}
