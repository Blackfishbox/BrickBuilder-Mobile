import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "io.github.blackfishbox.brickbuilder",
  appName: "BrickBuilder Mobile",
  webDir: "dist/public",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  plugins: { SystemBars: { insetsHandling: "native" } },
};
export default config;
