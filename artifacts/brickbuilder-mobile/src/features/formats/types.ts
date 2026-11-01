import type { LibraryFile, PackagePayload, PartMappingResult } from "../parts/types";
import type { Allocation } from "../inventory/types";

/** Row-major affine 3x4 in original LDraw units, including reflection/shear. */
export type Affine = [number, number, number, number, number, number, number, number, number, number, number, number];
export interface ImportIssue { code: string; message: string; reference?: string; count?: number }
export interface ResolvedColor {
  catalog?: { version: string; status: "confirmed" | "ambiguous" | "unknown"; rebrickableIds: string[]; brickLinkIds: number[]; sources?: string[] };
  ldrawCode: string;
  name: string;
  hex: string;
  alpha: number;
  brickLinkId?: number;
  brickLinkName?: string;
  studioId?: string;
  source: string;
}
export interface ImportedInstance {
  allocation?: Allocation;
  id: string;
  reference: string;
  colorCode: string;
  matrix: Affine;
  sourcePath: string[];
  /** Zero-based reference-line indices from root to leaf; distinguishes repeated submodels. */
  sourceOccurrence?: number[];
  part: { ldrawId: string; studioId?: string; brickLinkId?: string; name?: string; mapping?: PartMappingResult; status: "resolved" | "missing" };
  color?: ResolvedColor;
}
export interface ImportedModel {
  version: 1;
  /** Effective instances were edited; original source/archive remain untouched. */
  edited?: boolean;
  format: "io" | "ldr" | "mpd";
  sourceName: string;
  /** Exact original upload, not a publicly shipped fixture. */
  originalBytes: number[];
  sourceText: string;
  root: string;
  sections: Record<string, string[]>;
  instances: ImportedInstance[];
  issues: ImportIssue[];
  resources: Record<string, LibraryFile>;
  legalDocuments: PackagePayload["legalDocuments"];
  retrievalSnapshots?: RetrievalSnapshot[];
}

export interface RetrievalSnapshot {
  version: 1;
  id: string;
  createdAt: string;
  roots: string[];
  graph: Record<string, string[]>;
  files: LibraryFile[];
  legalDocuments: PackagePayload["legalDocuments"];
}
