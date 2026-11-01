import { candidates } from "@workspace/ldraw-source";
import { IDENTITY, multiply, referenceLine } from "../formats/ldraw/parser";
import type { Affine, ImportedModel } from "../formats/types";
import { hierarchyRecords } from "./dataset";

/** A refactoring from inline primitive references to subparts must not remove
 * sockets. Compare exact transformed primitive leaves, not filenames, bounds,
 * stud counts or a guessed part-number suffix. Installed sources stay intact.
 * Fail closed on missing resources, cycles, excessive expansion or differences.
 */
export function equivalentPrimitiveHierarchy(reference: string, model: ImportedModel): boolean {
  const graph = hierarchyRecords();
  function signature(installed: boolean): string[] | null {
    const leaves: string[] = [];
    let visits = 0;
    const resolve = (ref: string) => candidates(ref).find(path => installed ? !!model.resources[path] : !!graph[path]);
    function visit(ref: string, transform: Affine, stack: string[]): boolean {
      const path = resolve(ref);
      if (!path || stack.includes(path) || ++visits > 8192 || stack.length > 48) return false;
      // Primitive identity and placement are the invariant across subpart moves.
      // Stud groups are only an organizational layer: older files list the
      // same stud primitives directly. Expand the group before comparing.
      if (path.startsWith("p/") && !/^p\/(?:48\/|8\/)?stug-/.test(path)) {
        leaves.push(`${path}|${transform.map(n => Number(n.toFixed(6))).join(",")}`);
        return true;
      }
      const refs = installed ? model.resources[path].content.split(/\r?\n/).filter(l => /^\s*1\s/.test(l)) : graph[path].refs;
      if (!refs.length) {
        // Do not certify custom mesh-only replacements from an empty signature.
        leaves.push(`${path}|${transform.map(n => Number(n.toFixed(6))).join(",")}`);
      }
      for (const line of refs) {
        const child = referenceLine(line);
        if (!visit(child.reference, multiply(transform, child.matrix), [...stack, path])) return false;
      }
      return true;
    }
    return visit(reference, IDENTITY, []) && leaves.length ? leaves.sort() : null;
  }
  try {
    const actual = signature(true), expected = signature(false);
    return !!actual && !!expected && actual.length === expected.length && actual.every((leaf, i) => leaf === expected[i]);
  } catch { return false; }
}
