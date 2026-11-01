import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Readable } from "node:stream";
import { restoreArchive } from "./ldraw-archive.ts";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const data = Buffer.from("0 Test\r\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\r\n");
function fixture(records, extra = {}) {
  const manifest = { version: 1, sha256: "a".repeat(64), files: { "parts/3004.dat": sha(data) }, ...extra };
  const packed = gzipSync([
    { path: "manifest.json", base64: Buffer.from(JSON.stringify(manifest)).toString("base64") },
    ...(records ?? [{ path: "parts/3004.dat", base64: data.toString("base64") }]),
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  return { packed, bundle: { bucket: "test", object: "test", sha256: sha(packed), archiveSha256: "a".repeat(64) } };
}

it("restores exact bytes atomically and reuses the snapshot across restarts without downloading", async () => {
  const cache = await mkdtemp(join(tmpdir(), "ldraw-restore-"));
  try {
    const { packed, bundle } = fixture();
    const root = await restoreArchive(bundle, () => Readable.from([packed]), cache);
    assert.deepEqual(await readFile(join(root, "parts/3004.dat")), data);
    assert.equal(await restoreArchive(bundle, () => { throw new Error("must not download"); }, cache), root);
  } finally { await rm(cache, { recursive: true, force: true }); }
});

it("rejects changed, incomplete, duplicate, traversing and wrong-identity bundles without a completion marker", async () => {
  for (const f of [
    fixture([{ path: "../escape.dat", base64: data.toString("base64") }]),
    fixture([]),
    fixture([{ path: "parts/3004.dat", base64: Buffer.from("changed").toString("base64") }]),
    fixture([{ path: "parts/3004.dat", base64: data.toString("base64") }, { path: "parts/3004.dat", base64: data.toString("base64") }]),
    fixture(undefined, { sha256: "b".repeat(64) }),
    { ...fixture(), packed: Buffer.from("corrupted") },
  ]) {
    const cache = await mkdtemp(join(tmpdir(), "ldraw-restore-"));
    try {
      await assert.rejects(restoreArchive(f.bundle, () => Readable.from([f.packed]), cache));
      await assert.rejects(readFile(join(cache, f.bundle.sha256, ".complete")));
    } finally { await rm(cache, { recursive: true, force: true }); }
  }
});

it("does not commit a failed download and a later attempt can succeed", async () => {
  const cache = await mkdtemp(join(tmpdir(), "ldraw-restore-"));
  const { bundle, packed } = fixture();
  try {
    await assert.rejects(restoreArchive(bundle, () => Readable.from((async function* () {
      yield packed.subarray(0, 10); throw new Error("connection lost");
    })()), cache), /connection lost/);
    const root = await restoreArchive(bundle, () => Readable.from([packed]), cache);
    await writeFile(join(root, "parts/3004.dat"), "changed");
    // Restored files remain subject to the provider's per-request hash/license validation.
    const { LDrawProvider } = await import("./ldraw-provider.ts");
    await assert.rejects(new LDrawProvider(() => { throw new Error("no live fallback"); }, root).get("parts/3004.dat"));
  } finally { await rm(cache, { recursive: true, force: true }); }
});
