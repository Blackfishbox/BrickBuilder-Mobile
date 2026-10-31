import type { BuilderDocument } from "@/features/editor/model";
import { exportLDR } from "../ldraw/export";
export function exportMPD(document: BuilderDocument): Uint8Array {
  // Imported hierarchy can be retained verbatim because imported instances are read-only.
  if (document.imported && !document.bricks.length) return new TextEncoder().encode(document.imported.sourceText);
  return new TextEncoder().encode("0 FILE main.ldr\r\n" + new TextDecoder().decode(exportLDR(document)) + "0 NOFILE\r\n");
}
