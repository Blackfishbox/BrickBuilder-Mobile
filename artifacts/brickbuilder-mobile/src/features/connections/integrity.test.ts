import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strFromU8, unzlibSync } from "fflate";
import shadow from "./data/shadow";
import hierarchy from "./data/hierarchy";
import examples from "./data/examples";
import { shadowRecords } from "./dataset";

const root = new URL("../../../public/licenses/connections/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
describe("offline licensed snapshot integrity", () => {
  for (const [name, data, expected] of [
    ["shadow", shadow, manifest.shadow.payload], ["hierarchy", hierarchy, manifest.ldraw.payload], ["examples", examples, manifest.testExamples.payload],
  ] as const) {
    it(`retains the exact pinned ${name} payload and integrity hash`, () => {
      const raw = unzlibSync(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
      expect(raw.length).toBe(expected.decodedBytes);
      expect(sha(raw)).toBe(expected.sha256);
      expect(strFromU8(raw).startsWith("{")).toBe(true);
    });
  }
  it("retains original shadow text, author/history headers and license", () => {
    const records = shadowRecords();
    expect(Object.keys(records)).toHaveLength(manifest.shadow.records);
    for (const record of Object.values(records)) {
      expect(sha(record.text)).toBe(record.sha256);
      expect(record.text).toContain("0 !LICENSE CC BY-SA 4.0, see LICENSE.md");
    }
  });
  it("ships unmodified legal texts separately from application code", () => {
    for (const [name, integrity] of Object.entries(manifest.legalDocuments)) {
      const bytes = readFileSync(new URL(name, root));
      expect(sha(bytes)).toBe((integrity as { sha256: string }).sha256);
    }
    expect(readFileSync(new URL("ATTRIBUTION.txt", root), "utf8")).toContain("No application-wide relicensing");
  });
});
