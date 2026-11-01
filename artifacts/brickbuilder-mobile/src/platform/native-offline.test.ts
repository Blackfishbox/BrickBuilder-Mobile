import { afterEach, expect, it, vi } from "vitest";
import { findOnline, OnlineGeometry } from "../features/formats/online-geometry";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("never requests a hosted geometry API from the server-free Android build", async () => {
  vi.stubEnv("VITE_NATIVE_ANDROID", "true");
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  await expect(findOnline("unknown-native-part.dat", new OnlineGeometry({}))).rejects.toThrow("unknown-native-part.dat");
  expect(network).not.toHaveBeenCalled();
});
