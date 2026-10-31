// Explicitly run to refresh this reviewed import geometry snapshot. Never run at app build time.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

const root = new URL("../", import.meta.url);
const source = "https://library.ldraw.org/library/official/";
const model = execFileSync("unzip", ["-p", new URL("../../../attached_assets/ford_mxCopy_Copy-1_1793477649199.io", import.meta.url).pathname, "model.ldr"], { encoding: "utf8" });
const names = new Set([...model.matchAll(/^0 FILE (.+)\r?$/gm)].map(m => m[1].trim().toLowerCase()));
const refs = [...new Set(model.split(/\r?\n/).filter(l => /^1\s/.test(l)).map(l => l.trim().split(/\s+/).slice(14).join(" ").toLowerCase()).filter(n => !names.has(n)))].sort();
const files = new Map();
// Existing licensed snapshots are reused without changing their catalog interfaces.
for (const pkg of JSON.parse(await readFile(new URL("src/features/parts/catalog.json", root)))) {
  const data = JSON.parse(await readFile(new URL(`public/${pkg.url}`, root)));
  for (const f of data.files) files.set(f.path, f);
}
const available = new Map(files);
files.clear();
const failed = new Set();
const archive = process.env.LDRAW_ARCHIVE;
const archivePaths = archive ? new Set(execFileSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).split(/\r?\n/)) : null;
async function getFile(path) {
  if (available.has(path)) return available.get(path);
  if (failed.has(path)) return null;
  let content;
  if (archive) {
    if (!archivePaths.has("ldraw/" + path)) { failed.add(path); return null; }
    content = execFileSync("unzip", ["-p", archive, "ldraw/" + path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  } else {
    const response = await fetch(source + path, { signal: AbortSignal.timeout(30000) });
    if (response.status === 404) { failed.add(path); return null; }
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    content = await response.text();
  }
  const author = content.match(/^0 Author: (.+)\r?$/m)?.[1]?.trim();
  const license = /0 !LICENSE Licensed under CC BY (?:2\.0 and CC BY )?4\.0 : see CAreadme.txt/.test(content) ? "CC-BY-4.0"
    : content.includes("0 !LICENSE Licensed under CC0 : see CAreadme.txt") ? "CC0-1.0" : null;
  if (!author || !license || !/^0 !LDRAW_ORG /m.test(content)) throw new Error(`Unreviewed license/header ${path}`);
  const file = { path, sourceUrl: source + path, author, license, content };
  available.set(path, file);
  return file;
}
async function collect(file) {
  if (files.has(file.path)) return;
  files.set(file.path, file);
  for (const line of file.content.split(/\r?\n/)) {
    if (!/^1\s/.test(line)) continue;
    const ref = line.trim().split(/\s+/).slice(14).join(" ").replaceAll("\\", "/").toLowerCase();
    if (!/^[a-z0-9_/-]+\.dat$/.test(ref)) throw new Error(`Unsafe reference ${ref}`);
    const child = await getFile("parts/" + ref) ?? await getFile("p/" + ref);
    if (!child) throw new Error(`Missing dependency ${ref}`);
    await collect(child);
  }
}
const parts = [];
const missing = [];
for (const ref of refs) {
  const file = await getFile("parts/" + ref);
  if (!file) { missing.push(ref); continue; }
  await collect(file);
  parts.push({ ldrawId: ref.replace(/\.dat$/, ""), name: file.content.split(/\r?\n/)[0].replace(/^0\s+/, "").trim(), file: file.path });
  console.log(ref, files.size);
}
const legalDocuments = await Promise.all(["CAreadme.txt", "CAlicense4.txt"].map(async name => {
  if (archive) return { name, sourceUrl: source + name, content: execFileSync("unzip", ["-p", archive, "ldraw/" + name], { encoding: "utf8" }) };
  const response = await fetch(source + name);
  if (!response.ok) throw new Error(name);
  return { name, sourceUrl: source + name, content: await response.text() };
}));
const bytes = gzipSync(JSON.stringify({ version: "2026-10-31", files: [...files.values()], parts, missing, legalDocuments }), { level: 9 });
await mkdir(new URL("public/parts/", root), { recursive: true });
if (bytes.length > 1_000_000) throw new Error("Snapshot exceeds 1MB reviewed asset budget; use App Storage.");
// .bin prevents servers/proxies from treating the file as precompressed HTTP content.
await writeFile(new URL("public/parts/import-geometry-2026-10-31.bin", root), bytes);
await writeFile(new URL("src/features/formats/geometry-manifest.json", root), JSON.stringify({
  url: "parts/import-geometry-2026-10-31.bin", bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), partCount: parts.length, fileCount: files.size, missing,
}, null, 2) + "\n");
console.log({ bytes: bytes.length, partCount: parts.length, fileCount: files.size, missing });
