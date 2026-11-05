// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import PrivacyDialog from "./PrivacyDialog";

it("opens the bundled policy without leaving the editor and allows closing", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host), onClose = vi.fn();
  try {
    act(() => root.render(<PrivacyDialog onClose={onClose} />));
    const dialog = document.querySelector("[role='dialog']")!;
    expect(dialog.textContent).toContain("Android-Fassung");
    expect(dialog.querySelector("iframe")?.getAttribute("src")).toBe(`${import.meta.env.BASE_URL}privacy.html`);
    act(() => dialog.querySelector<HTMLButtonElement>("button")!.click());
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
