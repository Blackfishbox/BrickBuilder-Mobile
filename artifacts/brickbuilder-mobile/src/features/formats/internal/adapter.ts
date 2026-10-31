import { z } from "zod";
import { normalizeDocument, type BuilderDocument } from "@/features/editor/model";
import { compilePart } from "@/features/engine/ldraw-geometry";

const finite = z.number().finite().min(-1e9).max(1e9);
const color = z.object({
  ldrawCode: z.string(), name: z.string(), hex: z.string().regex(/^#[0-9a-f]{6}$/i),
  alpha: z.number().min(0).max(255), brickLinkId: z.number().optional(), brickLinkName: z.string().optional(),
  studioId: z.string().optional(), source: z.string(),
});
const schema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().max(256),
  createdAt: z.string(), updatedAt: z.string(), metadata: z.record(z.string(), z.unknown()),
  bricks: z.array(z.object({
    id: z.string(), type: z.enum(["brick-2x4", "brick-2x2", "brick-1x2"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i), x: finite, y: finite, z: finite, rotation: finite,
  })).max(10000),
  imported: z.object({
    version: z.literal(1), format: z.enum(["io", "ldr", "mpd"]), sourceName: z.string(),
    originalBytes: z.array(z.number().int().min(0).max(255)).max(32 * 1024 * 1024),
    sourceText: z.string().max(16 * 1024 * 1024), root: z.string(),
    sections: z.record(z.string(), z.array(z.string())),
    instances: z.array(z.object({
      id: z.string(), reference: z.string().max(240).regex(/^[a-z0-9_ /.-]+\.dat$/i), colorCode: z.string().regex(/^(?:\d+|0x2[0-9a-f]{6})$/i), matrix: z.array(finite).length(12),
      sourcePath: z.array(z.string()),
      part: z.object({ ldrawId: z.string(), studioId: z.string().optional(), brickLinkId: z.string().optional(), name: z.string().optional(), status: z.enum(["resolved", "missing"]) }),
      color: color.optional(),
    })).max(10000),
    issues: z.array(z.object({ code: z.string(), message: z.string(), reference: z.string().optional(), count: z.number().optional() })),
    resources: z.record(z.string().regex(/^(parts|p)\/[a-z0-9_/-]+\.dat$/), z.object({
      path: z.string(), sourceUrl: z.string(), author: z.string(), license: z.enum(["CC-BY-4.0", "CC0-1.0"]), content: z.string().max(4 * 1024 * 1024),
    })),
    legalDocuments: z.array(z.object({ name: z.string(), sourceUrl: z.string(), content: z.string() })),
  }).optional(),
});
export function importInternal(bytes: Uint8Array): BuilderDocument {
  const parsed = schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  if (new Set(parsed.bricks.map(b => b.id)).size !== parsed.bricks.length) throw new Error("Doppelte Stein-IDs.");
  if (parsed.imported) {
    if (Object.keys(parsed.imported.resources).length > 4096) throw new Error("Zu viele Geometriedateien.");
    if (Object.values(parsed.imported.resources).reduce((n, f) => n + f.content.length, 0) > 24 * 1024 * 1024) throw new Error("Geometriedaten zu groß.");
    for (const instance of parsed.imported.instances) {
      if (instance.reference.split("/").includes("..") || instance.reference.startsWith("/")) throw new Error("Unsicherer Teilpfad.");
      instance.id = crypto.randomUUID();
    }
    // An internal JSON import must be just as safe as an IO import before storage.
    const model = parsed.imported as NonNullable<BuilderDocument["imported"]>;
    for (const instance of model.instances) {
      if (instance.part.status === "resolved") compilePart(model, instance.reference, instance.colorCode);
    }
  }
  return normalizeDocument({ ...parsed, id: crypto.randomUUID() } as BuilderDocument);
}
export function exportInternal(document: BuilderDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(document));
}
