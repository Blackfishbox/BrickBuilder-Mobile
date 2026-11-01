import type { ImportedModel } from "./types";
import { resolveColor } from "./colors";
import { LDRAW_COLOR_SNAPSHOT } from "./ldraw-palette";

/** Recompute derived appearance on import and when opening older local projects. */
export function refreshModelColors(model: ImportedModel): void {
  model.issues = model.issues.filter(issue =>
    !["missing-color", "missing-bl-color"].includes(issue.code) &&
    !(issue.code === "geometry-color" && issue.reference && resolveColor(issue.reference)));
  const counts = new Map<string, number>();
  for (const instance of model.instances) {
    // Raw source codes, not previously cached color metadata, are authoritative.
    instance.color = resolveColor(instance.colorCode);
    counts.set(instance.colorCode, (counts.get(instance.colorCode) ?? 0) + 1);
  }
  for (const [code, count] of counts) {
    const color = resolveColor(code);
    if (!color) model.issues.push({
      code: "missing-color", reference: code, count,
      message: `LDraw-Farbe ${code} nicht zugeordnet. Als magentafarbene Warngeometrie dargestellt, Quellfarbcode bleibt erhalten.`,
    });
    else if (color.brickLinkId === undefined) model.issues.push({
      code: "missing-bl-color", reference: code,
      message: `Für ${color.name} (LDraw ${code}) ist keine bestätigte BrickLink-Farbnummer hinterlegt.`,
    });
  }
  const name = "LDraw color snapshot provenance";
  model.legalDocuments = model.legalDocuments.filter(document => document.name !== name);
  model.legalDocuments.push({
    name, sourceUrl: LDRAW_COLOR_SNAPSHOT.sourceUrl,
    content: `Color names and RGB/alpha facts normalized from LDConfig.ldr by ${LDRAW_COLOR_SNAPSHOT.attribution}, update ${LDRAW_COLOR_SNAPSHOT.sourceUpdate}. Reviewed ${LDRAW_COLOR_SNAPSHOT.reviewedAt}. Source SHA-256: ${LDRAW_COLOR_SNAPSHOT.sourceSha256}. Only selected factual fields are reproduced, not Studio resources or a BrickLink catalog. LDraw.org legal information: ${LDRAW_COLOR_SNAPSHOT.legalInfoUrl}. LDraw.org-specific original content is offered under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the configuration has no individual geometry !LICENSE header. This is not a parts-file license certification. No endorsement by LDraw, BrickLink or LEGO.`,
  });
}
