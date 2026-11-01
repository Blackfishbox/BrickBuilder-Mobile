import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const app = resolve(root, "artifacts/brickbuilder-mobile");
const manifest = JSON.parse(await readFile(resolve(app, "src/features/catalog/manifest.json"), "utf8"));
const source = process.env.ANDROID_CATALOG_PATH;
if (!source) throw new Error("Set ANDROID_CATALOG_PATH to the reviewed catalog.bin. See docs/android-google-play.md; the app must not require an API server.");
const bytes = await readFile(resolve(source));
if (bytes.length !== manifest.bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
  throw new Error("Offline catalog integrity mismatch. Only the reviewed catalog snapshot is accepted.");
}
function run(command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: app, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run("pnpm", ["exec", "vite", "build"], { PORT: "23048", BASE_PATH: "/", VITE_NATIVE_ANDROID: "true", NODE_ENV: "production" });
const output = resolve(app, "dist/public", manifest.url);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
// Native updates ship the complete local bundle. Never keep a PWA worker in it.
await rm(resolve(app, "dist/public/sw.js"), { force: true });
run("pnpm", ["exec", "cap", "sync", "android"]);
console.log("Android assets synchronized with verified local catalog; no remote server URL.");
