import { Vector3 } from "three";
import type { Connector, Section } from "./types";
import { matrix4 } from "./description";

const EPS = 1e-4;
export interface Interval { lo: number; hi: number; shape: string; radius: number; gender: string }
export function intervals(c: Connector): Interval[] {
  let y = c.centered ? c.length / 2 : 0;
  if (c.family === "fingers") return c.sequence.map((length, i) => {
    const hi = y; y -= length;
    return { lo: y, hi, shape: "F", radius: c.radius, gender: i % 2 ? (c.gender === "M" ? "F" : "M") : c.gender };
  });
  const sections: Section[] = c.family === "clip" ? [{ shape: "R", radius: c.radius, length: c.length }] : c.sections;
  return sections.map((s, i) => {
    const hi = y; y -= s.length;
    const profile = s.shape === "_L" ? sections[i - 1] : s.shape === "L_" ? sections[i + 1] : s;
    return { lo: y, hi, shape: profile?.shape ?? "?", radius: profile?.radius ?? s.radius, gender: c.gender };
  });
}
export function potentialPair(a: Connector, b: Connector): boolean {
  if (a.family === "generic" || b.family === "generic") {
    return a.family === b.family && a.gender !== b.gender && a.group === b.group &&
      (a.match === "size" && b.match === "size" ? a.bounding === b.bounding :
        a.match === "group" && b.match === "group" && !!a.group && a.group === b.group);
  }
  if (a.family === "fingers" || b.family === "fingers") return a.family === b.family && a.group === b.group && Math.abs(a.radius - b.radius) < EPS;
  return a.gender !== b.gender && a.group === b.group && !(a.family === "clip" && b.family === "clip");
}
function fits(m: Interval, f: Interval): boolean {
  if (f.shape === "A") return m.shape === "A" && Math.abs(m.radius - f.radius) < EPS;
  if (f.shape === "S") return ["R", "A", "S"].includes(m.shape) && m.radius <= f.radius + EPS;
  if (f.shape === "R") return ["R", "A", "S"].includes(m.shape) && m.radius * (m.shape === "S" ? Math.SQRT2 : 1) <= f.radius + EPS;
  return false;
}
function capped(c: Connector, end: "A" | "B"): boolean {
  return c.caps === "two" || c.caps === end || c.caps === "one" && end === (c.gender === "M" ? "A" : "B");
}
/** Validate the actual overlapping cross-sections, not just matching radii.
 * Coordinates are in B's local Y; offset is A's origin in that frame.
 */
export function profileOverlap(a: Connector, b: Connector, offset: number, direction: number, rollDot = 1): boolean {
  if (!potentialPair(a, b)) return false;
  if (a.family === "generic") return Math.abs(offset) < EPS;
  const ai = intervals(a).map(s => ({ ...s, lo: Math.min(s.lo * direction, s.hi * direction) + offset,
    hi: Math.max(s.lo * direction, s.hi * direction) + offset }));
  const bi = intervals(b);
  if (!ai.length || !bi.length) return false;
  const alo = Math.min(...ai.map(s => s.lo)), ahi = Math.max(...ai.map(s => s.hi));
  const blo = Math.min(...bi.map(s => s.lo)), bhi = Math.max(...bi.map(s => s.hi));
  const low = Math.max(alo, blo), high = Math.min(ahi, bhi);
  if (high - low < Math.min(2, a.length, b.length) - EPS) return false;
  if (a.family === "fingers") {
    let interlock = 0;
    for (const x of ai) for (const y of bi) {
      const overlap = Math.min(x.hi, y.hi) - Math.max(x.lo, y.lo);
      if (overlap <= EPS) continue;
      if (x.gender === "M" && y.gender === "M") return false;
      if (x.gender !== y.gender) interlock += overlap;
    }
    return interlock >= Math.min(a.length, b.length) - EPS;
  }
  let engagement = 0;
  for (const x of ai) for (const y of bi) {
    const overlap = Math.min(x.hi, y.hi) - Math.max(x.lo, y.lo);
    if (overlap <= EPS) continue;
    const male = a.gender === "M" ? x : y, female = a.gender === "F" ? x : y;
    if (!fits(male, female)) return false;
    // Clearance is not a connection. At least one usable section must engage
    // the counterpart profile; a 4-LDU bar floating in a 6-LDU hole is not held.
    if (Math.abs(male.radius - female.radius) < EPS) engagement += overlap;
    // Axle and square profiles have fourfold, not continuous, roll freedom.
    if (["A", "S"].includes(male.shape) && female.shape !== "R" &&
      Math.min(Math.abs(rollDot), Math.abs(Math.abs(rollDot) - 1)) > 1e-4) return false;
  }
  if (engagement < Math.min(2, a.length, b.length) - EPS) return false;
  const clip = a.family === "clip" || b.family === "clip";
  if (!clip && !a.slide && !b.slide && direction > 0) {
    const male = a.gender === "M" ? a : b, female = a.gender === "F" ? a : b;
    if (capped(male, "A") && capped(female, "B") && Math.abs(ahi - bhi) > EPS) return false;
  }
  if (!clip) {
    // A = negative-Y end, B = positive-Y end. A cap forbids the
    // counterpart's solid profile from continuing through that end.
    if (alo < blo - EPS && capped(b, "B") || ahi > bhi + EPS && capped(b, "A")) return false;
    const aNeg = direction > 0 ? "B" : "A", aPos = direction > 0 ? "A" : "B";
    if (blo < alo - EPS && capped(a, aNeg) || bhi > ahi + EPS && capped(a, aPos)) return false;
  }
  return true;
}
export function axes(c: Connector): { position: Vector3; y: Vector3; x: Vector3 } {
  const m = matrix4(c.frame);
  return { position: new Vector3().setFromMatrixPosition(m),
    y: new Vector3().setFromMatrixColumn(m, 1), x: new Vector3().setFromMatrixColumn(m, 0) };
}
