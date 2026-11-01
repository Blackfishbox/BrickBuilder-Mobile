import { useSyncExternalStore } from "react";
import { builderDatabase } from "@/storage/database";
import manifest from "./manifest.json";
import type { Inventory, InventoryPreview } from "../inventory/types";
import { MAX_LIST_BYTES } from "../inventory/types";
import { getCatalogState, subscribeCatalog, updateCatalogState as update } from "./state";
export { getCatalogState, installCatalogIndex } from "./state";
export { default as catalogManifest } from "./manifest.json";
export type CatalogSearchResult = { id: string; name: string; mappings: string[][] };
export function useCatalog() {
  return useSyncExternalStore(subscribeCatalog, getCatalogState, getCatalogState);
}
let worker: Worker | undefined;
let sequence = 0;
const waiting = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
function request(message: Record<string, unknown>): Promise<any> {
  if (!worker) {
    worker = new Worker(new URL("./catalog.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = event => {
      const task = waiting.get(event.data.id);
      if (!task) return;
      clearTimeout(task.timer); waiting.delete(event.data.id);
      event.data.error ? task.reject(new Error(event.data.error)) : task.resolve(event.data);
    };
    worker.onerror = () => {
      for (const task of waiting.values()) { clearTimeout(task.timer); task.reject(new Error("Katalog-Hintergrundverarbeitung fehlgeschlagen.")); }
      waiting.clear(); worker?.terminate(); worker = undefined;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error("Zeitlimit beim Katalogzugriff.")); }, 45000);
    waiting.set(id, { resolve, reject, timer });
    worker!.postMessage({ id, ...message });
  });
}
let pending: Promise<void> | undefined;
export function ensureCatalog(): Promise<void> {
  if (getCatalogState().status === "ready") return Promise.resolve();
  if (pending) return pending;
  update({ status: "loading" });
  pending = (async () => {
    const stored = await builderDatabase.catalogSnapshots.get(manifest.sha256);
    let bytes = stored?.bytes;
    if (!bytes) {
      const response = await fetch(`${import.meta.env.BASE_URL}${manifest.url}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Katalogdownload: HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    }
    if (bytes.length !== manifest.bytes) {
      if (stored) await builderDatabase.catalogSnapshots.delete(manifest.sha256);
      throw new Error("Kataloggröße stimmt nicht. Bitte den Download erneut starten.");
    }
    let loaded;
    try { loaded = await request({ type: "load", bytes, sha256: manifest.sha256 }); }
    catch (error) {
      if (stored) await builderDatabase.catalogSnapshots.delete(manifest.sha256);
      throw error;
    }
    if (!stored) {
      try { await builderDatabase.catalogSnapshots.put({ id: manifest.sha256, bytes }); }
      catch { throw new Error("Katalog konnte nicht offline gespeichert werden. Bitte freien Browser-Speicher prüfen."); }
    }
    update({ status: "ready", index: loaded.index });
  })().catch(error => {
    update({ status: "error", error: error instanceof Error ? error.message : String(error) });
    throw error;
  }).finally(() => { pending = undefined; });
  return pending;
}
export async function searchFullCatalog(query: string, kind: "parts" | "colors"): Promise<CatalogSearchResult[]> {
  await ensureCatalog();
  return (await request({ type: "search", query, kind })).results;
}
export async function previewInventory(file: File): Promise<InventoryPreview> {
  if (file.size > MAX_LIST_BYTES) throw new Error("Teileliste ist größer als 2 MiB.");
  await ensureCatalog();
  const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
  return (await request({ type: "inventory", text, name: file.name })).preview;
}
export async function resolveStoredInventory(inventory: Inventory): Promise<InventoryPreview> {
  await ensureCatalog();
  return (await request({ type: "inventory", inventory })).preview;
}
