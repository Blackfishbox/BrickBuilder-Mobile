import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Download, FileUp, LoaderCircle, X } from 'lucide-react';
import type { BuilderDocument } from '@/features/editor/model';
import type { ImportedModel } from './types';
import { exportModel, importModelFile, validateImportFile } from './adapters';
import ImportPartNotification from './ImportPartNotification';
import { importDiagnostics } from './import-diagnostics';
import CatalogPanel from '../catalog/CatalogPanel';
import { resolveGeometry } from './geometry-resolver';
import type { GeometryProgress } from './online-geometry';
import './format-dialog.css';
import { exportFile } from '@/platform/export-file';

type ExportFormat = 'json' | 'ldr' | 'mpd' | 'io';
type WithImported = BuilderDocument & { imported?: ImportedModel };

const EXPORTS: { format: ExportFormat; label: string; note: string }[] = [
  { format: 'json', label: 'Projekt (JSON)', note: 'Vollständige Sicherung dieses Projekts' },
  { format: 'ldr', label: 'LDraw (.ldr)', note: 'Einzelmodell für LDraw-Programme' },
  { format: 'mpd', label: 'LDraw (.mpd)', note: 'Mehrteilige LDraw-Datei' },
  { format: 'io', label: 'Studio (.io)', note: 'Minimal generiertes Modell – keine Studio-Originaldatei' },
];

interface Props {
  document: BuilderDocument;
  onClose(): void;
  onImport(document: BuilderDocument): Promise<void>;
  onResolved?(id: string, model: ImportedModel): Promise<void>;
}

export function Report({ model, bricks }: { model?: ImportedModel; bricks: number }) {
  if (!model) return <p className="fmt-muted">Dieses Projekt enthält keine importierten Daten.</p>;
  const parts = new Set(model.instances.map((i) => i.part.ldrawId)).size;
  const colors = new Set(model.instances.map((i) => i.colorCode)).size;
  const unsupported = model.instances.filter((i) => i.part.status !== 'resolved').length;
  const { warnings, information } = importDiagnostics(model);
  const groups = new Map<string, { instance: ImportedModel['instances'][number]; count: number }>();
  for (const instance of model.instances) {
    const key = JSON.stringify([instance.reference, instance.colorCode]);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { instance, count: 1 });
  }
  return (
    <div className="fmt-report" data-testid="format-report">
      <CatalogPanel />
      <div className="fmt-source"><strong>{model.sourceName}</strong><span>{String(model.format).toUpperCase()}</span></div>
      <div className="fmt-stats">
        <div><b>{bricks + model.instances.length}</b><small>Ergebnis gesamt</small></div>
        <div><b>{model.instances.length}</b><small>Instanzen</small></div>
        <div><b>{parts}</b><small>Teile</small></div>
        <div><b>{colors}</b><small>Farben</small></div>
      </div>
      <ImportPartNotification model={model} dismissible={false} />
      {(warnings.length > 0 || unsupported > 0) && (
        <div className="fmt-warn" role="status">
          <AlertTriangle size={15} />
          <span>{warnings.length} Importwarnungen{unsupported ? ` · ${unsupported} Teile nicht vollständig unterstützt` : ''}. Details bleiben im Projekt gespeichert.</span>
        </div>
      )}
      {warnings.length > 0 && (
        <details className="fmt-details" open>
          <summary>Importwarnungen ({warnings.length}) <ChevronDown size={14} /></summary>
          <ul>{warnings.map((issue, n) => (
            <li key={n}><code>{issue.code}</code><span>{issue.message}</span>
              {(issue.reference || issue.count) && <small>{issue.reference ?? ''}{issue.count ? ` · ${issue.count}×` : ''}</small>}
            </li>
          ))}</ul>
        </details>
      )}
      {information.length > 0 && (
        <details className="fmt-details" data-testid="import-catalog-information">
          <summary>Katalog- und Formatinformationen ({information.length}) <ChevronDown size={14} /></summary>
          <p className="fmt-muted">Diese Informationen sind keine Meldungen über ungültige LEGO-Teile, fehlende Geometrie oder falsche Farben. Tatsächliche Importprobleme werden separat angezeigt.</p>
          <ul>{information.map((issue, index) => (
            <li key={index}><span>{issue.message}</span>
              {issue.code === 'missing-bl-part' && <small>LDraw-Teile ohne bestätigte BrickLink-Zuordnung: {[...new Set(model.instances.filter(instance => !instance.part.brickLinkId).map(instance => instance.part.ldrawId))].join(', ')}</small>}
              {issue.reference && <small>LDraw {issue.reference}</small>}
            </li>
          ))}</ul>
        </details>
      )}
      <details className="fmt-details">
        <summary>Zuordnungen ({groups.size} Teil-/Farbkombinationen) <ChevronDown size={14} /></summary>
        <p className="fmt-muted">BrickLink-Nachweise stammen aus expliziten LDraw-Schlüsselwörtern und dem geprüften vollständigen Rebrickable-Download. Import-/Exportrichtung, getrennte Namensräume und ältere Belege bleiben erhalten. Studio-IDs werden nicht geraten.</p>
        <ul>{[...groups.values()].map(({ instance: i, count }) => (
          <li key={i.id} className="fmt-map">
            <i style={{ background: i.color?.hex ?? '#ccc' }} />
            <span><b>{i.part.name ?? i.reference} · {count}×</b>
              <small>LDraw {i.part.ldrawId} · BrickLink {i.part.brickLinkId ?? '—'} · Studio {i.part.studioId ?? '—'}</small>
              <small>Rebrickable {i.part.mapping?.rebrickableIds?.join(', ') || '—'} · Katalogstand {i.part.mapping?.catalogVersion ?? 'gespeicherte Einzelnachweise'}</small>
              <small>Teilezuordnung: {i.part.mapping?.status === 'confirmed' ? 'belegt' : i.part.mapping?.status === 'ambiguous' ? 'mehrdeutig – keine Auswahl' : 'unbestätigt – keine Nummernableitung'}</small>
              {i.part.mapping?.candidates.map((e, n) => (
                <small key={n}>
                  BrickLink {e.brickLinkId} · {e.name} · Variante: {e.variant}<br />
                  <a href={e.sourceUrl} target="_blank" rel="noreferrer">Quelle: LDraw {e.ldrawId}</a>
                  {' · '}{e.author} · {e.license} · {e.mappingSet} / {e.version}<br />
                  Beleg: {e.sourceLine}<br />
                  <span style={{ overflowWrap: 'anywhere' }}>Quell-SHA-256: {e.sourceSha256}</span>
                </small>
              ))}
              <small>Farbe {i.color?.name ?? `Code ${i.colorCode}`} · LDraw {i.color?.ldrawCode ?? i.colorCode} · BrickLink {i.color?.brickLinkName ?? '—'} {i.color?.brickLinkId ?? '—'} · Studio {i.color?.studioId ?? '—'}</small>
              {i.color && <small>Zuordnungsquelle: {i.color.source}</small>}
              {i.color?.catalog && <small>Rebrickable-Farben {i.color.catalog.rebrickableIds.join(', ')} · {i.color.catalog.status === 'ambiguous' ? `mehrdeutig: BrickLink ${i.color.catalog.brickLinkIds.join(', ')}` : i.color.catalog.status === 'confirmed' ? 'eindeutig belegt' : 'keine BrickLink-Zielnummer'}</small>}
            </span>
            <em className={`fmt-status s-${i.part.status}`}>{i.part.status === 'resolved' ? 'Geometrie geladen' : 'Fehlt'}</em>
          </li>
        ))}</ul>
      </details>
      <p className="fmt-muted">Quelldaten werden unverändert im Projekt aufbewahrt ({Object.keys(model.resources ?? {}).length} Ressourcen).</p>
      <p className="fmt-muted">LDR exportiert flache Einzelteile ohne eingebettete Geometrie. MPD und minimaler IO-Export erhalten darstellbare Untermodellstrukturen und eingebettete LDraw-Abschnitte; einzelne bearbeitete Vorkommen erhalten bei Bedarf eigene Untermodelle. Bei nicht invertierbaren Transformationen werden betroffene Teile auf die oberste Ebene verschoben. Unbekannte LDraw-Befehle bleiben als Text erhalten, werden aber nicht an Änderungen angepasst. Anleitung, LXFML, Texturen, Studio-Geometrie und unbekannte proprietäre Archivdaten werden im minimalen IO nicht übernommen. Originalarchiv und Quelldaten bleiben in der JSON-Sicherung unverändert. Keine zugesicherte Studio-Rückwärtskompatibilität.</p>
      <details className="fmt-details">
        <summary>Geometrie-/Zuordnungsherkunft und Lizenzen <ChevronDown size={14} /></summary>
        <p className="fmt-muted">Originaldateien unverändert; Auswahl und Paketierung durch BrickBuilder. Lizenz pro Datei: CC BY 4.0 oder CC0. Bei dualer Lizenz wird CC BY 4.0 genutzt.</p>
        <ul>{Object.values(model.resources).map(file => (
          <li key={file.path}><a href={file.sourceUrl} target="_blank" rel="noreferrer">{file.path}</a>
            <span>{file.author} · {file.license}</span>
            {file.sha256 && <small style={{ overflowWrap: 'anywhere' }}>Quell-SHA-256: {file.sha256}<br />{file.retrievalSource}</small>}
          </li>
        ))}</ul>
        {model.legalDocuments.map((doc, index) => (
          <details key={`${doc.name}-${index}`}><summary>{doc.name}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{doc.content}</pre></details>
        ))}
      </details>
    </div>
  );
}

export default function FormatDialog({ document, onClose, onImport, onResolved }: Props) {
  const [preview, setPreview] = useState<BuilderDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState('');
  const token = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<GeometryProgress | null>(null);
  useEffect(() => () => { controller.current?.abort(); token.current++; }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !creating) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, onClose]);

  const pick = async (file: File | undefined) => {
    const id = ++token.current;
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setProgress(null);
    setPreview(null); setError(''); setBusy(false);
    if (!file) return;
    setFileName(file.name);
    try { validateImportFile(file); }
    catch (e) { setError(e instanceof Error ? e.message : 'Datei konnte nicht gelesen werden.'); return; }
    setBusy(true);
    try {
      const doc = await importModelFile(file, { signal: operation.signal,
        onProgress: value => { if (id === token.current) setProgress(value); } });
      if (id === token.current) setPreview(doc);
    } catch (e) {
      if (id === token.current) setError(e instanceof Error ? e.message : 'Datei konnte nicht gelesen werden.');
    } finally { if (id === token.current) setBusy(false); }
  };

  const retryGeometry = async () => {
    const source = preview ?? document;
    if (!source.imported) return;
    const id = ++token.current;
    controller.current?.abort();
    const operation = new AbortController(); controller.current = operation;
    setBusy(true); setError(''); setProgress(null);
    try {
      // Work on a detached model; quota errors or cancellation cannot mutate the open project.
      const model = structuredClone(source.imported);
      await resolveGeometry(model, { signal: operation.signal, retry: true,
        onProgress: value => { if (id === token.current) setProgress(value); } });
      if (id !== token.current) return;
      if (preview) setPreview({ ...source, imported: model });
      else if (onResolved) await onResolved(source.id, model);
    } catch (e) {
      if (id === token.current) setError(e instanceof Error ? e.message : 'Geometrie konnte nicht geladen werden.');
    } finally { if (id === token.current) setBusy(false); }
  };

  const create = async () => {
    if (!preview) return;
    setCreating(true); setError('');
    try { await onImport(preview); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Projekt konnte nicht angelegt werden.'); }
    finally { setCreating(false); }
  };

  const doExport = async (format: ExportFormat) => {
    setExporting(format); setExportError('');
    try {
      const { bytes, filename, mime } = await exportModel(document, format);
      await exportFile(bytes, filename, mime);
    } catch (e) { setExportError(e instanceof Error ? e.message : 'Export fehlgeschlagen.'); }
    finally { setExporting(null); }
  };

  const shown = (preview ?? document) as WithImported;

  return (
    <div className="drawer-scrim fmt-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !creating) onClose(); }}>
      <section className="parts-drawer fmt-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="fmt-title" data-testid="dialog-formats">
        <div className="drawer-handle" />
        <div className="drawer-heading">
          <div><p className="popover-eyebrow">DATEIEN</p><h2 id="fmt-title">Import &amp; Export</h2></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={creating} aria-label="Dialog schließen" data-testid="button-close-formats"><X size={18} /></button>
        </div>

        <div className="fmt-section">
          <h3><span>01</span> Importieren</h3>
          <label className="fmt-drop">
            <FileUp size={20} />
            <span><b>{fileName || 'Datei auswählen'}</b><small>IO, LDR, MPD bis 32 MiB · JSON-Projektsicherungen auch größer</small></span>
            <input type="file" accept=".io,.ldr,.mpd,.json" disabled={creating} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-import-file" />
          </label>
          {busy && <div className="fmt-loading" role="status" style={{ flexWrap: 'wrap' }}>
            <LoaderCircle className="spin" size={15} />
            <span>{progress ? `Teile prüfen: ${progress.roots}/${progress.total} · ${progress.files} Dateien · ${(progress.bytes / 1024 / 1024).toFixed(1)} MiB geladen` : 'Datei wird geprüft …'}
              {progress?.reference && <small style={{ display: 'block', overflowWrap: 'anywhere' }}>LDraw {progress.reference}</small>}</span>
            <button type="button" onClick={() => controller.current?.abort()} data-testid="button-cancel-geometry">Nachladen abbrechen</button>
          </div>}
          {error && <div className="fmt-error" role="alert" data-testid="status-import-error">{error}</div>}
          {(preview || !busy) && (
            <>
              <p className="fmt-label">{preview ? 'Vorschau' : 'Aktuelles Projekt'}</p>
              <Report model={shown.imported} bricks={shown.bricks.length} />
              {preview && !shown.imported && <p className="fmt-muted">Geprüftes JSON-Projekt: {shown.bricks.length} Steine.</p>}
            </>
          )}
          {!busy && shown.imported && shown.imported.instances.some(i => i.part.status === 'missing') && (
            <button type="button" className="confirm-button fmt-create" onClick={() => void retryGeometry()}
              disabled={creating || (!preview && !onResolved)} data-testid="button-retry-geometry">Fehlende LDraw-Teile erneut laden</button>
          )}
          {preview && (
              <button type="button" className="confirm-button fmt-create" onClick={() => void create()} disabled={creating || busy} data-testid="button-create-imported">
              {creating ? <><LoaderCircle className="spin" size={15} /> Wird angelegt …</> : 'Neues Projekt aus Import anlegen'}
            </button>
          )}
        </div>

        <div className="fmt-section">
          <h3><span>02</span> Exportieren</h3>
          <div className="fmt-exports">
            {EXPORTS.map((x) => (
              <button key={x.format} type="button" className="fmt-export" onClick={() => void doExport(x.format)} disabled={exporting !== null} data-testid={`button-export-${x.format}`}>
                {exporting === x.format ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
                <span><b>{x.label}</b><small>{x.note}</small></span>
              </button>
            ))}
          </div>
          {exportError && <div className="fmt-error" role="alert" data-testid="status-export-error">{exportError}</div>}
          <p className="fmt-muted" data-testid="text-inventory-backup-notice">Teileliste: Nur die interne JSON-Sicherung bewahrt „Meine Teileliste“ samt Mengen und Zuordnungen verbauter Teile. LDR, MPD und IO enthalten keine Teilelisten-Zuordnungen.</p>
        </div>
      </section>
    </div>
  );
}
