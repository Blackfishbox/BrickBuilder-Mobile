import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BRICKLINK_EVIDENCE, MAPPING_SET, resolvePartMapping } from "./bricklink-evidence";
import type { LibraryPart, PackagePayload } from "./types";
import manifest from "../formats/geometry-manifest.json";
import { validatePayload } from "./library";
import { PART_PACKAGES } from "./library";
import { Report } from "../formats/FormatDialog";
import type { ImportedModel } from "../formats/types";
import { IDENTITY } from "../formats/ldraw/parser";

const localPart = (id: string, brickLinkId: string): LibraryPart => ({
  id: `test:${id}`, packageId: "test", ldrawId: id, name: id, category: "", keywords: [],
  file: `parts/${id}.dat`, mappings: [{ ...BRICKLINK_EVIDENCE[1], ldrawId: id, brickLinkId }],
});

describe("separately licensed explicit BrickLink evidence", () => {
  it("pins every name, author, license, source line and hash to the shipped original", async () => {
    const bytes = await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url));
    const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bytes))) as PackagePayload;
    expect(BRICKLINK_EVIDENCE).toHaveLength(8);
    for (const e of BRICKLINK_EVIDENCE) {
      const file = snapshot.files.find(f => f.path === `parts/${e.ldrawId}.dat`)!;
      expect(file.sourceUrl).toBe(e.sourceUrl);
      expect(file.author).toBe(e.author);
      expect(file.license).toBe(e.license);
      expect(file.content.split(/\r?\n/)).toContain(e.sourceLine);
      expect(createHash("sha256").update(file.content).digest("hex")).toBe(e.sourceSha256);
      expect(file.content.split(/\r?\n/)[0].slice(2).replace(/\s+/g, " ")).toBe(e.name);
      expect(e.mappingSet).toBe(MAPPING_SET.id);
      expect(e.version).toBe(MAPPING_SET.version);
    }
    const pkg: PackagePayload = {
      id: "evidence", version: MAPPING_SET.version, files: snapshot.files, legalDocuments: snapshot.legalDocuments,
      parts: BRICKLINK_EVIDENCE.map(e => ({
        id: `evidence:${e.ldrawId}`, packageId: "evidence", ldrawId: e.ldrawId,
        name: e.name, category: "", keywords: [], file: `parts/${e.ldrawId}.dat`, mappings: [e],
      })),
    };
    expect(validatePayload(pkg, {
      ...PART_PACKAGES[0], id: pkg.id, version: pkg.version,
      partCount: pkg.parts.length, fileCount: pkg.files.length,
    }).parts.map(p => p.mappings)).toEqual(pkg.parts.map(p => p.mappings));
  });

  it("keeps distinct IDs and variants separate, including old pins and assemblies", () => {
    for (const [id, expected] of [["3023a", "3023old"], ["3023b", "3023"], ["60897", "4085d"], ["6141", "4073"], ["73587p01", "4592c02"]]) {
      expect(resolvePartMapping(`${id.toUpperCase()}.DAT`)).toMatchObject({
        status: "confirmed", candidates: [{ ldrawId: id, brickLinkId: expected }],
      });
    }
    for (const unknown of ["3023", "3069a", "73587", "s/6141", "3004", "invented"]) {
      expect(resolvePartMapping(`${unknown}.dat`)).toEqual({ status: "unknown", candidates: [] });
    }
    expect(resolvePartMapping("invented.dat", [{ ...localPart("invented", "123"), mappings: undefined, brickLinkId: "123" }]).status).toBe("unknown");
  });

  it("does not select the first conflicting source or create ambiguity for repeated agreement", () => {
    const conflicting = resolvePartMapping("3023b.dat", [localPart("3023b", "3023old")]);
    expect(conflicting.status).toBe("ambiguous");
    expect(conflicting.candidates.map(c => c.brickLinkId)).toEqual(["3023", "3023old"]);
    expect(resolvePartMapping("3023b.dat", [localPart("3023b", "3023")]).status).toBe("confirmed");
  });

  it("preserves and validates optional evidence through the existing package interface", async () => {
    const bytes = await readFile(new URL(`../../../public/${PART_PACKAGES[1].url}`, import.meta.url));
    const payload = JSON.parse(bytes.toString()) as PackagePayload;
    const part = payload.parts.find(p => p.ldrawId === "3023") ?? payload.parts[0];
    // A claim without an explicit original keyword must be rejected.
    part.mappings = [{ ...BRICKLINK_EVIDENCE[0], ldrawId: part.ldrawId }];
    expect(() => validatePayload(payload, PART_PACKAGES[1])).toThrow("Unbelegte");
  });

  it("reports all combinations, counts, ambiguity, provenance and unknowns without a 400-instance cutoff", () => {
    const model: ImportedModel = {
      version: 1, format: "ldr", sourceName: "test.ldr", originalBytes: [], sourceText: "",
      root: "", sections: {}, resources: {}, issues: [], legalDocuments: [],
      instances: Array.from({ length: 402 }, (_, n) => ({
        id: String(n), reference: n === 401 ? "unknown.dat" : "3023b.dat", colorCode: "0",
        matrix: IDENTITY, sourcePath: [],
        part: { ldrawId: n === 401 ? "unknown" : "3023b", status: "missing",
          mapping: n === 401 ? resolvePartMapping("unknown.dat") : resolvePartMapping("3023b.dat", [localPart("3023b", "3023old")]) },
      })),
    };
    const html = renderToStaticMarkup(<Report model={model} bricks={0} />);
    for (const text of ["401×", "unknown.dat", "mehrdeutig", "3023old", "CC-BY-4.0", MAPPING_SET.version, BRICKLINK_EVIDENCE[1].sourceSha256, "unbestätigt"]) expect(html).toContain(text);
  });
});
