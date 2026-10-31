import type { BuilderDocument } from "@/features/editor/model";
import { exportMPD } from "../mpd/export";
import { writeZip } from "../zip";
export function exportIO(document: BuilderDocument): Uint8Array {
  // A deliberately minimal container, not a complete Studio serialization.
  return writeZip({
    "model.ldr": exportMPD(document),
    ".info": new TextEncoder().encode(JSON.stringify({ application: "BrickBuilder", parts: document.bricks.length + (document.imported?.instances.length ?? 0) })),
  });
}
