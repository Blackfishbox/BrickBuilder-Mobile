import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Box3, Vector3 } from "three";
import { multiply, parseLDraw } from "../formats/ldraw/parser";
import type { Affine, ImportedModel } from "../formats/types";
import { STUD_PARTS, studPart } from "./stud-connectors";
import { constructionPosition, snapStudConnection } from "./stud-snapping";
import * as geometry from "./ldraw-geometry";
import { createEmptyDocument } from "../editor/model";
import { moveImported } from "../editor/ldraw-editing";
import { commit, createHistory, redo, undo } from "../editor/history";
import { exportInternal, importInternal } from "../formats/internal/adapter";

const packages = ["bricks", "plates"].map(group => JSON.parse(readFileSync(
  new URL(`../../../public/parts/ldraw-${group}-2026-10-31.json`, import.meta.url), "utf8",
)));
const resources = Object.fromEntries(packages.flatMap(pkg => pkg.files).map(file => [file.path, file])) as ImportedModel["resources"];
function fixture(parts: Array<{ part: string; x?: number; y?: number; z?: number; basis?: number[] }>): ImportedModel {
  const sourceText = parts.map(({ part, x = 0, y = 1.2, z = 0, basis = [1, 0, 0, 0, 1, 0, 0, 0, 1] }) =>
    `1 4 ${x * 20} ${-y * 20} ${z * 20} ${basis.join(" ")} ${part}.dat`,
  ).join("\n");
  const model: ImportedModel = { version: 1, format: "ldr", sourceName: "stud-fixture.ldr", sourceText,
    originalBytes: Array.from(new TextEncoder().encode(sourceText)), ...parseLDraw(sourceText), resources, legalDocuments: [] };
  model.instances.forEach(instance => { instance.part.status = "resolved"; });
  return model;
}

describe("reviewed standard stud connections", () => {
  for (const [id, definition] of Object.entries(STUD_PARTS)) {
    it(`matches the bundled original LDraw body and stud envelope for ${id}`, () => {
      const model = fixture([{ part: id, y: 0 }]), instance = model.instances[0];
      const part = studPart(instance)!;
      const bounds = new Box3(), point = new Vector3(), matrix = geometry.worldMatrix(instance.matrix);
      for (const surface of geometry.compilePart(model, instance.reference, "16")) {
        for (let i = 0; i < surface.positions.length; i += 3) bounds.expandByPoint(point.fromArray(surface.positions, i).applyMatrix4(matrix));
      }
      expect(part.studs).toHaveLength(definition.x * definition.z);
      expect(bounds.min.y).toBeCloseTo(-definition.height / 20);
      expect(bounds.max.y).toBeCloseTo(0.2);
      expect(bounds.min.x).toBeCloseTo(part.body.min.x);
      expect(bounds.max.x).toBeCloseTo(part.body.max.x);
      expect(bounds.min.z).toBeCloseTo(part.body.min.z);
      expect(bounds.max.z).toBeCloseTo(part.body.max.z);
      // Each reviewed top center must be an actual stud primitive in the source
      // hierarchy, not a generated point inferred from a bounding box.
      const topCenters: Vector3[] = [];
      function visit(path: string, parent: Affine): void {
        const file = model.resources[path];
        for (const line of file.content.split(/\r?\n/)) {
          const tokens = line.trim().split(/\s+/);
          if (tokens[0] !== "1") continue;
          const reference = tokens.slice(14).join(" ").replace(/\\/g, "/").toLowerCase();
          const m = tokens.slice(2, 14).map(Number);
          const child: Affine = [m[3], m[4], m[5], m[0], m[6], m[7], m[8], m[1], m[9], m[10], m[11], m[2]];
          const world = geometry.worldMatrix(parent);
          if (reference === "stud.dat") topCenters.push(new Vector3(child[3], child[7], child[11]).applyMatrix4(world));
          else {
            const target = [`parts/${reference}`, `p/${reference}`, reference].find(path => model.resources[path]);
            if (target && /(?:^|\/)(?:s\/|stug-)|\/s\//.test(target)) {
              visit(target, multiply(parent, child));
            }
          }
        }
      }
      const root = `parts/${id === "3023" ? "3023b" : id}.dat`;
      visit(root, instance.matrix);
      for (const stud of part.studs) expect(topCenters.some(center => center.distanceTo(stud) < 1e-5)).toBe(true);
    });
  }

  it("mates brick undersides at the body plane rather than above stud tips", () => {
    const model = fixture([{ part: "3001" }, { part: "3003", x: 8 }]);
    const snap = snapStudConnection(model, model.instances[1].id, { x: 0.08, y: 1.2, z: 0.06 })!;
    expect(snap.position).toEqual({ x: 0, y: 2.4, z: 0 });
    expect(snap.connections).toBe(4);
  });

  it("uses plate height and supports a quarter-turn", () => {
    const model = fixture([{ part: "3001" }, { part: "3023b", x: 8, y: 0.4, basis: [0, 0, 1, 0, 1, 0, -1, 0, 0] }]);
    const snap = snapStudConnection(model, model.instances[1].id, { x: 0.57, y: 0.4, z: 0.04 })!;
    expect(snap.position.x).toBeCloseTo(0.5);
    expect(snap.position.z).toBeCloseTo(0);
    expect(snap.position.y).toBeCloseTo(1.6);
    expect(snap.connections).toBe(2);
  });

  it("keeps off-grid imported connection positions through commit, history and JSON", () => {
    const model = fixture([{ part: "3001", x: 0.23, z: 0.17 }, { part: "3003", x: 8 }]);
    const id = model.instances[1].id, original = JSON.stringify(model);
    const position = constructionPosition(model, id, { x: 0.28, y: 1.2, z: 0.2 });
    expect(position.x).toBeCloseTo(0.23); expect(position.z).toBeCloseTo(0.17);
    const document = { ...createEmptyDocument(), imported: model };
    const edited = moveImported(document, id, position, false);
    const history = commit(createHistory(document), edited);
    expect(undo(history).document).toBe(document);
    expect(redo(undo(history)).document).toBe(edited);
    const restored = importInternal(exportInternal(edited));
    expect(restored.imported!.instances[1].matrix[3]).toBeCloseTo(4.6);
    expect(JSON.stringify(model)).toBe(original);
  });

  it("releases when pulled away and ignores unrelated overhead supports", () => {
    const model = fixture([{ part: "3001" }, { part: "3003", x: 8 }, { part: "3001", y: 10 }]);
    const id = model.instances[1].id;
    expect(constructionPosition(model, id, { x: 0.05, y: 1.2, z: 0.05 }).y).toBeCloseTo(2.4);
    expect(constructionPosition(model, id, { x: 12, y: 1.2, z: 0 }).y).toBeCloseTo(1.2);
  });

  it("uses the top free layer rather than an already occupied connection", () => {
    const model = fixture([{ part: "3001" }, { part: "3003", y: 2.4 }, { part: "3003", x: 8 }]);
    const snap = snapStudConnection(model, model.instances[2].id, { x: 0.05, y: 1.2, z: 0.05 })!;
    expect(snap.position.y).toBeCloseTo(3.6);
    expect(snap.supportId).toBe(model.instances[1].id);
  });

  it("allows aligned bridges but refuses offset studs penetrating an underside edge", () => {
    for (const [offset, allowed] of [[1, true], [1.5, false]] as const) {
      const model = fixture([{ part: "3005" }, { part: "3005", x: offset }, { part: "3004", x: 8 }]);
      const snap = snapStudConnection(model, model.instances[2].id, { x: 0.52, y: 1.2, z: 0.03 });
      expect(Boolean(snap)).toBe(allowed);
      if (snap) expect(snap.connections).toBe(2);
    }
  });

  it("does not invent connectors for unknown, tilted, scaled or mirrored parts", () => {
    const model = fixture([{ part: "3001" }, { part: "3003", x: 8 }]);
    const instance = model.instances[1];
    for (const basis of [[1, 0, 0, 0, 0, -1, 0, 1, 0], [2, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, 1]]) {
      const m = instance.matrix;
      const matrix: Affine = [basis[0], basis[1], basis[2], m[3], basis[3], basis[4], basis[5], m[7], basis[6], basis[7], basis[8], m[11]];
      expect(studPart({ ...instance, matrix })).toBeNull();
    }
    expect(studPart({ ...instance, reference: "3003p01.dat" })).toBeNull();
    expect(studPart({ ...instance, part: { ...instance.part, status: "missing" } })).toBeNull();
  });

  it("rejects a candidate blocked by geometry without reviewed connectors", () => {
    const model = fixture([
      { part: "3001" },
      { part: "3003", y: 2.4 },
      { part: "3003", x: 8 },
    ]);
    // Reflections are now supported according to the source mirror policy.
    // Use real flattened source triangles with no connection hierarchy instead.
    const triangles = geometry.compilePart(model, "3003.dat", "16").flatMap(surface => {
      const lines: string[] = [];
      for (let i = 0; i < surface.positions.length; i += 9) lines.push(`3 16 ${[...surface.positions.slice(i, i + 9)].join(" ")}`);
      return lines;
    }).join("\n");
    model.resources = { ...model.resources, "parts/obstacle.dat": { ...model.resources["parts/3003.dat"], path: "parts/obstacle.dat", content: triangles } };
    model.instances[1] = { ...model.instances[1], reference: "obstacle.dat" };
    expect(snapStudConnection(model, model.instances[2].id, { x: 0.05, y: 1.2, z: 0.05 })).toBeNull();
    expect(constructionPosition(model, model.instances[2].id, { x: 0.05, y: 1.2, z: 0.05 }).y).toBeGreaterThan(2.4);
  });

  it("rejects interfering studs whose support plane is slightly too low", () => {
    const model = fixture([{ part: "3005" }, { part: "3005", x: 1, y: 1.1 }, { part: "3004", x: 8 }]);
    expect(snapStudConnection(model, model.instances[2].id, { x: 0.52, y: 1.2, z: 0.03 })).toBeNull();
  });

  it("reuses cached geometry and local searches across repeated large-model drags", () => {
    const model = fixture(Array.from({ length: 3000 }, (_, i) => ({ part: "3003", x: i * 4 })));
    const id = model.instances.at(-1)!.id;
    snapStudConnection(model, id, { x: 0.05, y: 1.2, z: 0.05 });
    const compile = vi.spyOn(geometry, "compilePart");
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
      expect(snapStudConnection(model, id, { x: 0.05 + i / 10000, y: 1.2, z: 0.05 })?.connections).toBe(4);
    }
    console.info(`3000-part cached stud search: 100 updates in ${(performance.now() - start).toFixed(1)}ms (Node, not Android FPS)`);
    expect(compile).not.toHaveBeenCalled(); compile.mockRestore();
  });
});
