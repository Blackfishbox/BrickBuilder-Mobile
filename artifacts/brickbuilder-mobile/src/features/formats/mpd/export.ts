import type { BuilderDocument } from "@/features/editor/model";
import { exportLDR } from "../ldraw/export";
export function exportMPD(document: BuilderDocument): Uint8Array {
  // Only untouched imports can retain their original hierarchy verbatim.
  // Edited instances export their effective colors/matrices instead.
  if (document.imported && !document.imported.edited && !document.bricks.length) return new TextEncoder().encode(document.imported.sourceText);
  return new TextEncoder().encode("0 FILE main.ldr\r\n" + new TextDecoder().decode(exportLDR(document)) + "0 NOFILE\r\n");
}
