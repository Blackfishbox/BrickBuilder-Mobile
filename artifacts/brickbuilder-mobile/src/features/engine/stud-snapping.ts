/** Compatibility API for older integrations. The editor uses the complete
 * connection transform directly; coverage is never limited by STUD_PARTS.
 */
import type { ImportedModel } from "../formats/types";
import type { Position3 } from "../editor/model";
import { constructionTransform, MAGNET_CAPTURE_STUDS, snapConnection } from "../connections/engine";
import type { Contact } from "../connections/types";

export const STUD_SNAP_RADIUS = MAGNET_CAPTURE_STUDS;
export interface ConnectionSnap {
  position: Position3;
  supportId: string;
  connections: number;
  contacts: Contact[];
}
export function snapStudConnection(model: ImportedModel, id: string, desired: Position3): ConnectionSnap | null {
  const result = snapConnection(model, id, desired);
  if (!result) return null;
  return { position: { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 },
    supportId: result.contacts[0].targetId, connections: result.contacts.length, contacts: result.contacts };
}
export function constructionPosition(model: ImportedModel, id: string, desired: Position3): Position3 {
  const { matrix } = constructionTransform(model, id, desired);
  return { x: matrix[3] / 20, y: -matrix[7] / 20, z: matrix[11] / 20 };
}
