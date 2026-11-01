import type { ImportedModel, ImportIssue } from "./types";

// Catalog evidence and supported format scope do not imply missing geometry.
const informationCodes = new Set(["missing-bl-part", "missing-bl-color", "io-scope"]);
export function isImportWarning(issue: ImportIssue): boolean {
  return !informationCodes.has(issue.code);
}
export function importDiagnostics(model: ImportedModel) {
  return {
    warnings: model.issues.filter(isImportWarning),
    information: model.issues.filter(issue => !isImportWarning(issue)),
  };
}
