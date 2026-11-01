/// <reference lib="webworker" />
import { compilePart } from "./ldraw-geometry";
import type { ImportedModel } from "../formats/types";

self.onmessage = (event: MessageEvent<{ references: string[]; resources: ImportedModel["resources"] }>) => {
  // Never clone project archives, instances, histories or per-instance metadata
  // into the compiler worker. Only the shared source files are needed here.
  const model = { resources: event.data.resources } as ImportedModel;
  try {
    for (const reference of event.data.references) {
      const surfaces = compilePart(model, reference, "16");
      const transfer = surfaces.flatMap(surface => [
        surface.positions.buffer, surface.normals.buffer, surface.edges.buffer,
      ]) as ArrayBuffer[];
      self.postMessage({ kind: "part", reference, surfaces }, { transfer });
    }
    self.postMessage({ kind: "done" });
  } catch (error) {
    self.postMessage({ kind: "failure", message: error instanceof Error ? error.message : String(error) });
  }
};
