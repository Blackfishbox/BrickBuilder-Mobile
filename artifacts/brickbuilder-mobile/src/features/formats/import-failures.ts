import type { ImportedModel } from './types';

export interface ImportPartFailure {
  reference: string;
  ldrawId: string;
  brickLinkIds: string[];
  count: number;
  reasons: string[];
}

const normalize = (reference: string) => reference.replaceAll('\\', '/').toLowerCase();

/** Geometry failures only: unconfirmed catalog mappings do not mean a part failed. */
export function getImportPartFailures(model?: ImportedModel): ImportPartFailure[] {
  if (!model) return [];
  const groups = new Map<string, ImportPartFailure>();
  for (const instance of model.instances) {
    if (instance.part.status !== 'missing') continue;
    const key = normalize(instance.reference);
    let group = groups.get(key);
    if (!group) {
      const reasons = model.issues
        .filter(issue => (issue.code === 'missing-part' || issue.code === 'geometry-invalid')
          && issue.reference && normalize(issue.reference) === key)
        .map(issue => issue.message);
      group = {
        reference: instance.reference,
        ldrawId: instance.part.ldrawId || instance.reference,
        brickLinkIds: [],
        count: 0,
        reasons: [...new Set(reasons)],
      };
      if (!group.reasons.length) group.reasons.push('Keine nutzbare Teilegeometrie verfügbar.');
      groups.set(key, group);
    }
    group.count++;
    if (instance.part.brickLinkId && !group.brickLinkIds.includes(instance.part.brickLinkId)) {
      group.brickLinkIds.push(instance.part.brickLinkId);
    }
  }
  return [...groups.values()];
}
