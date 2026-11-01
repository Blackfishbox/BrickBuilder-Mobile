import type { ImportedInstance, ImportedModel } from "../formats/types";
import { resolvePartMapping } from "../parts/bricklink-evidence";
import { refreshModelColors } from "../formats/model-colors";
import catalogManifest from "./manifest.json";
import { getCatalogState } from "./state";

export function refreshedCatalogModel(model: ImportedModel, cache = new WeakMap<ImportedInstance, ImportedInstance>()): ImportedModel {
  const next = { ...model, legalDocuments: [...model.legalDocuments], issues: [...model.issues],
    instances: model.instances.map(instance => {
      const cached = cache.get(instance);
      if (cached) return cached;
      const mapping = resolvePartMapping(instance.reference, [], instance.part.mapping?.candidates ?? []);
      const confirmed = mapping.status === "confirmed" ? mapping.candidates[0] : undefined;
      const updated = { ...instance, part: { ...instance.part, mapping, brickLinkId: confirmed?.brickLinkId,
        name: confirmed?.name ?? instance.part.name } };
      cache.set(instance, updated);
      return updated;
    }) };
  next.issues = next.issues.filter(issue => !["missing-bl-part", "ambiguous-bl-part"].includes(issue.code));
  const unknown = new Set(next.instances.filter(i => !i.part.brickLinkId).map(i => i.reference));
  if (unknown.size) next.issues.push({ code: "missing-bl-part", count: unknown.size,
    message: `${unknown.size} Teilearten ohne eindeutige BrickLink-Entsprechung im verfügbaren Quellenbestand. Geometrie und originale Referenzen bleiben unabhängig davon erhalten.` });
  const ambiguous = [...new Set(next.instances.filter(i => i.part.mapping?.status === "ambiguous").map(i => i.reference))];
  for (const reference of ambiguous) next.issues.push({ code: "ambiguous-bl-part", reference,
    message: `${reference}: widersprüchliche BrickLink-Zuordnungen. Keine Zielnummer ausgewählt; alle Quellen bleiben im Bericht erhalten.` });
  refreshModelColors(next);
  if (getCatalogState().status === "ready") {
    const name = `Rebrickable catalog ${catalogManifest.version}`;
    if (!next.legalDocuments.some(document => document.name === name)) next.legalDocuments.push({
      name, sourceUrl: catalogManifest.termsUrl,
      content: `${catalogManifest.attribution}\nSnapshot SHA-256 ${catalogManifest.sha256}\n${JSON.stringify(catalogManifest.sources, null, 2)}`,
    });
  }
  return next;
}
