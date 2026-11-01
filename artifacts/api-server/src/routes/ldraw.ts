import { Router } from "express";
import { LDrawProvider, ProviderError } from "../lib/ldraw-provider";
import { normalizePath } from "@workspace/ldraw-source";

const router = Router();
const provider = new LDrawProvider(fetch, process.env.LDRAW_APPROVED_DIR);
router.get("/ldraw/file", async (req, res) => {
  // No cross-origin browser access, even when the general API enables CORS.
  res.removeHeader("Access-Control-Allow-Origin");
  if (req.get("sec-fetch-site") === "cross-site") {
    res.status(403).json({ error: "Nur gleichursprünglicher Zugriff erlaubt." }); return;
  }
  let path: string;
  try {
    if (typeof req.query.path !== "string") throw new Error();
    path = normalizePath(req.query.path);
  } catch { res.status(400).json({ error: "Nicht freigegebener LDraw-Pfad." }); return; }
  try {
    const entry = await provider.get(path);
    if (res.destroyed) return;
    res.set({
      "Content-Type": "application/octet-stream",
      "Content-Length": String(entry.bytes.length),
      "Cache-Control": "no-transform, private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-LDraw-SHA256": entry.hash,
      "X-LDraw-Snapshot": entry.snapshot,
    }).send(Buffer.from(entry.bytes));
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError(502, "Resolver nicht verfügbar.");
    if (!res.destroyed) res.status(failure.status).set("Retry-After", String(failure.retryAfter)).json({ error: failure.message });
  }
});
export default router;
