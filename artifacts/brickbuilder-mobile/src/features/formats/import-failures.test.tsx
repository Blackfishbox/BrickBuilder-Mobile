// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getImportPartFailures } from './import-failures';
import ImportPartNotification from './ImportPartNotification';
import type { ImportedInstance, ImportedModel } from './types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function instance(reference: string, status: 'resolved' | 'missing' = 'missing'): ImportedInstance {
  return {
    id: crypto.randomUUID(), reference, colorCode: '0', sourcePath: [],
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    part: { ldrawId: reference.replace(/\.dat$/i, ''), status },
  };
}
function model(instances: ImportedInstance[]): ImportedModel {
  return {
    version: 1, format: 'io', sourceName: 'test.io', originalBytes: [], sourceText: '',
    root: 'main', sections: {}, instances, issues: [], resources: {}, legalDocuments: [],
  };
}

describe('failed-part notifications', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('groups repeated references, counts failed instances, and keeps explicit IDs and reasons', () => {
    const first = instance('3001.dat');
    first.part.brickLinkId = '3001a';
    const doc = model([first, instance('3001.DAT'), instance('3001.dat', 'resolved'), instance('missing.dat')]);
    doc.issues = [
      { code: 'missing-part', reference: '3001.dat', message: 'Primitive stud.dat fehlt.' },
      { code: 'missing-part', reference: '3001.DAT', message: 'Primitive stud.dat fehlt.' },
    ];
    expect(getImportPartFailures(doc)).toEqual([
      { reference: '3001.dat', ldrawId: '3001', brickLinkIds: ['3001a'], count: 2, reasons: ['Primitive stud.dat fehlt.'] },
      { reference: 'missing.dat', ldrawId: 'missing', brickLinkIds: [], count: 1, reasons: ['Keine nutzbare Teilegeometrie verfügbar.'] },
    ]);
  });

  it('does not treat unconfirmed BrickLink mappings or warning colors as failed imports', async () => {
    const doc = model([instance('3001.dat', 'resolved')]);
    doc.issues = [
      { code: 'missing-bl-part', message: 'Keine belegte BrickLink-Nummer.' },
      { code: 'missing-color', reference: '999', message: 'Warnfarbe Magenta.' },
    ];
    expect(getImportPartFailures(doc)).toEqual([]);
    expect(getImportPartFailures()).toEqual([]);
    await act(async () => root.render(<ImportPartNotification model={doc} />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows all part numbers and compilation failures in an accessible, dismissible alert', async () => {
    const doc = model([instance('3001.dat'), instance('3001.dat'), instance('99999.dat')]);
    doc.issues = [{ code: 'geometry-invalid', reference: '99999.dat', message: 'Ungültige Geometrie.' }];
    await act(async () => root.render(<ImportPartNotification model={doc} floating />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('LDraw 3001 · 2×');
    expect(container.textContent).toContain('LDraw 99999 · 1×');
    expect(container.textContent).toContain('Ungültige Geometrie.');
    expect(container.textContent).toContain('3 Instanzen · 2 Teilenummern');
    expect(container.textContent).not.toContain('BrickLink');
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(<ImportPartNotification model={doc} floating />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => root.render(<ImportPartNotification model={model([instance('54321.dat')])} floating />));
    expect(container.textContent).toContain('LDraw 54321');
  });

  it('keeps the notification visible in previews and restores it when another project opens', async () => {
    const doc = model([instance('99999.dat')]);
    await act(async () => root.render(<ImportPartNotification model={doc} dismissible={false} />));
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('button')).toBeNull();
    await act(async () => root.render(<ImportPartNotification key="first" model={doc} />));
    await act(async () => container.querySelector('button')!.click());
    await act(async () => root.render(<ImportPartNotification key="second" model={doc} />));
    expect(container.textContent).toContain('LDraw 99999');
  });

  it('renders imported references as text, never as markup', async () => {
    const doc = model([instance('<img src=x onerror=alert(1)>.dat')]);
    await act(async () => root.render(<ImportPartNotification model={doc} />));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
