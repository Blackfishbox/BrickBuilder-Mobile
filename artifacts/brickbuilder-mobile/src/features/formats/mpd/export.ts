import type { BuilderDocument } from "@/features/editor/model";
import { structuredMPD } from "./structure";
export function exportMPD(document: BuilderDocument): Uint8Array {
  // Untouched source remains byte-for-byte text compatible.
  if (document.imported && !document.imported.edited && !document.bricks.length) return new TextEncoder().encode(document.imported.sourceText);
  return new TextEncoder().encode(structuredMPD(document));
}
