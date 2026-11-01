import type { BuilderDocument } from "@/features/editor/model";
import { exportMPD } from "../mpd/export";
import { writeZip } from "../zip";
export function exportIO(document: BuilderDocument): Uint8Array {
  // A deliberately minimal container, not a complete Studio serialization.
  return writeZip({
    "model.ldr": exportMPD(document),
    ".info": new TextEncoder().encode(JSON.stringify({
      application: "BrickBuilder", parts: document.bricks.length + (document.imported?.instances.length ?? 0),
      exportScope: "Minimal generated container with occurrence-aware LDraw hierarchy; not a lossless Studio round trip.",
      omittedRecords: "Original archive records including instructions, LXFML, Studio geometry, textures and unknown proprietary metadata are not copied or updated. Retain the original archive and internal JSON backup.",
    })),
  });
}
