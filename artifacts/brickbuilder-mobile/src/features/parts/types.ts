export interface LibraryPart {
  id: string;
  packageId: string;
  ldrawId: string;
  brickLinkId?: string;
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
}

export interface PackagePayload {
  id: string;
  version: string;
  parts: LibraryPart[];
  files: LibraryFile[];
  legalDocuments: { name: string; sourceUrl: string; content: string }[];
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
