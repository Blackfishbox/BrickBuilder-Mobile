import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { normalizePath } from "@workspace/ldraw-source";

export interface ArchiveBundle {
  bucket: string;
  object: string;
  sha256: string;
  archiveSha256: string;
}

function budget(max: number) {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > max ? new Error("LDraw snapshot size limit exceeded") : null, chunk);
    },
  });
}

// Unlike readline's event buffering, this iterator keeps disk writes backpressured.
async function* records(stream: Readable) {
  let pending = "";
  for await (const chunk of stream) {
    pending += chunk.toString("utf8");
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      if (newline > 17 * 1024 * 1024) throw new Error("LDraw snapshot record too large");
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      yield line;
    }
    if (pending.length > 17 * 1024 * 1024) throw new Error("LDraw snapshot record too large");
  }
  if (pending) throw new Error("Truncated LDraw snapshot record");
}

/** Restore only a deliberately pinned snapshot; never download from LDraw at startup. */
export async function restoreArchive(
  bundle: ArchiveBundle,
  download: () => Readable,
  cacheRoot = resolve("generated-artifacts/ldraw-runtime"),
): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(bundle.sha256) || !/^[a-f0-9]{64}$/.test(bundle.archiveSha256)) {
    throw new Error("Invalid pinned LDraw snapshot");
  }
  await mkdir(cacheRoot, { recursive: true });
  const target = resolve(cacheRoot, bundle.sha256);
  try {
    if (await readFile(resolve(target, ".complete"), "utf8") === bundle.sha256) return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const staging = await mkdtemp(resolve(cacheRoot, ".restore-"));
  const packed = resolve(staging, "bundle.gz");
  const output = resolve(staging, "files");
  try {
    const hash = createHash("sha256");
    const hashing = new Transform({
      transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); },
    });
    await pipeline(download(), budget(200 * 1024 * 1024), hashing, createWriteStream(packed),
      { signal: AbortSignal.timeout(120_000) });
    if (hash.digest("hex") !== bundle.sha256) throw new Error("LDraw snapshot bundle hash mismatch");
    await mkdir(output);
    const linesStream = new Transform({
      transform(chunk, _encoding, callback) { callback(null, chunk); },
    });
    const unpacking = pipeline(createReadStream(packed), createGunzip(), budget(1800 * 1024 * 1024), linesStream);
    // Observe stream failures immediately, including when a malformed record interrupts iteration.
    void unpacking.catch(() => {});
    const seen = new Set<string>();
    try {
      for await (const line of records(linesStream)) {
        if (line.length > 17 * 1024 * 1024 || seen.size >= 150_002) throw new Error("LDraw snapshot record limit exceeded");
        const record = JSON.parse(line);
        const path = record.path === "manifest.json" ? "manifest.json" : normalizePath(record.path);
        if (path !== record.path || seen.has(path) || typeof record.base64 !== "string") throw new Error("Invalid LDraw snapshot record");
        seen.add(path);
        const bytes = Buffer.from(record.base64, "base64");
        if (bytes.length > (path === "manifest.json" ? 12 : 2) * 1024 * 1024) throw new Error("LDraw snapshot file too large");
        const location = resolve(output, path);
        await mkdir(dirname(location), { recursive: true });
        await writeFile(location, bytes, { flag: "wx" });
      }
      await unpacking;
    } finally {
      linesStream.destroy();
      await unpacking.catch(() => {});
    }
    const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
    if (manifest.version !== 1 || manifest.sha256 !== bundle.archiveSha256 ||
        !manifest.files || typeof manifest.files !== "object") throw new Error("LDraw snapshot identity mismatch");
    const expected = new Set(["manifest.json", ...Object.keys(manifest.files)]);
    if (expected.size !== seen.size) throw new Error("Incomplete LDraw snapshot");
    for (const path of expected) {
      if (!seen.has(path)) throw new Error("Incomplete LDraw snapshot");
      if (path !== "manifest.json") {
        const bytes = await readFile(resolve(output, normalizePath(path)));
        if (createHash("sha256").update(bytes).digest("hex") !== manifest.files[path]) throw new Error("LDraw snapshot file hash mismatch");
      }
    }
    await writeFile(resolve(output, ".complete"), bundle.sha256);
    try { await rename(output, target); }
    catch (error) {
      // Another process may have restored the identical immutable snapshot.
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "") ||
          await readFile(resolve(target, ".complete"), "utf8") !== bundle.sha256) throw error;
    }
    return target;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
