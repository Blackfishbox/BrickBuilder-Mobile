import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { gunzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "../editor/model";
import { builderDatabase, createImportedProject, loadCurrentProject, loadProject, saveProject } from "@/storage/database";
import { importIO } from "./io/import";
import { importLDraw } from "./ldraw/import";
import { parseLDraw, multiply, IDENTITY } from "./ldraw/parser";
import { readZip, writeZip } from "./zip";
import { importInternal, exportInternal } from "./internal/adapter";
import { exportLDR } from "./ldraw/export";
import { exportMPD } from "./mpd/export";
import { exportIO } from "./io/export";
import { compilePart, worldMatrix } from "../engine/ldraw-geometry";
import { resolveColor } from "./colors";
import manifest from "./geometry-manifest.json";

const encode = (s: string) => new TextEncoder().encode(s);
const ref = "1 4 10 20 30 1 0 0 0 1 0 0 0 1 3001.dat";
const privateReference = new URL("../../../../../attached_assets/ford_mxCopy_Copy-1_1793477649199.io", import.meta.url);
// Use a part in the reviewed import snapshot; 3001 requires the optional bricks package.
const syntheticIO = () => writeZip({ "model.ldr": encode(`0 FILE main.ldr\n${ref.replace("3001.dat", "11211.dat")}`) });
async function referenceBytes() {
  return new Uint8Array(await readFile(privateReference));
}
describe("bounded ZIP and model parser", () => {
  it("roundtrips stored/deflated data and rejects corrupt CRC, encryption and unsafe paths", () => {
    const bytes = writeZip({ "model.ldr": encode(ref) });
    expect(new TextDecoder().decode(readZip(bytes)["model.ldr"])).toBe(ref);
    expect(() => readZip(writeZip({ "../model.ldr": encode(ref) }))).toThrow(/Pfad/);
    expect(() => readZip(writeZip({ "model.ldr": encode(ref), "MODEL.LDR": encode(ref) }))).toThrow(/Pfad/);
    const encrypted = bytes.slice();
    encrypted[6] |= 1;
    expect(() => readZip(encrypted)).toThrow();
    const corrupt = bytes.slice();
    const view = new DataView(corrupt.buffer);
    for (let i = 0; i < corrupt.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { corrupt[i + 16] ^= 1; break; }
    }
    expect(() => readZip(corrupt)).toThrow(/Prüfsumme/);
    expect(() => readZip(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => readZip(new Uint8Array(33 * 1024 * 1024))).toThrow(/Größe/);
  });
  it("preserves submodel names, inheritance, reflection, shear and translation", () => {
    const parsed = parseLDraw(`0 FILE main.ldr
1 72 10 20 30 1 0.5 0 0 -1 0 0 0 2 child with spaces.ldr
0 FILE child with spaces.ldr
1 16 4 5 6 0 0 1 0 1 0 -1 0 0 3001.dat`);
    expect(parsed.instances).toHaveLength(1);
    const instance = parsed.instances[0];
    expect(instance.colorCode).toBe("72");
    expect(instance.matrix).toEqual([0, 0.5, 1, 16.5, 0, -1, 0, 15, -2, 0, 0, 42]);
    expect(instance.sourcePath).toContain("child with spaces.ldr");
    expect(multiply(IDENTITY, instance.matrix)).toEqual(instance.matrix);
    expect(worldMatrix(instance.matrix).elements[13]).toBe(-0.75);
  });
  it("rejects cycles, malformed matrices, empty files and excessive expansion", () => {
    expect(() => parseLDraw("0 FILE a\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 a")).toThrow(/Zykl/);
    expect(() => parseLDraw(ref.replace("10", "NaN"))).toThrow(/Matrix/);
    expect(() => parseLDraw("0 empty")).toThrow(/keine Teile/);
    expect(() => parseLDraw(Array(10002).fill(ref).join("\n"))).toThrow(/10.000/);
    const lines = Array.from({ length: 50 }, (_, n) => `0 FILE m${n}\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 m${n + 1}`).join("\n");
    expect(() => parseLDraw(lines)).toThrow(/tief/);
  });
});

describe("geometry, formats and storage (private-reference cases are optional)", () => {
  beforeEach(async () => {
    await builderDatabase.open();
    const bytes = await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
  });
  afterEach(async () => {
    vi.unstubAllGlobals(); vi.restoreAllMocks();
    await builderDatabase.delete();
  });
  it("ships a checksum-pinned, recursively complete, credited geometry snapshot", async () => {
    const bytes = await readFile(new URL(`../../../public/${manifest.url}`, import.meta.url));
    expect(bytes.length).toBe(manifest.bytes);
    expect(Buffer.from(await webcrypto.subtle.digest("SHA-256", bytes)).toString("hex")).toBe(manifest.sha256);
    const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(bytes)));
    expect(snapshot.parts).toHaveLength(manifest.partCount);
    expect(snapshot.files).toHaveLength(manifest.fileCount);
    for (const file of snapshot.files) {
      expect(file.author.length).toBeGreaterThan(0);
      expect(file.sourceUrl).toBe(`https://library.ldraw.org/library/official/${file.path}`);
      expect(file.content).toMatch(/0 !LICENSE Licensed under CC (?:BY (?:2\.0 and CC BY )?4\.0|0) : see CAreadme.txt/);
    }
    expect(snapshot.legalDocuments).toHaveLength(2);
  });
  it.skipIf(!existsSync(privateReference))("imports the optional private reference with 429 instances, 74 references and eight effective colors", async () => {
    const bytes = await referenceBytes();
    const doc = await importIO(bytes, "ford.io");
    const model = doc.imported!;
    expect(model.instances).toHaveLength(429);
    expect(Object.keys(model.sections)).toHaveLength(9);
    expect(new Set(model.instances.map(i => i.reference)).size).toBe(74);
    expect(Object.fromEntries([...new Set(model.instances.map(i => i.colorCode))].map(code => [code, model.instances.filter(i => i.colorCode === code).length])))
      .toEqual({ "0": 305, "72": 68, "19": 4, "4": 12, "1": 2, "15": 21, "179": 4, "47": 13 });
    expect(model.originalBytes).toEqual(Array.from(bytes));
    expect(model.instances.every(i => i.color?.brickLinkId !== undefined)).toBe(true);
    expect(model.instances.every(i => i.part.studioId === undefined)).toBe(true);
    expect(new Set(model.instances.filter(i => i.part.brickLinkId).map(i => i.reference)).size).toBe(8);
    expect(model.instances.find(i => i.reference === "60897.dat")?.part.brickLinkId).toBe("4085d");
    expect(model.instances.find(i => i.reference === "6141.dat")?.part.brickLinkId).toBe("4073");
    let vertices = 0;
    for (const i of model.instances) {
      if (i.part.status === "resolved") {
        const surfaces = compilePart(model, i.reference, i.colorCode);
        vertices += surfaces.reduce((n, s) => n + s.positions.length / 3, 0);
        expect(surfaces.some(s => s.positions.length > 0)).toBe(true);
      } else expect(model.issues.some(issue => issue.reference === i.reference.toLowerCase())).toBe(true);
    }
    expect(vertices).toBeGreaterThan(10000);
    expect(model.instances.filter(i => i.part.status === "resolved").length).toBe(429);
    expect(model.issues.some(i => i.code === "missing-bl-part")).toBe(true);
  });
  it("keeps old projects and active pointer untouched on parse/storage failure, saves and reopens offline", async () => {
    const previous = createEmptyDocument("Unverändert");
    await saveProject(previous);
    await expect(importIO(encode("broken"), "bad.io")).rejects.toThrow();
    expect((await loadCurrentProject())?.id).toBe(previous.id);
    const imported = await importIO(syntheticIO(), "synthetic.io");
    const fail = vi.spyOn(builderDatabase.metadata, "put").mockRejectedValueOnce(new Error("quota"));
    await expect(createImportedProject(previous, imported)).rejects.toThrow("quota");
    expect(await loadProject(imported.id)).toBeNull();
    expect((await loadCurrentProject())?.id).toBe(previous.id);
    fail.mockRestore();
    await createImportedProject(previous, imported);
    expect((await loadProject(previous.id))?.name).toBe("Unverändert");
    builderDatabase.close();
    await builderDatabase.open();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    const reopened = await loadCurrentProject();
    expect(reopened?.imported).toEqual(imported.imported);
    expect(compilePart(reopened!.imported!, imported.imported!.instances[0].reference, "0").length).toBeGreaterThan(0);
  });
  it("retains missing references/colors without replacements or data loss; no download is required to reopen JSON", async () => {
    const doc = await importLDraw(encode(ref.replace("4 10", "987654 10").replace("3001.dat", "unknown.dat")), "unknown.ldr");
    expect(doc.imported?.instances).toHaveLength(1);
    expect(doc.imported?.instances[0].part.status).toBe("missing");
    expect(doc.imported?.instances[0].color).toBeUndefined();
    expect(doc.imported?.issues.map(i => i.code)).toContain("missing-color");
    const json = exportInternal(doc);
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("offline"); }));
    const reopened = importInternal(json);
    expect(reopened.id).not.toBe(doc.id);
    expect(reopened.imported?.instances[0].reference).toBe("unknown.dat");
    expect(reopened.imported?.instances[0].colorCode).toBe("987654");
    expect(reopened.imported?.originalBytes).toEqual(doc.imported?.originalBytes);
  });
  it("retains conflicting evidence but leaves the BrickLink ID empty independently of geometry", async () => {
    const { BRICKLINK_EVIDENCE } = await import("../parts/bricklink-evidence");
    await builderDatabase.libraryParts.put({
      id: "test:60897", packageId: "test", ldrawId: "60897", name: "Clip", category: "",
      keywords: [], file: "parts/60897.dat",
      mappings: [{ ...BRICKLINK_EVIDENCE.find(e => e.ldrawId === "60897")!, brickLinkId: "4085x" }],
    });
    const doc = await importLDraw(encode(ref.replace("3001.dat", "60897.dat")), "conflict.ldr");
    expect(doc.imported?.instances[0].part).toMatchObject({ status: "resolved", mapping: { status: "ambiguous" } });
    expect(doc.imported?.instances[0].part.brickLinkId).toBeUndefined();
    expect(doc.imported?.issues.some(i => i.code === "ambiguous-bl-part")).toBe(true);
    const reopened = importInternal(exportInternal(doc));
    expect(reopened.imported?.instances[0].part).toEqual(doc.imported?.instances[0].part);
  });
  it("roundtrips a self-authored model through JSON/LDR/MPD/minimal IO without private uploads", async () => {
    const doc = await importIO(syntheticIO(), "synthetic.io");
    expect(doc.imported?.instances).toHaveLength(1);
    expect(doc.imported?.instances[0].part.status).toBe("resolved");
    expect(compilePart(doc.imported!, "11211.dat", "4").length).toBeGreaterThan(0);
    const expected = doc.imported!.instances.map(i => [i.reference, i.colorCode, i.matrix]);
    const json = importInternal(exportInternal(doc));
    expect(json.imported?.resources).toEqual(doc.imported?.resources);
    expect(json.imported?.instances.map(i => [i.reference, i.colorCode, i.matrix])).toEqual(expected);
    expect(parseLDraw(new TextDecoder().decode(exportLDR(doc))).instances.map(i => [i.reference, i.colorCode, i.matrix])).toEqual(expected);
    expect(new TextDecoder().decode(exportMPD(doc))).toBe(doc.imported?.sourceText);
    const io = await importIO(exportIO(doc), "synthetic-roundtrip.io");
    expect(io.imported?.instances.map(i => [i.reference, i.colorCode, i.matrix])).toEqual(expected);
    expect(() => importInternal(encode('{"schemaVersion":2}'))).toThrow();
    expect(() => importInternal(encode(JSON.stringify({ ...createEmptyDocument(), bricks: [{ type: "fake" }] })))).toThrow();
  });
  it.skipIf(!existsSync(privateReference))("roundtrips the optional private reference through all format adapters", async () => {
    const doc = await importIO(await referenceBytes(), "ford.io");
    doc.metadata = { extra: { retained: true } };
    const json = importInternal(exportInternal(doc));
    expect(json.metadata).toEqual(doc.metadata);
    expect(json.imported?.sections).toEqual(doc.imported?.sections);
    expect(json.imported?.instances.map(i => i.part)).toEqual(doc.imported?.instances.map(i => i.part));
    const flat = parseLDraw(new TextDecoder().decode(exportLDR(doc)));
    expect(flat.instances.map(i => [i.reference, i.colorCode, i.matrix])).toEqual(doc.imported!.instances.map(i => [i.reference, i.colorCode, i.matrix]));
    expect(new TextDecoder().decode(exportMPD(doc))).toBe(doc.imported?.sourceText);
    const io = await importIO(exportIO(doc), "roundtrip.io");
    expect(io.imported?.instances.map(i => [i.reference, i.colorCode, i.matrix])).toEqual(doc.imported!.instances.map(i => [i.reference, i.colorCode, i.matrix]));
    expect(() => importInternal(encode('{"schemaVersion":2}'))).toThrow();
    expect(() => importInternal(encode(JSON.stringify({ ...createEmptyDocument(), bricks: [{ type: "fake" }] })))).toThrow();
  });
  it("does not confuse LDraw, Studio and BrickLink color namespaces", () => {
    expect(resolveColor("0")?.brickLinkId).toBe(11);
    expect(resolveColor("72")?.brickLinkId).toBe(85);
    expect(resolveColor("179")?.name).toBe("Pearl_Silver");
    expect(resolveColor("47")?.alpha).toBe(128);
    expect(resolveColor("16")).toBeUndefined();
    expect(resolveColor("0x2FF00AA")?.hex).toBe("#FF00AA");
  });
});
