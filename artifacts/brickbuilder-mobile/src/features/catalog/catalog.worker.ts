import { decodeCatalog, indexCatalog, searchCatalog, type CatalogData } from "./data";
import { parseInventory } from "../inventory/import";
import { resolveInventory } from "./inventory-resolution";
let data: CatalogData | undefined;
self.onmessage = async (event: MessageEvent) => {
  const { id, type, bytes, sha256, query, kind } = event.data;
  try {
    if (type === "load") {
      const raw = new Uint8Array(bytes);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)), b => b.toString(16).padStart(2, "0")).join("");
      if (digest !== sha256) throw new Error("Katalog-Prüfsumme stimmt nicht.");
      const next = decodeCatalog(raw);
      const index = indexCatalog(next);
      data = next;
      self.postMessage({ id, index, attribution: data.attribution });
    } else {
      if (!data) throw new Error("Katalog noch nicht geladen.");
      if (type === "inventory") {
        const inventory = event.data.inventory ?? parseInventory(event.data.text, event.data.name);
        self.postMessage({ id, preview: resolveInventory(data, inventory) });
      } else self.postMessage({ id, results: searchCatalog(data, query, kind) });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }); }
};
