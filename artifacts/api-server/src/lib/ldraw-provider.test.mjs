import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LDrawProvider } from "./ldraw-provider.ts";

const valid = "0 Test\n0 Author: Test Author\n0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt\n3 16 0 0 0 1 0 0 0 1 0\n";
const sha = data => createHash("sha256").update(data).digest("hex");
describe("restricted source provider", () => {
  it("rejects traversal and symlinks outside the approved archive before reading file bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ldraw-boundary-"));
    try {
      const archive = join(root, "archive");
      await mkdir(join(archive, "parts"), { recursive: true });
      await writeFile(join(root, "outside.dat"), valid);
      await symlink(join(root, "outside.dat"), join(archive, "parts/a.dat"));
      await writeFile(join(archive, "manifest.json"), JSON.stringify({
        version: 1, sha256: "a".repeat(64), files: { "parts/a.dat": sha(valid) },
      }));
      const provider = new LDrawProvider(async () => { throw new Error("No network allowed"); }, archive);
      for (const path of ["../outside.dat", "parts/../../outside.dat", "parts/%2e%2e/outside.dat", "/etc/passwd"]) {
        assert.throws(() => provider.get(path));
      }
      await assert.rejects(provider.get("parts/a.dat"), e => e.status === 502);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("deduplicates exact bytes and pins fixed source identities", async () => {
    let calls = 0;
    const provider = new LDrawProvider(async url => {
      assert.equal(url, "https://library.ldraw.org/library/official/parts/a.dat"); calls++;
      return new Response(valid);
    });
    const [a, b] = await Promise.all([provider.get("parts/A.dat"), provider.get("parts/a.dat")]);
    assert.equal(calls, 1); assert.equal(a, b);
    assert.equal(a.hash, sha(valid)); assert.equal(Buffer.from(a.bytes).toString(), valid);
    await provider.get("parts/a.dat"); assert.equal(calls, 1);
    for (const path of ["../a.dat", "https://elsewhere/a.dat", "parts/../a.dat", "parts/%2e.dat"]) {
      assert.throws(() => provider.get(path));
    }
  });
  it("negative-caches 404 and globally honors upstream 429 Retry-After", async () => {
    let calls = 0;
    const missing = new LDrawProvider(async () => { calls++; return new Response("", { status: 404 }); });
    await assert.rejects(missing.get("parts/missing.dat"), e => e.status === 404);
    await assert.rejects(missing.get("parts/missing.dat"), e => e.status === 404);
    assert.equal(calls, 1);
    const limited = new LDrawProvider(async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    await assert.rejects(limited.get("parts/first.dat"), e => e.status === 429 && e.retryAfter === 120);
    await assert.rejects(limited.get("parts/second.dat"), e => e.status === 429 && e.retryAfter > 100);
  });
  it("rejects malformed, unlicensed, oversized files and timeouts", async () => {
    for (const response of [
      () => new Response("<html>not a part</html>"),
      () => new Response(valid.replace("CC BY 4.0", "CC BY 2.0")),
      () => new Response(valid, { headers: { "Content-Length": "99999999" } }),
      () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
    ]) await assert.rejects(new LDrawProvider(async () => response()).get("parts/a.dat"), e => e.status === 502);
    await assert.rejects(new LDrawProvider(async () => { throw new DOMException("Timeout", "TimeoutError"); }).get("parts/a.dat"), e => e.status === 502);
  });
  it("bounds global upstream concurrency", async () => {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const provider = new LDrawProvider(async () => { await gate; return new Response(valid); });
    const pending = Array.from({ length: 4 }, (_, i) => provider.get(`parts/a${i}.dat`));
    await assert.rejects(provider.get("parts/excess.dat"), e => e.status === 429);
    finish(); await Promise.all(pending);
  });
  it("reads only hashed approved archive files; changed bytes and absent paths fail without network fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "ldraw-provider-"));
    try {
      await mkdir(join(root, "parts"));
      await writeFile(join(root, "parts/a.dat"), valid);
      await writeFile(join(root, "manifest.json"), JSON.stringify({
        version: 1, sha256: "a".repeat(64), files: { "parts/a.dat": sha(valid) },
      }));
      const provider = new LDrawProvider(async () => { throw new Error("No network allowed"); }, root);
      assert.equal((await provider.get("parts/a.dat")).hash, sha(valid));
      await assert.rejects(provider.get("parts/missing.dat"), e => e.status === 404);
      await writeFile(join(root, "parts/a.dat"), valid + "changed");
      await assert.rejects(new LDrawProvider(fetch, root).get("parts/a.dat"), e => e.status === 502);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
