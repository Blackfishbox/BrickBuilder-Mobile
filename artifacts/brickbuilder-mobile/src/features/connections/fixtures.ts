// Original licensed LDraw test fixtures; no procedural replacement geometry.
import { strFromU8, unzlibSync } from "fflate";
import data from "./data/examples";
import { parseLDraw } from "../formats/ldraw/parser";
import type { ImportedModel } from "../formats/types";
const resources = JSON.parse(strFromU8(unzlibSync(Uint8Array.from(atob(data), c => c.charCodeAt(0))))) as ImportedModel["resources"];
export function connectionFixture(lines: string): ImportedModel {
  const model: ImportedModel = { version: 1, format: "ldr", sourceName: "connection-example.ldr",
    sourceText: lines, originalBytes: [...new TextEncoder().encode(lines)], ...parseLDraw(lines), resources, legalDocuments: [] };
  model.instances.forEach(i => { i.part.status = "resolved"; });
  return model;
}
export const partLine = (part: string, x = 0, y = 0, z = 0, basis = "1 0 0 0 1 0 0 0 1") => `1 4 ${x} ${y} ${z} ${basis} ${part}.dat`;
