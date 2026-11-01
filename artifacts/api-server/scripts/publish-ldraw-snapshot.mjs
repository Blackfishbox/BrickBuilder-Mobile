import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import { resolve } from "node:path";
import { ldrawStorage } from "../src/lib/ldraw-storage.ts";

// Explicit maintenance command only. Never invoked by build/start.
const [root, bucket] = process.argv.slice(2);
if (!root || !bucket) throw new Error("Usage: node --experimental-strip-types scripts/publish-ldraw-snapshot.mjs APPROVED_DIR BUCKET");
const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256)) throw new Error("Invalid approved archive");
const object = `ldraw/approved/${manifest.sha256}/snapshot.jsonl.gz`;
const { createWriteStream } = await import("node:fs");
const { mkdir } = await import("node:fs/promises");
const packed = resolve(root, "../snapshot.jsonl.gz");
await mkdir(resolve(root, ".."), { recursive: true });
async function* records() {
  for (const path of ["manifest.json", ...Object.keys(manifest.files).sort()]) {
    if (path.includes("..") || path.startsWith("/")) throw new Error("Unsafe snapshot path");
    const bytes = await readFile(resolve(root, path));
    if (path !== "manifest.json" && createHash("sha256").update(bytes).digest("hex") !== manifest.files[path]) {
      throw new Error(`Changed approved file: ${path}`);
    }
    yield JSON.stringify({ path, base64: bytes.toString("base64") }) + "\n";
  }
}
await pipeline(Readable.from(records()), createGzip({ level: 6 }), createWriteStream(packed));
const hash = createHash("sha256");
for await (const chunk of createReadStream(packed)) hash.update(chunk);
const sha256 = hash.digest("hex");
// Prevent accidental replacement of an already approved immutable object.
await ldrawStorage.bucket(bucket).upload(packed, {
  destination: object,
  preconditionOpts: { ifGenerationMatch: 0 },
  metadata: { contentType: "application/octet-stream", cacheControl: "private, max-age=31536000, immutable" },
});
console.log(JSON.stringify({ bucket, object, sha256, archiveSha256: manifest.sha256 }, null, 2));
