/** Explicit maintenance command; uploads approved public data, never app deployments. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import manifest from "./lib/catalog-manifest.json";
import { approvedSnapshot } from "./lib/ldraw-snapshot";
import { ldrawStorage } from "./lib/ldraw-storage";
import { logger } from "./lib/logger";

const root = new URL("../../../generated-artifacts/catalog-sources/", import.meta.url);
const bytes = await readFile(new URL("catalog.bin", root));
if (bytes.length !== manifest.bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) throw new Error("Unapproved catalog bytes");
const bucket = ldrawStorage.bucket(approvedSnapshot.bucket);
for (const [name, source] of Object.entries(manifest.sources)) {
  const raw = await readFile(new URL(`${name}.csv.gz`, root));
  if (createHash("sha256").update(raw).digest("hex") !== source.sha256) throw new Error(`Invalid source: ${name}`);
  await bucket.file(`catalog/sources/${source.sha256}/${name}.csv.gz`).save(raw, { resumable: false, contentType: "application/octet-stream" });
}
await bucket.file(manifest.object).save(bytes, { resumable: false, contentType: "application/octet-stream" });
const [verified] = await bucket.file(manifest.object).download();
if (createHash("sha256").update(verified).digest("hex") !== manifest.sha256) throw new Error("Stored snapshot mismatch");
logger.info({ version: manifest.version, sha256: manifest.sha256, bytes: bytes.length }, "Catalog uploaded and verified");
