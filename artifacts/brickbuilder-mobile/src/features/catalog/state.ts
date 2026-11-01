import type { CatalogIndex } from "./data";
export type CatalogState = { status: "idle" | "loading" | "ready" | "error"; error?: string; index?: CatalogIndex };
let state: CatalogState = { status: "idle" };
const listeners = new Set<() => void>();
export const getCatalogState = () => state;
export const subscribeCatalog = (listener: () => void) => {
  listeners.add(listener); return () => { listeners.delete(listener); };
};
export function updateCatalogState(next: CatalogState) {
  state = next; listeners.forEach(listener => listener());
}
/** Test seam; production installs only an integrity-checked worker result. */
export function installCatalogIndex(index?: CatalogIndex) {
  updateCatalogState(index ? { status: "ready", index } : { status: "idle" });
}
