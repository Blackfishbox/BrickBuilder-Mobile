import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "fflate";
import { expect, it } from "vitest";
import { Matrix4, Ray, Triangle, Vector3 } from "three";
import type { ImportedModel } from "../formats/types";
import { IDENTITY, multiply, parseLDraw, referenceLine } from "../formats/ldraw/parser";
import { candidates } from "@workspace/ldraw-source";
import { compilePart } from "../engine/ldraw-geometry";
import type { Affine } from "../formats/types";
import { affine, describeConnections, matrix4, transformConnector } from "./description";
import { activeConnections, constructionTransform } from "./engine";
import { axes, intervals } from "./profiles";
import { worldMatrix } from "../engine/ldraw-geometry";

const snapshot = JSON.parse(new TextDecoder().decode(gunzipSync(readFileSync(
  new URL("../../../public/parts/import-geometry-2026-10-31.bin", import.meta.url),
))));
const packages = ["bricks", "plates"].map(group => JSON.parse(readFileSync(
  new URL(`../../../public/parts/ldraw-${group}-2026-10-31.json`, import.meta.url), "utf8",
)));
const standardHeader = /^0 (Brick|Plate|Tile)\s+(\d+)\s+x\s+(\d+)(?: with Groove| without Groove| with Reinforced Underside| with Underside Ribs| without Centre Studs?(?: with 2 Internal Ribs)?| with Flat Pin| with Underside Details| without Underside Details| Type 2)?\s*$/;
const resources = Object.fromEntries([...snapshot.files, ...packages.flatMap(p => p.files)]
  .map(file => [file.path, file])) as ImportedModel["resources"];
for (const [path, name] of [["parts/3066.dat", "3066"], ["parts/s/3066s01.dat", "3066s01"]]) {
  const content = readFileSync(new URL(`./fixtures/${name}.dat`, import.meta.url), "utf8");
  resources[path] = { path, content, author: content.match(/^0 Author: (.*)$/m)![1],
    sourceUrl: `https://library.ldraw.org/library/official/${path}`, license: "CC-BY-4.0" };
}
const archiveRoot = resolve(process.env.LDRAW_STANDARD_ARCHIVE ??
  "../api-server/generated-artifacts/ldraw-runtime/5cd6248dcad355758dae965eecd3c54af2ca6726b6dbd3d7c9f3580663fedd0b");
const archiveAvailable = existsSync(resolve(archiveRoot, "manifest.json"));
const archiveResources: ImportedModel["resources"] = {};
if (archiveAvailable) {
  const manifest = JSON.parse(readFileSync(resolve(archiveRoot, "manifest.json"), "utf8"));
  if (manifest.sha256 !== "023083918da2d3697c794fb4267975509584f3611b993095874206a803fa610f") throw new Error("Unapproved standard-parts archive");
  function collect(path: string) {
    if (archiveResources[path]) return;
    const bytes = readFileSync(resolve(archiveRoot, path)), content = bytes.toString("utf8");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifest.files[path]);
    expect(content).toMatch(/^0 !LICENSE Licensed under CC (?:BY 4\.0|BY 2\.0 and CC BY 4\.0|0)/m);
    archiveResources[path] = { path, content, author: content.match(/^0 Author: (.*)$/m)![1],
      sourceUrl: `https://library.ldraw.org/library/official/${path}`, license: content.includes("Licensed under CC0") ? "CC0-1.0" : "CC-BY-4.0" };
    for (const line of content.split(/\r?\n/).filter(l => /^1\s/.test(l))) {
      const ref = referenceLine(line), child = candidates(ref.reference).find(p => manifest.files[p]);
      if (!child) throw new Error(`Missing approved dependency: ${ref.reference}`);
      collect(child);
    }
  }
  for (const path of Object.keys(manifest.files).filter(p => /^parts\/[^/]+\.dat$/.test(p))) {
    const first = readFileSync(resolve(archiveRoot, path), "utf8").split(/\r?\n/)[0];
    if (standardHeader.test(first)) collect(path);
  }
}
const auditedResources = archiveAvailable ? { ...resources, ...archiveResources } : resources;
// Geometry exists for these newer tiles, but the pinned LDCad snapshot has
// no underside description. Keep that observable instead of fabricating one.
const missingTileMetadata = new Set(["1751.dat", "6320.dat", "8165.dat"]);
const partialTileSockets: Record<string, number> = { "48288.dat": 80, "6934.dat": 14, "6881a.dat": 20, "6881b.dat": 4 };

export const standards = Object.values(auditedResources).flatMap(file => {
  const match = file.content.split(/\r?\n/)[0].match(standardHeader);
  return match ? [{ reference: file.path.slice(6), kind: match[1], width: +match[2], length: +match[3] }] : [];
});
export function catalogModel(lines: string): ImportedModel {
  const model: ImportedModel = { version: 1, format: "ldr", sourceName: "catalog-regression.ldr",
    sourceText: lines, originalBytes: [...new TextEncoder().encode(lines)], ...parseLDraw(lines),
    resources: auditedResources, legalDocuments: snapshot.legalDocuments };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}
it.skipIf(!archiveAvailable)("includes all 91 regular rectangular parts and underside variants from the approved full archive", () => {
  expect(standards).toHaveLength(91);
});
function assertExactContacts(model: ImportedModel, result: ReturnType<typeof constructionTransform>) {
  for (const contact of result.contacts) {
    const moving = model.instances.find(i => i.id === contact.movingId)!;
    const target = model.instances.find(i => i.id === contact.targetId)!;
    const a = describeConnections(moving.reference, model).connectors.find(c => c.id === contact.movingConnectorId)!;
    const b = describeConnections(target.reference, model).connectors.find(c => c.id === contact.targetConnectorId)!;
    const aa = transformConnector(a, result.matrix)!, bb = transformConnector(b, target.matrix)!;
    expect(axes(aa).position.distanceTo(axes(bb).position)).toBeLessThan(1e-10);
    // Compare the two ends of the actual inserted stud layer in the same
    // transformation used by both renderers, not just the contact count.
    const male = aa.gender === "M" ? aa : bb;
    const female = aa.gender === "F" ? aa : bb;
    const inv = matrix4(female.frame).invert();
    for (const y of intervals(male).flatMap(s => [s.lo, s.hi])) {
      const p = new Vector3(0, y, 0).applyMatrix4(matrix4(male.frame)).applyMatrix4(inv);
      expect(Math.hypot(p.x, p.z)).toBeLessThan(1e-10);
      expect(p.y).toBeGreaterThanOrEqual(-female.length - 1e-10);
      expect(p.y).toBeLessThanOrEqual(1e-10);
    }
    const bottom = new Vector3(a.frame[3], a.frame[7], a.frame[11]).applyMatrix4(worldMatrix(result.matrix));
    const top = new Vector3(b.frame[3], b.frame[7], b.frame[11]).applyMatrix4(worldMatrix(target.matrix));
    expect(bottom.distanceTo(top)).toBeLessThan(1e-10);
  }
}

for (const part of standards) it(`audits installed standard ${part.reference}`, () => {
  const model = catalogModel(`1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 ${part.reference}`);
  const connectors = describeConnections(part.reference, model).connectors;
  const studs = connectors.filter(c => c.gender === "M" && c.family === "cylinder" && c.length === 4 &&
    c.sections.length === 1 && c.sections[0].radius === 6);
  const sockets = connectors.filter(c => c.gender === "F");
  expect(studs).toHaveLength(part.kind === "Tile" ? 0 : part.width * part.length);
  if (missingTileMetadata.has(part.reference)) expect(sockets).toHaveLength(0);
  else expect(sockets.length).toBeGreaterThan(0);
  // Derive stud centers from original primitive transforms, not header
  // dimensions, bounding boxes, catalog IDs or connection metadata.
  const centers: number[][] = [];
  function visit(ref: string, parent: Affine) {
    const path = candidates(ref).find(path => auditedResources[path])!;
    if (["p/stud.dat", "p/stud2.dat", "p/stud26.dat"].includes(path)) { centers.push([parent[3], parent[7], parent[11]]); return; }
    for (const line of auditedResources[path].content.split(/\r?\n/).filter(l => /^1\s/.test(l))) {
      const child = referenceLine(line); visit(child.reference, multiply(parent, child.matrix));
    }
  }
  visit(part.reference, IDENTITY);
  expect(centers).toHaveLength(studs.length);
  for (const stud of studs) {
    // 2653 has sunken, double-height hollow studs. Its explicit upstream
    // description uses the normal Y=0 mating plane, not the primitive's Y=4.
    expect(centers).toContainEqual([stud.frame[3], part.reference === "2653.dat" ? 4 : stud.frame[7], stud.frame[11]]);
  }
  const surfaces = compilePart(model, part.reference, "16");
  const vertices = surfaces.flatMap(s => [...s.positions]);
  const bottom = Math.max(...vertices.filter((_, i) => i % 3 === 1));
  const ordinarySockets = sockets.filter(c => c.sections.length === 1 && c.sections[0].radius === 6 && c.length >= 4);
  expect(ordinarySockets).toHaveLength(missingTileMetadata.has(part.reference) ? 0 :
    partialTileSockets[part.reference] ?? part.width * part.length);
  // A ray into each real underside opening must admit a complete stud layer.
  // This rejects solid-bottom tiles and misplaced sockets without fabricating
  // geometry from a guessed rectangle.
  for (const socket of ordinarySockets) {
    expect(socket.frame[7]).toBe(bottom);
    const ray = new Ray(new Vector3(socket.frame[3], bottom + 1, socket.frame[11]), new Vector3(0, -1, 0));
    const point = new Vector3(), triangle = new Triangle();
    for (const surface of surfaces) for (let i = 0; i < surface.positions.length; i += 9) {
      triangle.a.fromArray(surface.positions, i); triangle.b.fromArray(surface.positions, i + 3); triangle.c.fromArray(surface.positions, i + 6);
      if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, point)) expect(point.y).toBeLessThanOrEqual(bottom - 4 + 1e-4);
    }
  }
  const result = constructionTransform(model, model.instances[1].id, { x: 0, y: 0.4, z: 0.5 });
  if (missingTileMetadata.has(part.reference) || part.reference === "48288.dat") expect(result.contacts).toHaveLength(0);
  else expect(result.contacts.length).toBeGreaterThan(0);
  assertExactContacts(model, result);
});

it("keeps the reference plate upright with both sockets at all full-support pointer positions", () => {
  const model = catalogModel("1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat");
  for (const x of [-2, -1.75, -1.5, -1, -0.5, 0, 0.25, 0.5, 1, 1.5, 2])
    for (const z of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75])
      for (const y of [0.4, 0.6, 0.8, 1, 1.2]) {
        const result = constructionTransform(model, model.instances[1].id, { x, y, z });
        expect(result.contacts.length, `${x},${y},${z}: ${result.matrix}`).toBe(2);
        expect(result.matrix[5], `${x},${y},${z}: ${result.matrix}`).toBe(1);
        expect(result.matrix[7], `${x},${y},${z}: ${result.matrix}`).toBe(-16);
        assertExactContacts(model, result);
      }
});

for (const support of ["3001.dat", "3022.dat", "3795.dat"]) for (const part of standards)
  it(`mates real ${part.reference} onto ${support} using source-proven openings`, () => {
    const baseHeight = support === "3001.dat" ? 24 : 8;
    const model = catalogModel(`1 4 0 ${-baseHeight} 0 1 0 0 0 1 0 0 0 1 ${support}\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 ${part.reference}`);
    const stud = describeConnections(support, model).connectors.find(c => c.gender === "M" && c.clearId === "studC")!;
    const socket = describeConnections(part.reference, model).connectors.find(c => c.gender === "F" && c.sections.length === 1 && c.sections[0].radius === 6)!;
    if (missingTileMetadata.has(part.reference)) {
      expect(socket).toBeUndefined();
      expect(constructionTransform(model, model.instances[1].id, { x: 0, y: 0.8, z: 0 }).contacts).toHaveLength(0);
      return;
    }
    const result = constructionTransform(model, model.instances[1].id, {
      x: (stud.frame[3] - socket.frame[3]) / 20 + 0.01,
      y: (baseHeight + socket.frame[7]) / 20,
      z: (stud.frame[11] - socket.frame[11]) / 20 + 0.01,
    });
    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.matrix[5]).toBe(1);
    assertExactContacts(model, result);
    const committed = { ...model, instances: model.instances.map((i, n) => n === 1 ? { ...i, matrix: result.matrix } : i) };
    expect(activeConnections(committed, model.instances[1].id)).toHaveLength(result.contacts.length);
  });

for (const tile of standards.filter(s => s.kind === "Tile")) it(`does not invent a studded top on ${tile.reference}`, () => {
  const model = catalogModel(`1 4 0 -8 0 1 0 0 0 1 0 0 0 1 ${tile.reference}\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat`);
  const result = constructionTransform(model, model.instances[1].id, { x: 0, y: 0.8, z: 0 });
  expect(result.contacts).toHaveLength(0);
});

it("rejects changed flat-pin geometry instead of applying the reviewed source supplement by part number", () => {
  const model = catalogModel("1 7 0 -8 0 1 0 0 0 1 0 0 0 1 3023a.dat");
  const file = model.resources["parts/3023a.dat"];
  model.resources = { ...model.resources, [file.path]: { ...file, content: file.content.replace("16 8 6", "12 8 6") } };
  expect(describeConnections("3023a.dat", model).connectors.filter(c => c.gender === "F")).toHaveLength(0);
});

for (const quarter of [0, 1, 2, 3]) for (const row of [-1, 1])
  it(`aligns both rendered sockets at arbitrary support yaw, floor offset and quarter ${quarter}, row ${row}`, () => {
    for (const yaw of [0, Math.PI / 2, 0.37]) for (const floor of [0, -2.4])
      for (const startingHeight of [0.4, 0.6, 0.8, 1.2]) {
        const model = catalogModel("1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat");
        const base = new Matrix4().makeRotationY(yaw).setPosition(4.6, -8 - floor * 20, 3.4);
        const moving = new Matrix4().makeRotationY(yaw + quarter * Math.PI / 2).setPosition(160, -8 - floor * 20, 0);
        model.instances = model.instances.map((i, n) => ({ ...i, matrix: affine(n === 0 ? base : moving) }));
        const local = quarter % 2 ? new Vector3(row * 10, -8, 0) : new Vector3(0, -8, row * 10);
        const expected = local.applyMatrix4(base), desired = expected.clone().add(new Vector3(0.3, 0, 0.2));
        const result = constructionTransform(model, model.instances[1].id, { x: desired.x / 20, y: floor + startingHeight, z: desired.z / 20 });
        expect(result.contacts).toHaveLength(2);
        const resultOrigin = new Vector3(result.matrix[3], result.matrix[7], result.matrix[11]);
        expect(resultOrigin.distanceTo(expected)).toBeLessThan(1e-10);
        expect(result.matrix.filter((_, i) => ![3, 7, 11].includes(i)).map(n => n || 0))
          .toEqual(affine(moving).filter((_, i) => ![3, 7, 11].includes(i)).map(n => n || 0));
        assertExactContacts(model, result);
      }
  });

it("snaps onto a free stack layer without occupying the studs already used below it", () => {
  const model = catalogModel("1 4 0 -8 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 4 0 -16 0 1 0 0 0 1 0 0 0 1 3795.dat\n1 7 160 -8 0 1 0 0 0 1 0 0 0 1 3023b.dat");
  const result = constructionTransform(model, model.instances[2].id, { x: 0.03, y: 0.4, z: 0.52 });
  expect(result.contacts).toHaveLength(2);
  expect(result.matrix).toEqual([1, 0, 0, 0, 0, 1, 0, -24, 0, 0, 1, 10]);
  expect(result.contacts.every(c => c.targetId === model.instances[1].id)).toBe(true);
  assertExactContacts(model, result);
});
