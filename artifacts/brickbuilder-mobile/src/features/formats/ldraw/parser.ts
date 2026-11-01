import type { Affine, ImportedInstance, ImportIssue } from "../types";

export const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
export function multiply(a: Affine, b: Affine): Affine {
  const result = [...IDENTITY] as Affine;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      result[row * 4 + col] = (col === 3 ? a[row * 4 + 3] : 0) +
        a[row * 4] * b[col] + a[row * 4 + 1] * b[4 + col] + a[row * 4 + 2] * b[8 + col];
    }
  }
  if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) throw new Error("Transformation außerhalb sicherer Grenzen.");
  return result;
}
export function referenceLine(line: string) {
  const tokens = line.trim().split(/\s+/);
  if (tokens[0] !== "1" || tokens.length < 15) throw new Error("Ungültige LDraw-Referenzzeile.");
  const values = tokens.slice(2, 14).map(Number);
  if (values.some(n => !Number.isFinite(n) || Math.abs(n) > 1e7)) throw new Error("Ungültige LDraw-Matrix.");
  const [x, y, z, a, b, c, d, e, f, g, h, i] = values;
  if (!/^(?:\d+|0x2[0-9a-f]{6})$/i.test(tokens[1])) throw new Error("Ungültiger LDraw-Farbcode.");
  const reference = tokens.slice(14).join(" ").replaceAll("\\", "/");
  if (reference.length > 240 || reference.startsWith("/") || reference.includes(":") || reference.split("/").includes("..")) throw new Error("Unsichere Teilreferenz.");
  return { color: tokens[1], reference, matrix: [a, b, c, x, d, e, f, y, g, h, i, z] as Affine };
}
export function parseLDraw(text: string) {
  if (text.length > 16 * 1024 * 1024 || text.includes("\0")) throw new Error("Modelldatei zu groß oder ungültig.");
  const sections: Record<string, string[]> = Object.create(null);
  let current = "main.ldr", root = current;
  let hasFile = false;
  const preamble: string[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const match = line.match(/^0\s+FILE\s+(.+)$/i);
    if (match) {
      current = match[1].trim().toLowerCase().replaceAll("\\", "/");
      if (!current || Object.hasOwn(sections, current)) throw new Error("Doppeltes Untermodell.");
      if (!hasFile) { root = current; hasFile = true; }
      sections[current] = [];
    } else if (!hasFile) preamble.push(line);
    else sections[current].push(line);
  }
  if (!hasFile) sections[root] = preamble;
  if (Object.keys(sections).length > 1024) throw new Error("Zu viele Untermodelle.");
  const issues: ImportIssue[] = [];
  const instances: ImportedInstance[] = [];
  function expand(name: string, parent: Affine, color: string, path: string[], occurrence: number[]) {
    if (path.includes(name)) throw new Error(`Zyklische Untermodellreferenz: ${name}`);
    if (path.length > 48) throw new Error("Untermodellhierarchie zu tief.");
    const sourcePath = [...path, name];
    for (const [index, line] of sections[name].entries()) {
      if (!line.trim()) continue;
      const type = line.trim().split(/\s+/, 1)[0];
      if (type === "0") continue;
      if (type !== "1") {
        if (!issues.some(i => i.code === `line-${type}`)) issues.push({ code: `line-${type}`, message: `Modell-Zeilentyp ${type} wird nur in der Quelle erhalten, nicht gerendert.` });
        continue;
      }
      const ref = referenceLine(line);
      const effectiveColor = ref.color === "16" ? color : ref.color;
      const matrix = multiply(parent, ref.matrix);
      const key = ref.reference.toLowerCase();
      if (Object.hasOwn(sections, key)) expand(key, matrix, effectiveColor, sourcePath, [...occurrence, index]);
      else {
        if (instances.length >= 10000) throw new Error("Maximal 10.000 Teileinstanzen.");
        instances.push({
          id: crypto.randomUUID(), reference: ref.reference, colorCode: effectiveColor, matrix,
          sourcePath: [...sourcePath, String(index + 1)],
          sourceOccurrence: [...occurrence, index],
          part: { ldrawId: ref.reference.replace(/\.dat$/i, ""), status: "missing" },
        });
      }
    }
  }
  expand(root, IDENTITY, "16", [], []);
  if (!instances.length) throw new Error("Das Modell enthält keine Teileinstanzen.");
  return { root, sections, instances, issues };
}
