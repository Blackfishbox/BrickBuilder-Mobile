import { z } from "zod";

export const mappingEvidenceSchema = z.object({
  ldrawId: z.string().regex(/^[a-z0-9_./-]+$/),
  brickLinkId: z.string().regex(/^[a-z0-9_./-]+$/i),
  name: z.string().min(1), variant: z.string().min(1),
  sourceUrl: z.string().url(), sourceLine: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  author: z.string().min(1), license: z.enum(["CC-BY-4.0", "CC0-1.0", "Rebrickable-Attribution"]),
  rebrickableId: z.string().optional(),
  mappingSet: z.string().min(1), version: z.string().min(1),
});

export const mappingResultSchema = z.object({
  rebrickableIds: z.array(z.string()).optional(),
  catalogVersion: z.string().optional(),
  status: z.enum(["confirmed", "ambiguous", "unknown"]),
  candidates: z.array(mappingEvidenceSchema),
}).superRefine((value, ctx) => {
  const ids = new Set(value.candidates.map(e => e.brickLinkId));
  const expected = ids.size === 0 ? "unknown" : ids.size === 1 ? "confirmed" : "ambiguous";
  if (value.status !== expected) ctx.addIssue({ code: "custom", message: "Widersprüchlicher Zuordnungsstatus." });
});
