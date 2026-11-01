import { createHash } from "node:crypto";
import { Router } from "express";
import manifest from "../lib/catalog-manifest.json";
import { approvedSnapshot } from "../lib/ldraw-snapshot";
import { ldrawStorage } from "../lib/ldraw-storage";

const router = Router();
let cached: Promise<Buffer> | undefined;
router.get("/catalog/snapshot/:sha256", async (req, res) => {
  if (req.params.sha256 !== manifest.sha256) { res.status(404).end(); return; }
  try {
    cached ??= ldrawStorage.bucket(approvedSnapshot.bucket).file(manifest.object).download().then(([bytes]) => {
      if (bytes.length !== manifest.bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.sha256) {
        throw new Error("Catalog snapshot integrity check failed");
      }
      return bytes;
    }).catch(error => { cached = undefined; throw error; });
    const bytes = await cached;
    res.set({ "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable, no-transform", "X-Content-Type-Options": "nosniff" });
    res.send(bytes);
  } catch (error) {
    req.log.error({ err: error }, "Approved catalog snapshot unavailable");
    res.status(503).json({ error: "Katalog-Snapshot ist derzeit nicht verfügbar." });
  }
});
export default router;
