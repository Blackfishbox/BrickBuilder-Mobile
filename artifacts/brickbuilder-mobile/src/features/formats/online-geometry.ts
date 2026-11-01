import { candidates, inspectFile, LEGAL_PATHS, normalizePath, sourceUrl } from "@workspace/ldraw-source";
import type { LibraryFile, PackagePayload } from "../parts/types";

export interface GeometryProgress { files: number; bytes: number; roots: number; total: number; reference?: string }
export interface ResolveOptions {
  signal?: AbortSignal;
  onProgress?(progress: GeometryProgress): void;
  online?: boolean;
  retry?: boolean;
}
export const hashBytes = async (bytes: Uint8Array) => Array.from(new Uint8Array(
  await crypto.subtle.digest("SHA-256", bytes as BufferSource)), b => b.toString(16).padStart(2, "0")).join("");

class DownloadError extends Error {
  constructor(message: string, public status: number, public until = 0) { super(message); }
}
const negative = new Map<string, DownloadError>();
const inflight = new Map<string, Promise<{ bytes: Uint8Array; snapshot: string }>>();
let active = 0;
const queue: (() => void)[] = [];
let blockedUntil = 0;
const abortError = () => new DOMException("Nachladen abgebrochen.", "AbortError");
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
function retryDelay(value: string | null) {
  const seconds = value && /^\d+$/.test(value) ? Number(value) : value ? (Date.parse(value) - Date.now()) / 1000 : 2;
  return Math.max(1000, Math.min(86400_000, Number.isFinite(seconds) ? seconds * 1000 : 2000));
}
/** Same-origin API artifact path; never infer a geometry ID from a catalog ID. */
async function transport(path: string) {
  normalizePath(path);
  if (import.meta.env.VITE_NATIVE_ANDROID === "true") {
    throw new DownloadError(`LDraw ${path}: nicht im lokalen Android-Teilepaket vorhanden. Es wird kein externer Modellserver verwendet.`, 404);
  }
  const cachedError = negative.get(path);
  if (cachedError && cachedError.until > Date.now()) throw cachedError;
  const shared = inflight.get(path);
  if (shared) return shared;
  const request = (async () => {
    if (active >= 2) await new Promise<void>(resolve => queue.push(resolve));
    active++;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (blockedUntil > Date.now()) throw new DownloadError("Quelle gedrosselt. Später erneut versuchen.", 429, blockedUntil);
        const response = await fetch(`/api/ldraw/file?path=${encodeURIComponent(path)}`, {
          signal: AbortSignal.timeout(15_000), headers: { Accept: "application/octet-stream" },
        });
        if (!response.ok) {
          const delay = retryDelay(response.headers.get("retry-after"));
          if (response.status === 429) blockedUntil = Date.now() + delay;
          await response.body?.cancel();
          if (attempt === 0 && (response.status === 502 || (response.status === 429 && delay <= 2000))) {
            await new Promise(resolve => setTimeout(resolve, delay)); continue;
          }
          throw new DownloadError(`Geometriequelle: HTTP ${response.status}${response.status === 429 ? " – gedrosselt; später erneut versuchen" : ""}.`,
            response.status, Date.now() + (response.status === 404 ? 600_000 : delay));
        }
        if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
          await response.body?.cancel(); throw new Error("Quelldatei überschreitet 2 MiB.");
        }
        const chunks: Uint8Array[] = []; let length = 0;
        const reader = response.body!.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            length += value.length;
            if (length > 2 * 1024 * 1024) throw new Error("Quelldatei überschreitet 2 MiB.");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        if (bytes.length > 2 * 1024 * 1024 || !bytes.length ||
            response.headers.get("x-ldraw-sha256") !== await hashBytes(bytes)) throw new Error("Quellbytes: Prüfsumme fehlt oder stimmt nicht.");
        const snapshot = response.headers.get("x-ldraw-snapshot");
        if (!snapshot || !/^official-(?:live-v1|archive-sha256:[a-f0-9]{64})$/.test(snapshot)) throw new Error("Quellherkunft fehlt.");
        return { bytes, snapshot };
      }
      throw new Error("Download fehlgeschlagen.");
    } finally { active--; queue.shift()?.(); }
  })().catch(error => {
    const failure = error instanceof DownloadError ? error : new DownloadError(
      error instanceof Error ? error.message : "Geometriequelle nicht verfügbar.", 502, Date.now() + 30_000);
    if (negative.size > 3000) negative.clear();
    negative.set(path, failure); throw failure;
  }).finally(() => inflight.delete(path));
  inflight.set(path, request);
  return request;
}

export class OnlineGeometry {
  private pending = new Map<string, Promise<LibraryFile>>();
  private legal?: Promise<PackagePayload["legalDocuments"]>;
  files = 0;
  bytes = 0;
  stopped?: string;
  constructor(private options: ResolveOptions) {
    if (options.retry) {
      // User retries may clear ordinary failures, but must respect upstream cooldowns.
      for (const [path, error] of negative) if (error.status !== 429 || error.until <= Date.now()) negative.delete(path);
    }
  }
  async get(path: string): Promise<LibraryFile> {
    this.options.signal?.throwIfAborted();
    if (this.stopped) throw new Error(this.stopped);
    let request = this.pending.get(path);
    if (!request) {
      if (this.pending.size >= 3000) throw new Error("Dateibudget erreicht; kleineres Modell oder geprüftes Paket verwenden.");
      request = (async () => {
        const result = await abortable(transport(path), this.options.signal);
        this.bytes += result.bytes.length; this.files++;
        if (this.bytes > 32 * 1024 * 1024) {
          this.stopped = "Downloadbudget von 32 MiB erreicht.";
          throw new Error(this.stopped);
        }
        const file = inspectFile(path, result.bytes);
        await this.documents();
        return { ...file, sha256: await hashBytes(result.bytes), byteLength: result.bytes.length,
          retrievedAt: new Date().toISOString(), retrievalSource: result.snapshot };
      })().catch(error => {
        if (error instanceof DownloadError && (error.status === 429 || error.status === 502)) this.stopped = error.message;
        throw error;
      });
      this.pending.set(path, request);
    }
    return request;
  }
  documents() {
    this.legal ??= Promise.all(LEGAL_PATHS.map(async name => {
      const { bytes, snapshot } = await abortable(transport(name), this.options.signal);
      const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (content.length < 200 || /<html/i.test(content) || !/Creative Commons|LDRAW.ORG PARTS LIBRARY AGREEMENT/i.test(content)) {
        throw new Error("Erforderlicher Rechtstext ungültig.");
      }
      return { name, sourceUrl: sourceUrl(name), content, sha256: await hashBytes(bytes),
        byteLength: bytes.length, retrievedAt: new Date().toISOString(), retrievalSource: snapshot };
    }));
    return this.legal;
  }
}
export async function findOnline(reference: string, provider: OnlineGeometry) {
  for (const path of candidates(reference)) {
    try { return await provider.get(path); }
    catch (error) { if (!(error instanceof DownloadError) || error.status !== 404) throw error; }
  }
  throw new Error(`LDraw-Datei nicht verfügbar: ${reference}`);
}
