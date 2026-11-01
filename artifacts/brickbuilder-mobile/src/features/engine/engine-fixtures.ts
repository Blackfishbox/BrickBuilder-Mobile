import type { ImportedModel } from "../formats/types";
import { parseLDraw } from "../formats/ldraw/parser";

/** Synthetic, redistributable geometry. No private upload or catalog data. */
export function engineFixture(count = 100, faces = 200): ImportedModel {
  const source = Array.from({ length: count }, (_, index) =>
    `1 ${["4", "14", "43"][index % 3]} ${(index % 100) * 40} 0 ${Math.floor(index / 100) * 40} 1 0 0 0 1 0 0 0 1 test.dat`).join("\n");
  const model: ImportedModel = {
    version: 1, format: "ldr", sourceName: "synthetic.ldr", originalBytes: [], sourceText: source,
    ...parseLDraw(source), resources: { "parts/test.dat": {
      path: "parts/test.dat", author: "Synthetic fixture", license: "CC0-1.0", sourceUrl: "https://example.invalid/test.dat",
      content: `${"3 16 0 0 0 20 0 0 0 20 0\n".repeat(faces)}3 2 0 0 0 0 20 0 0 0 20\n2 24 0 0 0 20 0 0`,
    } }, legalDocuments: [],
  };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}
