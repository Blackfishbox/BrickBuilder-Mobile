import { describe, expect, it } from "vitest";
import { describeConnections, transformConnector, matrix4 } from "./description";
import { potentialPair, profileOverlap } from "./profiles";
import { activeConnections, constructionTransform, magneticConstructionTransform, snapConnection } from "./engine";
import { connectionFixture, partLine } from "./fixtures";
import { IDENTITY } from "../formats/ldraw/parser";
import { createEmptyDocument } from "../editor/model";
import { moveImported } from "../editor/ldraw-editing";
import { createHistory, commit, undo, redo } from "../editor/history";
import { importInternal, exportInternal } from "../formats/internal/adapter";
import type { Affine } from "../formats/types";

describe("pinned source expansion", () => {
  it("inherits genuine primitive studs and anti-stud grids without a part whitelist", () => {
    for (const part of ["3001", "3700", "2412b", "4275a", "14417"]) {
      const result = describeConnections(`${part}.dat`);
      expect(result.connectors.length, part).toBeGreaterThan(0);
      expect(result.connectors.every(c => c.evidence.sha256.length === 64)).toBe(true);
    }
    expect(describeConnections("3001.dat").connectors.filter(c => c.clearId === "studC")).toHaveLength(8);
    expect(describeConnections("3001p-does-not-exist.dat").connectors).toHaveLength(0);
  });
  it("resolves a real pin redirect and clear, not stripped filename suffixes", () => {
    const pin = describeConnections("2780.dat");
    expect(pin.connectors.some(c => c.sections.some(s => s.shape === "_L"))).toBe(true);
    expect(pin.connectors.some(c => c.evidence.path === "parts/3673.dat")).toBe(true);
    expect(describeConnections("3705.dat").connectors.some(c => c.sections.some(s => s.shape === "A"))).toBe(true);
  });
  it("reports incomplete includes and rejected parameters rather than enabling them", () => {
    const result = describeConnections("joint8socket1.dat");
    expect(result.diagnostics.some(d => d.code === "unsupported-meta")).toBe(true);
    expect(result.connectors).toHaveLength(0);
  });
  it("honors inherited Y-only scale and mirror correction, but rejects shear", () => {
    const axle = describeConnections("3705.dat").connectors[0];
    const mirrored = transformConnector(axle, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
    expect(mirrored).not.toBeNull();
    expect(transformConnector(axle, [1, 0.2, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])).toBeNull();
    const scaled = transformConnector({ ...axle, scale: "YOnly" }, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0]);
    expect(scaled).toBeNull();
  });
});

describe("genuine source profile families", () => {
  const desc = (part: string) => describeConnections(part).connectors;
  it("supports pin/hole insertion across actual multi-section profiles", () => {
    const pin = desc("2780.dat").find(c => c.gender === "M")!;
    const hole = desc("connhole.dat")[0];
    expect(potentialPair(pin, hole)).toBe(true);
    expect([8, 10, 12, -8, -10, -12].some(n => profileOverlap(pin, hole, n, 1))).toBe(true);
    expect(profileOverlap(pin, hole, 0, 1)).toBe(false); // central collar
  });
  it("accepts an axle in its matching hole but rejects a round pin in an axle hole", () => {
    const axle = desc("3705.dat").find(c => c.sections.some(s => s.shape === "A"))!;
    const hole = desc("32064.dat").find(c => c.gender === "F" && c.sections.some(s => s.shape === "A"))!;
    expect(hole).toBeDefined();
    expect(profileOverlap(axle, hole, 0, 1)).toBe(true);
    const pin = desc("2780.dat").find(c => c.gender === "M")!;
    expect(profileOverlap(pin, hole, 10, 1)).toBe(false);
    expect(profileOverlap(axle, hole, 0, 1, Math.SQRT1_2)).toBe(false);
  });
  it("supports licensed bar/clip profiles, not bars of arbitrary radius", () => {
    const bar = desc("30374.dat").find(c => c.gender === "M")!, clip = desc("4085a.dat").find(c => c.family === "clip")!;
    expect(profileOverlap(bar, clip, 0, 1)).toBe(true);
    expect(profileOverlap({ ...bar, sections: bar.sections.map(s => ({ ...s, radius: 6 })) }, clip, 0, 1)).toBe(false);
    expect(profileOverlap(bar, desc("connhole.dat")[0], 0, 1)).toBe(false);
    expect(profileOverlap({ ...bar, sections: bar.sections.map(s => ({ ...s, radius: 2 })) }, clip, 0, 1)).toBe(false);
  });
  it("interlocks genuine alternating finger sequences", () => {
    // The actual hinge parts reflect these primitives without a mirror policy;
    // those inherited entries are rejected, not silently corrected.
    const a = desc("h2.dat").find(c => c.family === "fingers")!, b = desc("h1.dat").find(c => c.family === "fingers")!;
    expect(a).toBeDefined(); expect(b).toBeDefined();
    expect(profileOverlap(a, b, 0, 1)).toBe(true);
    expect(profileOverlap(a, a, 0, 1)).toBe(false);
  });
  it("uses explicit generic size matching and preserves free ball orientation", () => {
    const a = desc("14417.dat").find(c => c.family === "generic")!, b = desc("30396.dat").find(c => c.family === "generic")!;
    expect(potentialPair(a, b)).toBe(true);
    expect(potentialPair(a, { ...b, bounding: "sph 12" })).toBe(false);
  });
});

describe("oriented connection transactions", () => {
  it("captures studs across the diagonal midpoint rather than leaving grid dead zones", () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 160, -24)].join("\n"));
    const snap = snapConnection(model, model.instances[1].id, { x: 0.49, y: 1.2, z: 0.49 });
    expect(snap?.contacts.length).toBeGreaterThan(0);
    expect(snap!.matrix[7]).toBe(-48);
    expect(snap!.matrix[3] % 20).toBeCloseTo(0);
    expect(snap!.matrix[11] % 20).toBeCloseTo(0);
  });
  it("holds an acquired stud through pointer jitter, then releases and catches the next stud", () => {
    const model = connectionFixture([partLine("3001", 4.6, -24, 3.4), partLine("3003", 160, -24)].join("\n"));
    const id = model.instances[1].id;
    const first = magneticConstructionTransform(model, id, { x: 0.28, y: 1.2, z: 0.2 });
    expect(first.latch).toBeDefined();
    // The raw drag plane stays at 1.2 while the magnet lifts the brick to 2.4.
    for (const x of [0.7, 0.82, 0.73, 1.05]) {
      const held = magneticConstructionTransform(model, id, { x, y: 1.2, z: 0.2 }, first.latch);
      expect(held.transform).toBe(first.transform);
      expect(held.latch).toBe(first.latch);
    }
    const next = magneticConstructionTransform(model, id, { x: 1.25, y: 1.2, z: 0.2 }, first.latch);
    expect(next.transform.matrix[3]).toBeCloseTo(24.6);
    expect(next.transform.matrix[7]).toBe(-48);
    expect(next.latch).not.toBe(first.latch);
    const free = magneticConstructionTransform(model, id, { x: 15, y: 1.2, z: 0.2 }, next.latch);
    expect(free.latch).toBeUndefined();
    expect(free.transform.contacts).toHaveLength(0);
  });
  it("drops a magnetic latch on model changes and explicit vertical movement", () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 160, -24)].join("\n"));
    const id = model.instances[1].id, desired = { x: 0.03, y: 1.2, z: 0.02 };
    const first = magneticConstructionTransform(model, id, desired);
    expect(first.latch).toBeDefined();
    const changed = { ...model, instances: [model.instances[1]] };
    expect(magneticConstructionTransform(changed, id, desired, first.latch).latch).toBeUndefined();
    expect(magneticConstructionTransform(model, id, { ...desired, y: 12 }, first.latch).latch).toBeUndefined();
  });
  it("snaps ordinary off-grid studs and persists the complete exact matrix", () => {
    const model = connectionFixture([partLine("3001", 4.6, -24, 3.4), partLine("3003", 160, -24)].join("\n"));
    const id = model.instances[1].id;
    const snap = snapConnection(model, id, { x: 0.28, y: 1.2, z: 0.2 });
    expect(snap).not.toBeNull();
    expect(snap!.matrix[3]).toBe(4.6); expect(snap!.matrix[7]).toBe(-48); expect(snap!.matrix[11]).toBe(3.4);
    const document = { ...createEmptyDocument(), imported: model };
    const next = moveImported(document, id, { x: snap!.matrix[3] / 20, y: -snap!.matrix[7] / 20, z: snap!.matrix[11] / 20 }, false, snap!.matrix);
    const history = commit(createHistory(document), next);
    expect(undo(history).document).toBe(document); expect(redo(undo(history)).document).toBe(next);
    expect(importInternal(exportInternal(next)).imported!.instances[1].matrix).toEqual(snap!.matrix);
    expect(activeConnections(next.imported!, id).length).toBeGreaterThan(0);
    expect(next.imported!.originalBytes).toBe(model.originalBytes);
    expect(activeConnections(model, id)).toHaveLength(0);
  });
  it("finds oriented pin insertion without rejecting the whole-part bounding overlap", () => {
    const model = connectionFixture([partLine("3700"), partLine("2780", 160, 10, 0)].join("\n"));
    const id = model.instances[1].id;
    const snap = snapConnection(model, id, { x: 0.03, y: -0.5, z: 0.5 });
    expect(snap?.contacts.some(c => c.evidence.some(e => e.path === "parts/3673.dat"))).toBe(true);
    expect(snap!.matrix.some((v, i) => ![3, 7, 11].includes(i) && v !== model.instances[1].matrix[i])).toBe(true);
  });
  it("commits the validated nonzero depth of a genuine asymmetric friction-pin profile", () => {
    // Unlike the symmetric complete pin, confric5 has one base collar and a
    // single flexible tip: R8/2, R6/16, _L6.25/2, non-centered, capped A.
    // It is genuine licensed primitive geometry inherited by 2780.
    const model = connectionFixture([partLine("3700"), partLine("confric5", 160, 10, 12)].join("\n"));
    const id = model.instances[1].id;
    const snap = snapConnection(model, id, { x: 0.02, y: -0.5, z: 0.6 });
    expect(snap).not.toBeNull();
    expect(snap!.matrix[3]).toBe(0);
    expect(snap!.matrix[7]).toBe(10);
    expect(snap!.matrix[11]).toBe(12); // Not -12: the collar stays at the near mouth.
    const document = { ...createEmptyDocument(), imported: model };
    const committed = moveImported(document, id, { x: 0, y: -0.5, z: 0.6 }, false, snap!.matrix);
    expect(committed.imported!.instances[1].id).toBe(id);
    expect(activeConnections(committed.imported!, id)).toHaveLength(1);
    const persisted = importInternal(exportInternal(committed));
    expect(persisted.imported!.instances[1].matrix).toEqual(snap!.matrix);
    // Importing a JSON file creates a new project with fresh instance IDs.
    const contacts = activeConnections(persisted.imported!, persisted.imported!.instances[1].id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ state: "verified", movingConnectorId: snap!.contacts[0].movingConnectorId });
    expect(contacts[0].evidence.some(e => e.path === "p/confric5.dat")).toBe(true);
    const moving = transformConnector(describeConnections("confric5.dat", model).connectors[0], snap!.matrix)!;
    const target = describeConnections("3700.dat", persisted.imported!).connectors.find(c => c.evidence.path === "p/connhole.dat")!;
    const worldTarget = transformConnector(target, model.instances[0].matrix)!;
    const inverse = matrix4(worldTarget.frame).invert(), relative = matrix4(moving.frame).premultiply(inverse);
    expect(relative.elements[13]).toBe(-12);
    expect(profileOverlap(moving, worldTarget, -12, -1)).toBe(true);
    expect(profileOverlap(moving, worldTarget, 12, -1)).toBe(false);
  });
  it("snaps the genuine axle and clip examples using actual geometry", () => {
    for (const [target, moving, position] of [
      ["32064", "3705", { x: 0.02, y: -0.5, z: 0.02 }],
      ["4085a", "30374", { x: 0.02, y: -0.2, z: -1.02 }],
    ] as const) {
      const model = connectionFixture([partLine(target), partLine(moving, 160)].join("\n"));
      const id = model.instances[1].id, snap = snapConnection(model, id, position);
      expect(snap, `${moving}/${target}`).not.toBeNull();
      const next = { ...model, instances: model.instances.map(i => i.id === id ? { ...i, matrix: snap!.matrix } : i) };
      expect(activeConnections(next, id).length, `${moving}/${target}`).toBeGreaterThan(0);
    }
  });
  it("snaps actual finger primitives with opposite bodies and free spherical profiles", () => {
    const hinge = connectionFixture([partLine("h1"), partLine("h2", 160, 20, 0, "-1 0 0 0 -1 0 0 0 1")].join("\n"));
    expect(snapConnection(hinge, hinge.instances[1].id, { x: 0.02, y: -1, z: 0.02 })?.contacts.some(c => c.family === "fingers")).toBe(true);
    const ball = connectionFixture([partLine("14417"), partLine("30396", 160, 4, -30)].join("\n"));
    expect(snapConnection(ball, ball.instances[1].id, { x: 0.02, y: -0.2, z: -1.5 })?.contacts.some(c => c.family === "generic")).toBe(true);
  });
  it("expands genuine 3D grids and normalizes rounded rotation frames", () => {
    const grid = describeConnections("11299.dat");
    expect(grid.diagnostics.some(d => d.detail.includes("grid"))).toBe(false);
    expect(grid.connectors.filter(c => c.evidence.path === "parts/11299.dat")).toHaveLength(8);
    expect(describeConnections("3820.dat").connectors.some(c => c.family === "clip")).toBe(true);
  });
  it("releases away from connectors and does not mark touching bounding boxes", () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 160, -24)].join("\n"));
    const id = model.instances[1].id;
    const result = constructionTransform(model, id, { x: 12.1, y: 1.2, z: 0 });
    expect(result.contacts).toHaveLength(0);
    expect(result.matrix[3]).toBe(240);
    expect(activeConnections(model, id)).toHaveLength(0);
  });
  it("uses the next free layer and rejects an occupied socket", () => {
    const model = connectionFixture([partLine("3001", 0, -24), partLine("3003", 0, -48), partLine("3003", 160, -24)].join("\n"));
    const result = snapConnection(model, model.instances[2].id, { x: 0.02, y: 1.2, z: 0.02 });
    expect(result).not.toBeNull();
    expect(result!.matrix[7]).toBeCloseTo(-72);
  });
  it("records representative cold/warm Node costs without claiming Android FPS", () => {
    const before = process.memoryUsage().heapUsed, start = performance.now();
    const model = connectionFixture(Array.from({ length: 3000 }, (_, i) => partLine("3003", i * 80, -24)).join("\n"));
    const id = model.instances.at(-1)!.id;
    const first = snapConnection(model, id, { x: 0.03, y: 1.2, z: 0.02 });
    const cold = performance.now() - start, warmStart = performance.now();
    for (let i = 0; i < 50; i++) expect(snapConnection(model, id, { x: 0.03 + i / 10000, y: 1.2, z: 0.02 })).not.toBeNull();
    const warm = performance.now() - warmStart;
    console.info(JSON.stringify({ benchmark: "3000-part-generalized-connections-Node", coldMs: cold,
      warm50Ms: warm, heapDeltaMiB: (process.memoryUsage().heapUsed - before) / 1048576, contacts: first?.contacts.length }));
    expect(first).not.toBeNull();
  });
});
