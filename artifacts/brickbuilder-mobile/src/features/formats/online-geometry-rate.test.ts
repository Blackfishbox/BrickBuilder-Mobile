import { afterEach, expect, it, vi } from "vitest";
import { OnlineGeometry } from "./online-geometry";
afterEach(() => vi.unstubAllGlobals());
it("honors 429 Retry-After even for explicit retries", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "60" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(new OnlineGeometry({}).get("parts/rate-fixture.dat")).rejects.toThrow(/429/);
  await expect(new OnlineGeometry({ retry: true }).get("parts/rate-fixture.dat")).rejects.toThrow(/429/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
