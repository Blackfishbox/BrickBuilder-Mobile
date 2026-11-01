import { Matrix4, Vector3 } from "three";
import { candidates } from "@workspace/ldraw-source";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";
import type { Affine, ImportedModel } from "../formats/types";
import { hierarchyRecords, shadowRecords } from "./dataset";
import type { Connector, Description, Diagnostic, Family, Section } from "./types";
import { equivalentPrimitiveHierarchy } from "./hierarchy-equivalence";

export function matrix4(m: Affine): Matrix4 {
  return new Matrix4().set(...m, 0, 0, 0, 1);
}
export function affine(m: Matrix4): Affine {
  const e = m.elements;
  return [e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]];
}
const numberList = (s: string) => s.trim().split(/\s+/).map(Number);
// Official matrices often contain rounded sin/cos values (e.g. 0.707).
// Normalize that documented numerical precision, not meaningful scale/shear.
const close = (a: number, b: number) => Math.abs(a - b) < 0.001;
const caches = new WeakMap<ImportedModel["resources"], Map<string, Description>>();
const snapshotCache = new Map<string, Description>();
const FAMILY: Record<string, Family> = { SNAP_CYL: "cylinder", SNAP_CLP: "clip", SNAP_FGR: "fingers", SNAP_GEN: "generic" };

/** Transform a connector in its own axes, honoring documented scale/mirror policy.
 * Shear is never reinterpreted as a cylinder. ID remains tied to the source path.
 */
export function transformConnector(source: Connector, parent: Affine): Connector | null {
  const frame = multiply(parent, source.frame), m = matrix4(frame);
  const axes = [new Vector3().setFromMatrixColumn(m, 0), new Vector3().setFromMatrixColumn(m, 1), new Vector3().setFromMatrixColumn(m, 2)];
  const [x, y, z] = axes.map(a => a.length());
  if (![x, y, z].every(n => Number.isFinite(n) && n > 1e-8)) return null;
  axes.forEach(a => a.normalize());
  if (Math.abs(axes[0].dot(axes[1])) > 0.001 || Math.abs(axes[0].dot(axes[2])) > 0.001 || Math.abs(axes[1].dot(axes[2])) > 0.001) return null;
  const radial = close(x, z), unitR = close(x, 1) && close(z, 1), unitY = close(y, 1);
  if (!unitR || !unitY) {
    if (!(source.scale === "YOnly" && unitR ||
      source.scale === "ROnly" && radial && unitY ||
      source.scale === "YandR" && radial && (unitR || unitY))) return null;
  }
  if (m.determinant() < 0) {
    if (source.mirror === "none") return null;
    if (!["cor", "corZ"].includes(source.mirror)) return null;
    axes[source.mirror === "corZ" ? 2 : 0].negate();
  }
  const position = new Vector3().setFromMatrixPosition(m);
  axes[0].addScaledVector(axes[1], -axes[0].dot(axes[1])).normalize();
  axes[2].crossVectors(axes[0], axes[1]).normalize();
  m.makeBasis(axes[0], axes[1], axes[2]).setPosition(position);
  const radialScale = close(x, 1) ? 1 : x, axialScale = close(y, 1) ? 1 : y;
  return { ...source, frame: affine(m), radius: source.radius * radialScale,
    length: source.length * axialScale, sections: source.sections.map(s => ({ ...s, radius: s.radius * radialScale, length: s.length * axialScale })),
    sequence: source.sequence.map(n => n * axialScale) };
}

function placements(options: Record<string, string>): Affine[] {
  const p = numberList(options.pos ?? "0 0 0"), o = numberList(options.ori ?? "1 0 0 0 1 0 0 0 1");
  if (p.length !== 3 || o.length !== 9 || [...p, ...o].some(n => !Number.isFinite(n))) throw new Error("Invalid position/orientation");
  const basis: Affine = [o[0], o[1], o[2], p[0], o[3], o[4], o[5], p[1], o[6], o[7], o[8], p[2]];
  if (!options.grid) return [basis];
  const t = options.grid.trim().split(/\s+/);
  // The pinned library also uses the newer X/Y/Z six-value grid form.
  const dimensions = t.filter(v => v !== "C").length === 6 ? 3 : 2;
  const counts: number[] = [], centered: boolean[] = [];
  for (let i = 0; i < dimensions; i++) {
    centered.push(t[0] === "C"); if (t[0] === "C") t.shift();
    counts.push(Number(t.shift()));
  }
  const steps = t.map(Number);
  if (steps.length !== dimensions || ![...counts, ...steps].every(Number.isFinite) ||
    counts.some(n => !Number.isInteger(n) || n < 1) || counts.reduce((a, b) => a * b, 1) > 4096) throw new Error("Invalid or excessive grid");
  const [nx, ny, nz] = dimensions === 3 ? counts : [counts[0], 1, counts[1]];
  const [cx, cy, cz] = dimensions === 3 ? centered : [centered[0], false, centered[1]];
  const [dx, dy, dz] = dimensions === 3 ? steps : [steps[0], 0, steps[1]];
  const frames: Affine[] = [];
  for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) {
    const shift = [...IDENTITY] as Affine;
    shift[3] = (x - (cx ? (nx - 1) / 2 : 0)) * dx;
    shift[7] = (y - (cy ? (ny - 1) / 2 : 0)) * dy;
    shift[11] = (z - (cz ? (nz - 1) / 2 : 0)) * dz;
    frames.push(multiply(basis, shift));
  }
  return frames;
}

/** Exact references only. The real installed hierarchy wins over the pinned
 * reference-only graph. SNAP_INCL intentionally includes direct metas only:
 * the upstream specification explicitly calls it non-recursive.
 */
export function describeConnections(reference: string, model?: ImportedModel): Description {
  let roots: string[];
  try { roots = candidates(reference); } catch { return { connectors: [], diagnostics: [{ path: reference, code: "reference", detail: "Invalid exact LDraw reference" }] }; }
  let cache = snapshotCache;
  if (model) {
    cache = caches.get(model.resources) ?? new Map();
    caches.set(model.resources, cache);
  }
  const key = roots.join("|"), cached = cache.get(key);
  if (cached) return cached;
  const shadows = shadowRecords(), hierarchy = hierarchyRecords(), diagnostics: Diagnostic[] = [];
  const resolve = (ref: string) => {
    try {
      const paths = candidates(ref);
      return paths.find(p => model?.resources[p]) ?? paths.find(p => hierarchy[p]) ?? paths.find(p => shadows[p]);
    } catch { return undefined; }
  };
  let visits = 0;
  const issue = (path: string, code: string, detail: string, line?: number) => diagnostics.push({ path, code, detail, line });
  function visit(path: string, stack: string[], directOnly = false): Connector[] {
    if (stack.includes(path) || stack.length > 48 || ++visits > 50000) {
      issue(path, "cycle-budget", "Cyclic or excessive hierarchy"); return [];
    }
    let result: Connector[] = [];
    const record = shadows[path], installed = model?.resources[path], graph = hierarchy[path];
    if (!directOnly) {
      if (model && !installed) issue(path, "geometry-not-installed", "Metadata is available but this geometry dependency is not installed");
      const refs = installed ? installed.content.split(/\r?\n/).filter(l => /^\s*1\s/.test(l)) : graph?.refs;
      if (!refs && !record) issue(path, "missing-reference", "Neither geometry hierarchy nor shadow record exists");
      for (const [i, line] of (refs ?? []).entries()) {
        try {
          const ref = referenceLine(line), child = resolve(ref.reference);
          if (!child) { issue(path, "missing-reference", ref.reference, i + 1); continue; }
          for (const connector of visit(child, [...stack, path])) {
            const transformed = transformConnector(connector, ref.matrix);
            if (transformed) result.push({ ...transformed, id: `${path}/${i}/${connector.id}` });
            else issue(path, "transform-policy", connector.id, i + 1);
          }
        } catch (error) { issue(path, "hierarchy", String(error), i + 1); }
        if (result.length > 8192) { issue(path, "connector-budget", "More than 8192 expanded connectors"); return []; }
      }
    }
    const lines = record?.text.split(/\r?\n/) ?? [];
    for (const [i, line] of lines.entries()) {
      const meta = line.match(/^0 !LDCAD (SNAP_\w+)(.*)$/);
      if (!meta) continue;
      const options: Record<string, string> = {};
      for (const match of meta[2].matchAll(/\[([^=]+)=([^\]]*)\]/g)) options[match[1].toLowerCase()] = match[2];
      const type = meta[1];
      try {
        if (type === "SNAP_CLEAR") {
          result = options.id ? result.filter(c => c.clearId !== options.id) : []; continue;
        }
        const common = ["id", "pos", "ori", "grid", "scale", "mirror"];
        const allowed: Record<string, string[]> = {
          SNAP_INCL: ["ref"], SNAP_CYL: ["gender", "group", "secs", "caps", "center", "slide"],
          SNAP_CLP: ["radius", "length", "center", "slide", "group"],
          SNAP_FGR: ["genderofs", "seq", "radius", "group", "center"],
          SNAP_GEN: ["gender", "group", "bounding", "match", "placement"],
        };
        if (!allowed[type]) throw new Error(`Unsupported construct ${type}`);
        const unknown = Object.keys(options).filter(k => ![...common, ...allowed[type]].includes(k));
        if (unknown.length) throw new Error(`Unsupported parameters: ${unknown.join(", ")}`);
        const frames = placements(options);
        if (type === "SNAP_INCL") {
          const child = resolve(options.ref ?? "");
          if (!child || !shadows[child]) throw new Error(`Missing include ${options.ref}`);
          const scaling = options.scale ? numberList(options.scale) : [1, 1, 1];
          if (scaling.length !== 3 || scaling.some(n => !Number.isFinite(n))) throw new Error("Invalid include scale");
          for (const [g, frame] of frames.entries()) for (const c of visit(child, [...stack, path], true)) {
            const transform = matrix4(frame).scale(new Vector3(...scaling as [number, number, number]));
            const transformed = transformConnector(c, affine(transform));
            if (transformed) result.push({ ...transformed, id: `${path}:${i + 1}:${g}/${c.id}`, clearId: options.id ?? c.clearId });
            else issue(path, "transform-policy", c.id, i + 1);
          }
          continue;
        }
        const family = FAMILY[type], sections: Section[] = [];
        if (family === "cylinder") {
          const tokens = (options.secs ?? "").trim().split(/\s+/);
          if (tokens.length % 3 || tokens.length < 3) throw new Error("Invalid sections");
          for (let j = 0; j < tokens.length; j += 3) {
            const shape = tokens[j], radius = Number(tokens[j + 1]), length = Number(tokens[j + 2]);
            if (!["R", "A", "S", "_L", "L_"].includes(shape) || !Number.isFinite(radius) || !Number.isFinite(length) || radius < 0 || length <= 0) throw new Error("Unsupported section");
            sections.push({ shape, radius, length });
          }
          if (sections.some((s, j) => s.shape === "L_" && !sections[j + 1] || s.shape === "_L" && !sections[j - 1])) throw new Error("Flexible section without adjacent profile");
        }
        const sequence = options.seq ? numberList(options.seq) : [];
        const length = family === "cylinder" ? sections.reduce((n, s) => n + s.length, 0) : family === "fingers" ? sequence.reduce((a, b) => a + b, 0) : Number(options.length ?? 0);
        // The pinned library's finger defaults are centered, radius 6. The
        // explicit center=false records and the clh* primitives disambiguate
        // these from the older web table's cylinder defaults.
        const radius = Number(options.radius ?? (family === "clip" ? 4 : family === "fingers" ? 6 : 0));
        const gender = options.gender ?? options.genderofs ?? "M";
        const scale = options.scale ?? "none", mirror = options.mirror ?? (family === "cylinder" ? "cor" : "none");
        if (!["M", "F"].includes(gender) || !["none", "YOnly", "ROnly", "YandR"].includes(scale) ||
          !["none", "cor", "corZ"].includes(mirror) || !Number.isFinite(radius) || radius < 0 ||
          !Number.isFinite(length) || sequence.some(n => !Number.isFinite(n) || n <= 0)) throw new Error("Invalid profile policy");
        for (const flag of ["center", "slide"]) if (options[flag] && !["true", "false"].includes(options[flag])) throw new Error(`Invalid ${flag}`);
        if (family === "fingers" && (!sequence.length || !radius)) throw new Error("Invalid finger sequence");
        if (family === "clip" && (!radius || length <= 0)) throw new Error("Invalid clip");
        const bounding = options.bounding ?? "pnt";
        if (family === "generic") {
          const [kind, ...sizes] = bounding.split(/\s+/), counts: Record<string, number> = { pnt: 0, box: 3, cube: 1, cyl: 2, sph: 1 };
          if (sizes.length !== counts[kind] || sizes.some(n => !Number.isFinite(Number(n)) || Number(n) <= 0)) throw new Error("Invalid generic bound");
          if (!["group", "size"].includes(options.match ?? "group") || !["normal", "free"].includes(options.placement ?? "normal")) throw new Error("Unsupported generic policy");
          if ((options.match ?? "group") === "group" && !options.group) throw new Error("Generic group absent");
        }
        const caps = options.caps ?? "one";
        if (!["none", "one", "two", "A", "B"].includes(caps)) throw new Error("Invalid caps");
        for (const [g, frame] of frames.entries()) {
          const connector: Connector = { id: `${path}:${i + 1}:${g}`, clearId: options.id ?? "", family, frame,
            gender: family === "clip" ? "F" : gender as "M" | "F", group: options.group ?? "", sections, length,
            centered: options.center ? options.center === "true" : family === "fingers", slide: options.slide === "true", caps, sequence, radius, bounding,
            match: options.match ?? "group", placement: options.placement ?? "normal", scale, mirror,
            evidence: { path, line: i + 1, sha256: record!.sha256 } };
          const checked = transformConnector(connector, IDENTITY);
          if (!checked) throw new Error("Non-orthogonal connector frame");
          result.push(checked);
        }
      } catch (error) { issue(path, "unsupported-meta", String(error), i + 1); }
    }
    return result;
  }
  const root = resolve(reference);
  const connectors = root ? visit(root, []) : [];
  if (!root) issue(reference, "missing-reference", "Exact reference absent from installed and pinned libraries");
  if (model && root) {
    const isStudSocket = (c: Connector) => c.family === "cylinder" && c.gender === "F" && c.caps === "one" &&
      !c.centered && !c.slide && c.sections.length === 1 && ["R", "S"].includes(c.sections[0].shape) &&
      c.sections[0].radius === 6 && c.sections[0].length === 4;
    const canonical = describeConnections(reference).connectors.filter(isStudSocket);
    const socketKey = (c: Connector) => JSON.stringify([c.frame, c.sections, c.group]);
    const present = new Set(connectors.filter(isStudSocket).map(socketKey));
    const missing = canonical.filter(c => !present.has(socketKey(c)));
    if (missing.length && equivalentPrimitiveHierarchy(reference, model)) {
      connectors.push(...missing);
      issue(root, "equivalent-hierarchy-sockets",
        "Recovered pinned standard stud sockets after verifying identical transformed primitive references in the installed hierarchy");
    }
  }
  // Duplicate inherited contacts describe one physical socket, not extra capacity.
  const seen = new Set<string>();
  const result = { connectors: connectors.filter(c => {
    const identity = JSON.stringify([c.family, c.frame, c.gender, c.group, c.sections, c.length, c.sequence, c.bounding]);
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  }), diagnostics };
  // Coverage auditing may visit every official part; runtime should not retain
  // millions of expanded connector objects that the open project never uses.
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
