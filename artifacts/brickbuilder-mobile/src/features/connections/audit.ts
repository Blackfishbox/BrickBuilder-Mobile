/** Explicit offline audit command (not imported by the application).
 * pnpm --filter @workspace/scripts exec tsx ../artifacts/brickbuilder-mobile/src/features/connections/audit.ts
 */
import { writeFileSync } from "node:fs";
import { hierarchyRecords, shadowRecords } from "./dataset";
import { describeConnections } from "./description";

const start = performance.now();
const records = { ...hierarchyRecords(), ...shadowRecords() };
const familyParts: Record<string, number> = {}, diagnostics: Record<string, number> = {};
const rejected = new Map<string, unknown>();
const parts: Record<string, { connectors: number; families: string[]; diagnostics: number }> = {};
let expanded = 0, usable = 0;
for (const path of Object.keys(records).sort()) {
  if (!path.startsWith("parts/") || path.startsWith("parts/s/")) continue;
  const result = describeConnections(path), families = [...new Set(result.connectors.map(c => c.family))].sort();
  if (result.connectors.length) { usable++; expanded += result.connectors.length; }
  for (const family of families) familyParts[family] = (familyParts[family] ?? 0) + 1;
  for (const diagnostic of result.diagnostics) {
    const key = JSON.stringify(diagnostic);
    if (!rejected.has(key)) {
      rejected.set(key, diagnostic);
      diagnostics[diagnostic.code] = (diagnostics[diagnostic.code] ?? 0) + 1;
    }
  }
  parts[path] = { connectors: result.connectors.length, families, diagnostics: result.diagnostics.length };
}
const report = {
  version: 1, shadowRevision: "9b1131fb1991f8c0bfc072325e4e12f6271aba35",
  sourceRecords: Object.keys(shadowRecords()).length, hierarchyRecords: Object.keys(hierarchyRecords()).length,
  expandedPartRecords: Object.keys(parts).length, partsWithParsedConnectors: usable,
  expandedConnectorDescriptions: expanded, familyParts, uniqueDiagnostics: diagnostics,
  meaning: "Parsed connectors are not certified part-pair connections. Geometry must be installed, transforms and profile constraints must match, contacts must be free and obstruction checks must pass.",
  testedExamples: {
    cylinder: ["3001/3003", "2780/3700", "3705/32064"],
    clip: ["30374/4085a"], fingers: ["p/h1.dat/p/h2.dat"],
    generic: ["14417/30396"],
  },
  rejected: [...rejected.values()], parts,
};
writeFileSync(new URL("../../../public/licenses/connections/coverage.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...report, parts: undefined, rejected: undefined, elapsedSeconds: (performance.now() - start) / 1000, heapMiB: process.memoryUsage().heapUsed / 1048576 }, null, 2));
