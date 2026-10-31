import { createEmptyDocument } from "@/features/editor/model";
import type { ImportedModel } from "../types";
import { parseLDraw } from "./parser";
import { resolveGeometry } from "../geometry-resolver";

export async function importLDraw(bytes: Uint8Array, filename: string, format: ImportedModel["format"] = "ldr", originalBytes = bytes) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = parseLDraw(text);
  const imported: ImportedModel = {
    version: 1, format, sourceName: filename, originalBytes: Array.from(originalBytes), sourceText: text,
    ...parsed, resources: Object.create(null), legalDocuments: [],
  };
  await resolveGeometry(imported);
  const document = createEmptyDocument(filename.replace(/\.[^.]+$/, ""));
  document.imported = imported;
  return document;
}
