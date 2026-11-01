// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { exportFile } from "./export-file";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  Filesystem: { writeFile: vi.fn(), appendFile: vi.fn(), getUri: vi.fn().mockResolvedValue({ uri: "file:///cache/project.json" }) },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn().mockResolvedValue({}) } }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("local Android exports", () => {
  it("writes exact chunked bytes and shares a local file without an external upload", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    const bytes = Uint8Array.from({ length: 600_001 }, (_, i) => i % 256);
    await exportFile(bytes, "model.io", "application/octet-stream");
    expect(Filesystem.writeFile).toHaveBeenCalledOnce();
    expect(Filesystem.appendFile).toHaveBeenCalledTimes(3);
    const calls = [vi.mocked(Filesystem.writeFile).mock.calls[0][0], ...vi.mocked(Filesystem.appendFile).mock.calls.map(c => c[0])];
    const decoded = calls.flatMap(c => [...Uint8Array.from(atob(c.data as string), ch => ch.charCodeAt(0))]);
    expect(Uint8Array.from(decoded)).toEqual(bytes);
    expect(calls.every(c => c.directory === "CACHE" && c.path.endsWith("/model.io"))).toBe(true);
    expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({ files: ["file:///cache/project.json"] }));
  });
  it("does not report success or share an incomplete file if writing fails", async () => {
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true);
    vi.mocked(Filesystem.writeFile).mockRejectedValueOnce(new Error("Storage full"));
    await expect(exportFile(new Uint8Array([1]), "../model.json", "application/json")).rejects.toThrow("Storage full");
    expect(Share.share).not.toHaveBeenCalled();
  });
});
