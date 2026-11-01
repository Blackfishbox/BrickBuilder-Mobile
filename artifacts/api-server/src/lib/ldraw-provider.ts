import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { inspectFile, LEGAL_PATHS, normalizePath, sourceUrl } from "@workspace/ldraw-source";

export class ProviderError extends Error {
  constructor(public status: number, message: string, public retryAfter = 60) { super(message); }
}
type Entry = { bytes: Uint8Array; hash: string; snapshot: string };
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Shared single-flight provider. Client cancellation never cancels another client's request. */
export class LDrawProvider {
  private cache = new Map<string, Entry>();
  private negatives = new Map<string, { until: number; error: ProviderError }>();
  private pending = new Map<string, Promise<Entry>>();
  private active = 0;
  private cacheBytes = 0;
  private cooldown = 0;
  private liveRequests: number[] = [];
  private archive?: Promise<{ root: string; snapshot: string; files: Record<string, string> }>;
  constructor(private fetcher: typeof fetch = fetch, private archivePath?: string) {}

  get(raw: string): Promise<Entry> {
    const path = normalizePath(raw);
    const cached = this.cache.get(path);
    if (cached) return Promise.resolve(cached);
    const negative = this.negatives.get(path);
    if (negative && negative.until > Date.now()) return Promise.reject(negative.error);
    const inflight = this.pending.get(path);
    if (inflight) return inflight;
    if (this.active >= 4) return Promise.reject(new ProviderError(429, "Resolver ausgelastet.", 2));
    if (this.negatives.size > 2000) this.negatives.clear();
    this.active++;
    const request = this.load(path).then(entry => {
      while (this.cacheBytes + entry.bytes.length > 32 * 1024 * 1024 && this.cache.size) {
        const first = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(first)!.bytes.length; this.cache.delete(first);
      }
      this.cache.set(path, entry); this.cacheBytes += entry.bytes.length;
      return entry;
    }).catch(error => {
      const failure = error instanceof ProviderError ? error : new ProviderError(502, "Quelle nicht verfügbar oder ungültig.");
      this.negatives.set(path, { until: Date.now() + failure.retryAfter * 1000, error: failure });
      throw failure;
    }).finally(() => { this.active--; this.pending.delete(path); });
    this.pending.set(path, request);
    return request;
  }

  private async load(path: string): Promise<Entry> {
    if (this.archivePath) {
      this.archive ??= (async () => {
        const root = await realpath(this.archivePath!);
        const manifestPath = resolve(root, "manifest.json");
        if ((await stat(manifestPath)).size > 12 * 1024 * 1024) throw new Error("Archive manifest too large");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        if (manifest.version !== 1 || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
            !manifest.files || typeof manifest.files !== "object") throw new Error("Invalid approved archive");
        return { root, snapshot: `official-archive-sha256:${manifest.sha256}`, files: manifest.files };
      })();
      const archive = await this.archive;
      const hash = archive.files[path];
      if (!hash) throw new ProviderError(404, "Datei fehlt im freigegebenen Archiv.", 3600);
      const location = await realpath(resolve(archive.root, path));
      if (!location.startsWith(archive.root + sep) || (await stat(location)).size > 2 * 1024 * 1024) throw new Error("Unsafe archive file");
      const bytes = await readFile(location);
      if (sha(bytes) !== hash) throw new Error("Approved archive file changed");
      this.validate(path, bytes);
      return { bytes, hash, snapshot: archive.snapshot };
    }
    // Never turn a large model into thousands of upstream requests.
    const now = Date.now();
    this.liveRequests = this.liveRequests.filter(at => at > now - 3600_000);
    if (this.cooldown > now) throw new ProviderError(429, "LDraw-Quelle gedrosselt.", Math.ceil((this.cooldown - now) / 1000));
    if (this.liveRequests.length >= 120) throw new ProviderError(429, "Live-Budget erreicht; freigegebenes Archiv benötigt.", 3600);
    this.liveRequests.push(now);
    const response = await this.fetcher(sourceUrl(path), {
      signal: AbortSignal.timeout(12_000), redirect: "error",
      headers: { Accept: "text/plain", "User-Agent": "BrickBuilder-LDraw-Resolver/1.0" },
    });
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const seconds = retry ? (/^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry) - now) / 1000)) : 60;
      const delay = Number.isFinite(seconds) ? Math.min(86400, Math.max(1, seconds)) : 60;
      if (response.status === 429) this.cooldown = now + delay * 1000;
      await response.body?.cancel();
      throw new ProviderError(response.status === 404 ? 404 : response.status === 429 ? 429 : 502,
        `LDraw-Quelle: HTTP ${response.status}.`, response.status === 404 ? 600 : delay);
    }
    if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
      await response.body?.cancel(); throw new Error("Upstream too large");
    }
    const chunks: Uint8Array[] = []; let length = 0;
    const reader = response.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) throw new Error("Upstream too large");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    this.validate(path, bytes);
    return { bytes, hash: sha(bytes), snapshot: "official-live-v1" };
  }
  private validate(path: string, bytes: Uint8Array) {
    if ((LEGAL_PATHS as readonly string[]).includes(path)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (text.length < 200 || /<html/i.test(text) ||
          !/Creative Commons|LDRAW.ORG PARTS LIBRARY AGREEMENT/i.test(text)) throw new Error("Invalid legal text");
    } else inspectFile(path, bytes);
  }
}
