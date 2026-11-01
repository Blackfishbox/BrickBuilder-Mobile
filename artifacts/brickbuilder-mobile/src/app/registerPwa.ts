import { registerSW } from "virtual:pwa-register";

export function registerPwa(): void {
  if (import.meta.env.VITE_NATIVE_ANDROID === "true" || !("serviceWorker" in navigator)) return;
  registerSW({ immediate: true });
}
