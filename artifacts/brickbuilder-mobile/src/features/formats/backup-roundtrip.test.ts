import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { builderDatabase } from "@/storage/database";
import { exportModel, importModelFile, validateImportFile } from "./adapters";

afterEach(async () => { await builderDatabase.delete(); });

describe("full-project backup size expansion", () => {
  it("restores a supported upload whose complete JSON backup exceeds 32 MiB", async () => {
    await builderDatabase.open();
    // A large LDraw comment and a tiny local part avoid network dependencies.
    // Original bytes, decoded source and source sections all belong in the backup.
    await builderDatabase.libraryFiles.add({
      id: "fixture:parts/backup.dat", packageId: "fixture", path: "parts/backup.dat",
      sourceUrl: "https://library.ldraw.org/library/official/parts/backup.dat",
      author: "Fixture author", license: "CC-BY-4.0",
      content: "0 Backup fixture\n3 16 0 0 0 20 0 0 0 20 0\n",
    });
    const text = `0 ${"a".repeat(8 * 1024 * 1024)}\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 backup.dat\n`;
    const upload = new File([text], "large-original.ldr");
    expect(upload.size).toBeLessThan(32 * 1024 * 1024);
    const original = await importModelFile(upload, { online: false });
    const backup = await exportModel(original, "json");
    expect(backup.bytes.byteLength).toBeGreaterThan(32 * 1024 * 1024);
    const backupFile = new File([backup.bytes as BlobPart], backup.filename);
    // This same preflight is used by the file-picker UI.
    expect(() => validateImportFile(backupFile)).not.toThrow();
    const restored = await importModelFile(backupFile, { online: false });
    expect(restored.id).not.toBe(original.id);
    expect(restored.imported!.sourceText).toBe(text);
    expect(restored.imported!.originalBytes.length).toBe(upload.size);
    // Hash equality checks every byte without a multi-million-element matcher
    // allocating its own traversal state.
    const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    expect(digest(new Uint8Array(restored.imported!.originalBytes)))
      .toBe(digest(new Uint8Array(await upload.arrayBuffer())));
    expect(restored.imported!.sections).toEqual(original.imported!.sections);
    expect(Object.keys(restored.imported!.resources)).toEqual(Object.keys(original.imported!.resources));
    for (const [path, resource] of Object.entries(original.imported!.resources)) {
      // Library row identifiers are not part of portable project resources.
      const { path: sourcePath, author, license, content, sourceUrl } = resource;
      expect(restored.imported!.resources[path]).toEqual({ path: sourcePath, author, license, content, sourceUrl });
    }
    expect(restored.imported!.legalDocuments).toEqual(original.imported!.legalDocuments);
  }, 30000);

  it("retains the 32 MiB transport limit for source formats and rejects unsupported files", () => {
    const size = 32 * 1024 * 1024 + 1;
    for (const extension of ["io", "ldr", "mpd"]) {
      expect(() => validateImportFile({ name: `source.${extension}`, size })).toThrow("32 MiB");
    }
    expect(() => validateImportFile({ name: "backup.JSON", size })).not.toThrow();
    expect(() => validateImportFile({ name: "backup.exe", size: 1 })).toThrow("Unterstützte");
  });
});
