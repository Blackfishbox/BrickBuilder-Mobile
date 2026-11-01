import { strFromU8, unzlibSync } from "fflate";
import shadowData from "./data/shadow";
import hierarchyData from "./data/hierarchy";

export interface ShadowRecord { text: string; sha256: string }
export interface HierarchyRecord { refs: string[]; author: string; license: string; sha256: string }
function decode<T>(encoded: string): T {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  return JSON.parse(strFromU8(unzlibSync(bytes))) as T;
}
// Installed as part of the application bundle, never fetched from upstream.
// Lazy decoding avoids penalizing the project list before the first model.
let shadow: Record<string, ShadowRecord> | undefined;
let hierarchy: Record<string, HierarchyRecord> | undefined;
export function shadowRecords() { return shadow ??= decode<Record<string, ShadowRecord>>(shadowData); }
export function hierarchyRecords() { return hierarchy ??= decode<Record<string, HierarchyRecord>>(hierarchyData); }
