import type { ImportedModel } from "./types";
import { resolveColor } from "./colors";
import { LDRAW_COLOR_SNAPSHOT } from "./ldraw-palette";

/** Recompute derived appearance on import and when opening older local projects. */
export function refreshModelColors(model: ImportedModel): void {
  model.issues = model.issues.filter(issue =>
    !["missing-color", "missing-bl-color", "ambiguous-bl-color"].includes(issue.code) &&
    !(issue.code === "geometry-color" && issue.reference && resolveColor(issue.reference)));
  const counts = new Map<string, number>();
  for (const instance of model.instances) {
    // Raw source codes, not previously cached color metadata, are authoritative.
    const prior = instance.color;
    const current = resolveColor(instance.colorCode);
    instance.color = current;
    const metadata = current?.catalog ?? prior?.catalog;
    if (metadata && prior?.ldrawCode === instance.colorCode && prior.source &&
        (prior.catalog || prior.brickLinkId !== undefined)) {
      const ids = new Set([...(current?.catalog?.brickLinkIds ?? []),
        ...(current?.brickLinkId === undefined ? [] : [current.brickLinkId]),
        ...(prior.catalog?.brickLinkIds ?? []), ...(prior.brickLinkId === undefined ? [] : [prior.brickLinkId])]);
      const id = ids.size === 1 ? [...ids][0] : undefined;
      const appearance = current ?? {
        ldrawCode: instance.colorCode, name: prior.name, hex: "#FF00AA", alpha: 255,
        source: `Unresolved appearance for raw LDraw ${instance.colorCode}; saved mapping evidence only`,
      };
      const sources = [...new Set([...(current?.catalog?.sources ?? [appearance.source]),
        ...(prior.catalog?.sources?.length ? prior.catalog.sources : [prior.source])])];
      instance.color = {
        ...appearance, brickLinkId: id,
        brickLinkName: id === undefined ? undefined : current?.brickLinkId === id ? current.brickLinkName : prior.brickLinkId === id ? prior.brickLinkName : undefined,
        catalog: { ...metadata, status: ids.size === 1 ? "confirmed" : ids.size > 1 ? "ambiguous" : "unknown",
          brickLinkIds: [...ids], rebrickableIds: [...new Set([...(current?.catalog?.rebrickableIds ?? []), ...(prior.catalog?.rebrickableIds ?? [])])], sources },
        source: sources.join("\n"),
      };
    }
    counts.set(instance.colorCode, (counts.get(instance.colorCode) ?? 0) + 1);
  }
  for (const [code, count] of counts) {
    const color = model.instances.find(instance => instance.colorCode === code)?.color ?? resolveColor(code);
    if (!resolveColor(code)) model.issues.push({
      code: "missing-color", reference: code, count,
      message: `LDraw-Farbe ${code} nicht zugeordnet. Als magentafarbene Warngeometrie dargestellt, Quellfarbcode bleibt erhalten.`,
    });
    else if (color?.catalog?.status === "ambiguous") model.issues.push({
      code: "ambiguous-bl-color", reference: code,
      message: `LDraw ${code}: widersprüchliche BrickLink-Farbnachweise (${color.catalog.brickLinkIds.join(", ")}). Erscheinungsfarbe bleibt erhalten; keine Ziel-ID ausgewählt.`,
    });
    else if (color && color.brickLinkId === undefined) model.issues.push({
      code: "missing-bl-color", reference: code,
      message: `${color.name} (LDraw ${code}) wird mit bekannter LDraw-Farbe dargestellt. Unserer App fehlt lediglich die bestätigte BrickLink-Katalogzuordnung; dies ist kein Farb- oder Importfehler.`,
    });
  }
  const name = "LDraw color snapshot provenance";
  model.legalDocuments = model.legalDocuments.filter(document => document.name !== name);
  model.legalDocuments.push({
    name, sourceUrl: LDRAW_COLOR_SNAPSHOT.sourceUrl,
    content: `Color names and RGB/alpha facts normalized from LDConfig.ldr by ${LDRAW_COLOR_SNAPSHOT.attribution}, update ${LDRAW_COLOR_SNAPSHOT.sourceUpdate}. Reviewed ${LDRAW_COLOR_SNAPSHOT.reviewedAt}. Source SHA-256: ${LDRAW_COLOR_SNAPSHOT.sourceSha256}. Only selected factual fields are reproduced, not Studio resources or a BrickLink catalog. LDraw.org legal information: ${LDRAW_COLOR_SNAPSHOT.legalInfoUrl}. LDraw.org-specific original content is offered under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); the configuration has no individual geometry !LICENSE header. This is not a parts-file license certification. No endorsement by LDraw, BrickLink or LEGO.`,
  });
}
