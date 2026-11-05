// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import FinePositionControls from "./FinePositionControls";

it("exposes six touch adjustments of exactly one LDU in world coordinates", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container), onNudge = vi.fn();
  try {
    await act(async () => root.render(<FinePositionControls onNudge={onNudge} />));
    expect(container.querySelector("summary")?.getAttribute("aria-label")).toBe("Feinjustierung öffnen");
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(6);
    await act(async () => { buttons.forEach(button => button.click()); });
    expect(onNudge.mock.calls.map(([delta]) => delta)).toEqual([
      { x: -0.05, y: 0, z: 0 }, { x: 0.05, y: 0, z: 0 },
      { x: 0, y: 0, z: -0.05 }, { x: 0, y: 0, z: 0.05 },
      { x: 0, y: 0.05, z: 0 }, { x: 0, y: -0.05, z: 0 },
    ]);
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
