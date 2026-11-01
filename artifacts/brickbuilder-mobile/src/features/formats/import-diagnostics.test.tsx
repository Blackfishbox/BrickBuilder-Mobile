import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { importDiagnostics, isImportWarning } from "./import-diagnostics";
import { resolveColor } from "./colors";
import { refreshModelColors } from "./model-colors";
import { parseLDraw } from "./ldraw/parser";
import { readZip } from "./zip";
import { Report } from "./FormatDialog";
import type { ImportedModel } from "./types";

function modelFor(text: string): ImportedModel {
  return {
    version: 1, format: "io", sourceName: "diagnostic.io",
    sourceText: text, originalBytes: Array.from(new TextEncoder().encode(text)),
    ...parseLDraw(text), resources: {}, legalDocuments: [],
  };
}

describe("catalog information versus real import warnings", () => {
  it.each([
    ["288", 80, "Dark Green", "#00451A"],
    ["297", 115, "Pearl Gold", "#AA7F2E"],
    ["8", 10, "Dark Gray", "#545955"],
  ])("uses verified BrickLink evidence for ordinary LDraw color %s", (code, id, name, hex) => {
    expect(resolveColor(code)).toMatchObject({ brickLinkId: id, brickLinkName: name, hex, alpha: 255 });
  });
  it("keeps missing geometry, unknown colors and conflicting catalog evidence visible", () => {
    for (const code of ["missing-part", "geometry-invalid", "geometry-color", "missing-color", "ambiguous-bl-part", "unexpected-code"]) {
      expect(isImportWarning({ code, message: "Diagnostic" })).toBe(true);
    }
    for (const code of ["missing-bl-part", "missing-bl-color", "io-scope"]) {
      expect(isImportWarning({ code, message: "Information" })).toBe(false);
    }
  });
  it("presents scope and catalog gaps without a false warning banner", () => {
    const model = modelFor("0 Synthetic diagnostic fixture\n1 4 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat");
    model.instances[0].part.status = "resolved";
    model.issues = [
      { code: "missing-bl-part", count: 12, message: "Catalog evidence not yet available" },
      { code: "io-scope", message: "Supported IO scope" },
    ];
    const html = renderToStaticMarkup(<Report model={model} bricks={0} />);
    expect(html).toContain("Katalog- und Formatinformationen");
    expect(html).not.toContain('class="fmt-warn"');
    expect(html).not.toContain("12×");
    model.issues.push({ code: "missing-part", reference: "unavailable.dat", message: "Geometrie fehlt" });
    const warned = renderToStaticMarkup(<Report model={model} bricks={0} />);
    expect(warned).toContain('class="fmt-warn"');
    expect(warned).toContain("1 Importwarnungen");
    expect(warned).toContain("Geometrie fehlt");
  });
  it("repairs stale catalog color warnings without changing original source data", () => {
    const model = modelFor(["288", "297", "8", "1009007"].map(code => `1 ${code} 0 0 0 1 0 0 0 1 0 0 0 1 3004.dat`).join("\n"));
    model.issues.push({ code: "missing-bl-color", reference: "288", message: "Old warning" });
    const before = JSON.stringify([model.sourceText, model.originalBytes, model.instances.map(i => [i.colorCode, i.matrix])]);
    refreshModelColors(model);
    expect(model.issues.filter(issue => issue.code === "missing-bl-color")).toHaveLength(0);
    expect(importDiagnostics(model).warnings).toMatchObject([{ code: "missing-color", reference: "1009007" }]);
    expect(JSON.stringify([model.sourceText, model.originalBytes, model.instances.map(i => [i.colorCode, i.matrix])])).toBe(before);
  });
  const privateFile = new URL("../../../../../attached_assets/Schild_(1)_1793518004611.io", import.meta.url);
  it.skipIf(!existsSync(privateFile))("checks the supplied Studio shield source without committing the private upload", () => {
    const entries = readZip(new Uint8Array(readFileSync(privateFile)), { names: ["model.ldr"], studioEncryption: true });
    const model = modelFor(new TextDecoder().decode(entries["model.ldr"]));
    expect(model.instances).toHaveLength(57);
    expect(new Set(model.instances.map(i => i.colorCode))).toEqual(new Set(["15", "288", "297", "8"]));
    refreshModelColors(model);
    expect(model.issues.some(issue => ["missing-color", "missing-bl-color"].includes(issue.code))).toBe(false);
    expect(model.instances.every(instance => instance.color?.brickLinkId !== undefined)).toBe(true);
  });
});
