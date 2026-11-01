import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { builderDatabase } from "@/storage/database";
import { importLDraw } from "./ldraw/import";
import manifest from "./geometry-manifest.json";

beforeEach(async () => { await builderDatabase.open(); });
afterEach(async () => { vi.unstubAllGlobals(); await builderDatabase.delete(); });
describe.skipIf(!process.env.BRICKBUILDER_LIVE_GEOMETRY_URL)("live geometry acquisition", () => {
  it("resolves 3004 through the actual preview transport", async () => {
    const request = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      request(new URL(String(input), process.env.BRICKBUILDER_LIVE_GEOMETRY_URL), init));
    const bytes = new TextEncoder().encode("0 Placement\n1 7 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat\n");
    const document = await importLDraw(bytes, "placement.ldr");
    expect(document.imported!.instances[0].part.status, JSON.stringify(document.imported!.issues)).toBe("resolved");
  }, 60000);
  it("loads the real 3004 closure from the approved API when the bundle is unavailable, then works offline", async () => {
    const request = globalThis.fetch;
    const paths: string[] = [];
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes(manifest.url)) return Promise.resolve(new Response("", { status: 404 }));
      paths.push(String(input));
      return request(new URL(String(input), process.env.BRICKBUILDER_LIVE_GEOMETRY_URL), init);
    });
    const bytes = new TextEncoder().encode("0 Placement\n1 7 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat\n");
    const document = await importLDraw(bytes, "placement.ldr");
    expect(document.imported!.instances[0].part.status, JSON.stringify(document.imported!.issues)).toBe("resolved");
    expect(paths.some(path => path.includes("parts%2F3004.dat"))).toBe(true);
    expect(Object.keys(document.imported!.resources).length).toBeGreaterThan(1);
    const offline = vi.fn().mockRejectedValue(new TypeError("Offline"));
    vi.stubGlobal("fetch", offline);
    const restored = await importLDraw(bytes, "placement.ldr");
    expect(restored.imported!.instances[0].part.status).toBe("resolved");
    expect(offline).not.toHaveBeenCalled();
  }, 60000);
});
