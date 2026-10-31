// Run explicitly to refresh reviewed, vendored LDraw snapshots. Not run during app builds.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const source = "https://library.ldraw.org/library/official/";
const version = "2026-10-31";
const groups = [
  { id: "ldraw-bricks", title: "LDraw · Steine", description: "Sechs klassische Steine mit Original-LDraw-Dateien.", category: "Steine", ids: ["3001", "3002", "3003", "3004", "3005", "3006"] },
  { id: "ldraw-plates", title: "LDraw · Platten", description: "Sechs flache Platten mit Original-LDraw-Dateien.", category: "Platten", ids: ["3020", "3021", "3022", "3023", "3024", "3710"] },
];
const cache = new Map();
async function getFile(path) {
  if (cache.has(path)) return cache.get(path);
  const response = await fetch(source + path, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const content = await response.text();
  const author = content.match(/^0 Author: (.+)\r?$/m)?.[1]?.trim();
  const license = content.includes("0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt")
    ? "CC-BY-4.0"
    : content.includes("0 !LICENSE Licensed under CC0 : see CAreadme.txt") ? "CC0-1.0" : null;
  if (!author || !license || !/^0 !LDRAW_ORG /m.test(content)) throw new Error(`Unreviewed header/license: ${path}`);
  const file = { path, sourceUrl: source + path, author, license, content };
  cache.set(path, file);
  return file;
}
async function collect(path, files) {
  if (files.has(path)) return;
  const file = await getFile(path);
  files.set(path, file);
  for (const line of file.content.split(/\r?\n/)) {
    if (!/^1\s/.test(line)) continue;
    const ref = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
    if (!/^[a-z0-9_/.-]+\.dat$/.test(ref) || ref.includes("..")) throw new Error(`Unsafe reference: ${ref}`);
    // LDraw resolves subparts from parts/, primitives from p/.
    const paths = ref.startsWith("s/") ? ["parts/" + ref] : ["p/" + ref, "parts/" + ref];
    let resolved;
    for (const candidate of paths) {
      try { resolved = await getFile(candidate); break; } catch (error) {
        if (!String(error).includes("HTTP 404")) throw error;
      }
    }
    if (!resolved) throw new Error(`Missing dependency ${ref}`);
    await collect(resolved.path, files);
  }
}
const manifest = [];
const legalDocuments = await Promise.all(["CAreadme.txt", "CAlicense4.txt"].map(async name => {
  const sourceUrl = source + name;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`License document ${name}: HTTP ${response.status}`);
  return { name, sourceUrl, content: await response.text() };
}));
await mkdir(new URL("public/parts/", root), { recursive: true });
for (const group of groups) {
  const files = new Map();
  const parts = [];
  for (const ldrawId of group.ids) {
    const path = `parts/${ldrawId}.dat`;
    await collect(path, files);
    const file = files.get(path);
    parts.push({
      id: `${group.id}:${ldrawId}`, packageId: group.id, ldrawId,
      name: file.content.split(/\r?\n/)[0].replace(/^0\s+/, "").replace(/\s+/g, " "),
      category: group.category, keywords: [group.category, group.id === "ldraw-bricks" ? "brick" : "plate"],
      file: path,
    });
  }
  const payload = JSON.stringify({ id: group.id, version, parts, files: [...files.values()], legalDocuments });
  const bytes = Buffer.byteLength(payload);
  if (bytes > 1_000_000) throw new Error("Package exceeds small vendored asset budget");
  const filename = `${group.id}-${version}.json`;
  await writeFile(new URL(`public/parts/${filename}`, root), payload);
  manifest.push({
    id: group.id, version, title: group.title, description: group.description,
    url: `parts/${filename}`, sha256: createHash("sha256").update(payload).digest("hex"),
    bytes, partCount: parts.length, fileCount: files.size, sourceUrl: source,
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    licenses: [...new Set([...files.values()].map(f => f.license))],
    attribution: [...new Set([...files.values()].map(f => f.author))].join("; "),
    changes: "Originaldateien unverändert; Auswahl, Paketierung und Suchmetadaten durch BrickBuilder.",
  });
  console.log(`${group.id}: ${parts.length} parts, ${files.size} files, ${bytes} bytes`);
}
await writeFile(new URL("src/features/parts/catalog.json", root), JSON.stringify(manifest, null, 2) + "\n");
console.log("Wrote", fileURLToPath(new URL("src/features/parts/catalog.json", root)));
