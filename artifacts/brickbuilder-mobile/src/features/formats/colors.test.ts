import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Color, DirectionalLight, HemisphereLight, InstancedMesh, MeshLambertMaterial, SRGBColorSpace } from "three";
import { COLORS, resolveColor } from "./colors";
import { LDRAW_COLOR_SNAPSHOT } from "./ldraw-palette";
import { refreshModelColors } from "./model-colors";
import { parseLDraw } from "./ldraw/parser";
import { readZip } from "./zip";
import type { ImportedModel } from "./types";
import type { LibraryFile } from "../parts/types";
import { normalizeDocument } from "../editor/model";
import { createImportedGroup } from "../engine/ldraw-geometry";
import { createBuilderLighting } from "../engine/lighting";
import { exportInternal, importInternal } from "./internal/adapter";

const line = (code: string, reference = "swatch.dat") => `1 ${code} 0 0 0 1 0 0 0 1 0 0 0 1 ${reference}`;
function modelFor(text: string): ImportedModel {
  return {
    version: 1, format: "mpd", sourceName: "synthetic.mpd",
    originalBytes: Array.from(new TextEncoder().encode(text)), sourceText: text,
    ...parseLDraw(text), resources: {}, legalDocuments: [],
  };
}
const file = (path: string, content: string): LibraryFile => ({
  path, content, author: "BrickBuilder synthetic fixture", license: "CC0-1.0",
  sourceUrl: `https://example.invalid/${path}`,
});

describe("offline LDraw import colors", () => {
  it("contains the complete reviewed appearance table without interpreting control codes as colors", () => {
    expect(COLORS).toHaveLength(320);
    expect(new Set(COLORS.map(color => color.ldrawCode)).size).toBe(320);
    for (const color of COLORS) {
      expect(color.hex).toMatch(/^#[0-9A-F]{6}$/);
      expect(color.alpha).toBeGreaterThanOrEqual(0);
      expect(color.alpha).toBeLessThanOrEqual(255);
      expect(color.source).toContain(LDRAW_COLOR_SNAPSHOT.sourceSha256);
    }
    expect(resolveColor("16")).toBeUndefined();
    expect(resolveColor("24")).toBeUndefined();
  });
  it.each([
    ["14", "#FAC80A"], ["2", "#00852B"], ["71", "#969696"],
    ["320", "#720012"], ["272", "#19325A"], ["297", "#AA7F2E"],
    ["226", "#FFEC6C"], ["256", "#1B2A34"],
  ])("resolves standard code %s to its source RGB %s", (code, hex) => {
    expect(resolveColor(code)?.hex).toBe(hex);
  });
  it("keeps transparency, direct colors and catalog namespaces separate", () => {
    expect(resolveColor("43")).toMatchObject({ hex: "#AEE9EF", alpha: 128 });
    expect(resolveColor("329")?.alpha).toBe(245);
    expect(resolveColor("10047")?.alpha).toBe(16);
    expect(resolveColor("0x2FF00AA")?.hex).toBe("#FF00AA");
    expect(resolveColor("4")?.brickLinkId).toBe(5);
    expect(resolveColor("5")?.name).toBe("Dark_Pink");
    expect(resolveColor("14")?.brickLinkId).toBeUndefined();
    expect(resolveColor("1009006")).toBeUndefined();
    expect(resolveColor("1009007")).toBeUndefined();
  });
  it("inherits submodel and subpart colors while preserving fixed multicolor surfaces", () => {
    const model = modelFor(`0 FILE main.ldr\n${line("14", "child.ldr")}\n0 FILE child.ldr\n${line("16")}`);
    const triangle = "0 0 0 20 0 0 0 24 0";
    model.resources["parts/swatch.dat"] = file("parts/swatch.dat",
      `${line("16", "s/child.dat")}\n3 4 ${triangle}\n3 43 ${triangle}`);
    model.resources["parts/s/child.dat"] = file("parts/s/child.dat", `3 16 ${triangle}`);
    model.instances[0].part.status = "resolved";
    refreshModelColors(model);
    expect(model.instances[0].colorCode).toBe("14");
    const group = createImportedGroup(model);
    const meshes = group.children.filter(child => child instanceof InstancedMesh);
    const materials = meshes.map(mesh => mesh.material as MeshLambertMaterial);
    // Inherited colors use per-instance colors; fixed printed surfaces use
    // vertex colors so many source colors can share one material/draw.
    const appearance = meshes.map(mesh => {
      const color = new Color();
      if (mesh.instanceColor) mesh.getColorAt(0, color);
      else color.fromBufferAttribute(mesh.geometry.getAttribute("color"), 0);
      return color.getHexString(SRGBColorSpace);
    });
    expect(appearance.sort())
      .toEqual(["aee9ef", "b40000", "fac80a"]);
    const transparent = materials.find(material => material.transparent)!;
    expect(transparent.opacity).toBeCloseTo(128 / 255);
    expect(transparent.depthWrite).toBe(false);
    for (const mesh of group.children as InstancedMesh[]) {
      mesh.geometry.dispose();
      (mesh.material as MeshLambertMaterial).dispose();
    }
  });
  it("repairs cached colors and stale warnings when an older saved project opens, without changing source data", () => {
    const model = modelFor(`${line("14")}\n${line("1009007")}`);
    const source = JSON.stringify([model.sourceText, model.originalBytes, model.instances.map(i => [i.colorCode, i.matrix])]);
    model.instances[0].color = { ldrawCode: "14", name: "Wrong cache", hex: "#ff00ff", alpha: 255, source: "old" };
    model.issues = [
      { code: "missing-color", reference: "14", message: "Old warning" },
      { code: "geometry-color", reference: "71", message: "Old fixed-surface warning" },
      { code: "missing-part", reference: "unavailable.dat", message: "Still relevant" },
    ];
    const document = normalizeDocument({ id: "old-project", name: "Saved", imported: model });
    expect(document.imported!.instances[0].color?.hex).toBe("#FAC80A");
    expect(document.imported!.issues.filter(issue => issue.code === "missing-color").map(issue => issue.reference)).toEqual(["1009007"]);
    expect(document.imported!.issues.some(issue => issue.code === "geometry-color")).toBe(false);
    expect(document.imported!.issues.some(issue => issue.code === "missing-part")).toBe(true);
    expect(model.instances[0].color?.name).toBe("Wrong cache");
    const reopened = importInternal(exportInternal(document));
    expect(reopened.imported!.instances[0].color?.hex).toBe("#FAC80A");
    expect(JSON.stringify([model.sourceText, model.originalBytes, model.instances.map(i => [i.colorCode, i.matrix])])).toBe(source);
    expect(reopened.imported!.legalDocuments.filter(doc => doc.name === "LDraw color snapshot provenance")).toHaveLength(1);
  });
  it("uses neutral, bounded lights rather than a warm key and green ambient cast", () => {
    const lighting = createBuilderLighting();
    const hemi = lighting.children.find(light => light instanceof HemisphereLight)!;
    const sun = lighting.children.find(light => light instanceof DirectionalLight)!;
    for (const color of [hemi.color, hemi.groundColor, sun.color]) {
      expect(color.r).toBe(color.g);
      expect(color.g).toBe(color.b);
    }
    expect((hemi.intensity + sun.intensity) / Math.PI).toBeCloseTo(1);
  });
});

const reference = new URL("../../../../../attached_assets/40649-size_1793502923137.io", import.meta.url);
it.skipIf(!existsSync(reference))("recognizes all standard colors of the private encrypted reference without guessing two Studio-only IDs", async () => {
  const bytes = new Uint8Array(await readFile(reference));
  const source = new TextDecoder().decode(readZip(bytes, { names: ["model.ldr"], studioEncryption: true })["model.ldr"]);
  const model = modelFor(source);
  refreshModelColors(model);
  expect(model.instances).toHaveLength(8590);
  expect(new Set(model.instances.map(instance => instance.colorCode)).size).toBe(51);
  expect(new Set(model.instances.filter(instance => instance.color).map(instance => instance.colorCode)).size).toBe(49);
  expect(model.issues.filter(issue => issue.code === "missing-color").map(issue => issue.reference).sort())
    .toEqual(["1009006", "1009007"]);
});
