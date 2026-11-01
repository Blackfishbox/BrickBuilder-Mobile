/** Separately licensed evidence, not an inference from filenames or geometry. */
export interface PartMappingEvidence {
  ldrawId: string;
  brickLinkId: string;
  name: string;
  variant: string;
  sourceUrl: string;
  sourceLine: string;
  sourceSha256: string;
  author: string;
  license: "CC-BY-4.0" | "CC0-1.0";
  mappingSet: string;
  version: string;
}

export interface PartMappingResult {
  status: "confirmed" | "ambiguous" | "unknown";
  candidates: PartMappingEvidence[];
}

export interface LibraryPart {
  id: string;
  packageId: string;
  ldrawId: string;
  brickLinkId?: string;
  mappings?: PartMappingEvidence[];
  name: string;
  category: string;
  keywords: string[];
  file: string;
}

export interface LibraryFile {
  path: string;
  sourceUrl: string;
  author: string;
  license: "CC-BY-4.0" | "CC0-1.0";
  content: string;
  /** SHA-256 of the exact acquired UTF-8 bytes, including BOM and line endings. */
  sha256?: string;
  byteLength?: number;
  retrievedAt?: string;
  retrievalSource?: string;
}

export interface PackagePayload {
  id: string;
  version: string;
  parts: LibraryPart[];
  files: LibraryFile[];
  legalDocuments: {
    name: string; sourceUrl: string; content: string;
    sha256?: string; byteLength?: number; retrievedAt?: string; retrievalSource?: string;
  }[];
}

export interface PackageManifest {
  id: string;
  version: string;
  title: string;
  description: string;
  url: string;
  sha256: string;
  bytes: number;
  partCount: number;
  fileCount: number;
  sourceUrl: string;
  licenseUrl: string;
  licenses: string[];
  attribution: string;
  changes: string;
}

export interface InstalledPackage extends PackageManifest {
  installedAt: string;
  legalDocuments: PackagePayload["legalDocuments"];
}

export interface StoredLibraryFile extends LibraryFile {
  id: string;
  packageId: string;
}
