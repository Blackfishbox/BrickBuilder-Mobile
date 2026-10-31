import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Download, FileUp, LoaderCircle, X } from 'lucide-react';
import type { BuilderDocument } from '@/features/editor/model';
import type { ImportedModel } from './types';
import { exportModel, importModelFile } from './adapters';
import './format-dialog.css';

type ExportFormat = 'json' | 'ldr' | 'mpd' | 'io';
type WithImported = BuilderDocument & { imported?: ImportedModel };

const MAX_BYTES = 32 * 1024 * 1024;
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
}

function Report({ model, bricks }: { model?: ImportedModel; bricks: number }) {
  if (!model) return <p className="fmt-muted">Dieses Projekt enthält keine importierten Daten.</p>;
  const parts = new Set(model.instances.map((i) => i.part.ldrawId)).size;
  const colors = new Set(model.instances.map((i) => i.colorCode)).size;
  const unsupported = model.instances.filter((i) => i.part.status !== 'resolved').length;
  return (
    <div className="fmt-report" data-testid="format-report">
      <div className="fmt-source"><strong>{model.sourceName}</strong><span>{String(model.format).toUpperCase()}</span></div>
      <div className="fmt-stats">
        <div><b>{bricks + model.instances.length}</b><small>Ergebnis gesamt</small></div>
        <div><b>{model.instances.length}</b><small>Instanzen</small></div>
        <div><b>{parts}</b><small>Teile</small></div>
        <div><b>{colors}</b><small>Farben</small></div>
      </div>
      {(model.issues.length > 0 || unsupported > 0) && (
        <div className="fmt-warn" role="status">
          <AlertTriangle size={15} />
          <span>{model.issues.length} Hinweise{unsupported ? ` · ${unsupported} Teile nicht vollständig unterstützt` : ''}. Diese Warnungen bleiben im Projekt gespeichert.</span>
        </div>
      )}
      {model.issues.length > 0 && (
        <details className="fmt-details" open>
          <summary>Hinweise ({model.issues.length}) <ChevronDown size={14} /></summary>
          <ul>{model.issues.map((issue, n) => (
            <li key={n}><code>{issue.code}</code><span>{issue.message}</span>
              {(issue.reference || issue.count) && <small>{issue.reference ?? ''}{issue.count ? ` · ${issue.count}×` : ''}</small>}
            </li>
          ))}</ul>
        </details>
      )}
      <details className="fmt-details">
        <summary>Zuordnungen ({model.instances.length}) <ChevronDown size={14} /></summary>
        <ul>{model.instances.slice(0, 400).map((i) => (
          <li key={i.id} className="fmt-map">
            <i style={{ background: i.color?.hex ?? '#ccc' }} />
            <span><b>{i.part.name ?? i.reference}</b>
              <small>LDraw {i.part.ldrawId} · BrickLink {i.part.brickLinkId ?? '—'} · Studio {i.part.studioId ?? '—'}</small>
              <small>Farbe {i.color?.name ?? `Code ${i.colorCode}`} · LDraw {i.color?.ldrawCode ?? i.colorCode} · BrickLink {i.color?.brickLinkName ?? '—'} {i.color?.brickLinkId ?? '—'} · Studio {i.color?.studioId ?? '—'}</small>
              {i.color && <small>Zuordnungsquelle: {i.color.source}</small>}
            </span>
            <em className={`fmt-status s-${i.part.status}`}>{i.part.status === 'resolved' ? 'Geometrie geladen' : 'Fehlt'}</em>
          </li>
        ))}</ul>
        {model.instances.length > 400 && <p className="fmt-muted">… und {model.instances.length - 400} weitere</p>}
      </details>
      <p className="fmt-muted">Quelldaten werden unverändert im Projekt aufbewahrt ({Object.keys(model.resources ?? {}).length} Ressourcen).</p>
      <details className="fmt-details">
        <summary>LDraw-Herkunft und Lizenzen <ChevronDown size={14} /></summary>
        <p className="fmt-muted">Originaldateien unverändert; Auswahl und Paketierung durch BrickBuilder. Lizenz pro Datei: CC BY 4.0 oder CC0. Bei dualer Lizenz wird CC BY 4.0 genutzt.</p>
        <ul>{Object.values(model.resources).map(file => (
          <li key={file.path}><a href={file.sourceUrl} target="_blank" rel="noreferrer">{file.path}</a>
            <span>{file.author} · {file.license}</span>
          </li>
        ))}</ul>
        {model.legalDocuments.map(doc => (
          <details key={doc.name}><summary>{doc.name}</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{doc.content}</pre></details>
        ))}
      </details>
    </div>
  );
}

export default function FormatDialog({ document, onClose, onImport }: Props) {
  const [preview, setPreview] = useState<BuilderDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState('');
  const token = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !creating) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [creating, onClose]);

  const pick = async (file: File | undefined) => {
    const id = ++token.current;
    setPreview(null); setError(''); setBusy(false);
    if (!file) return;
    setFileName(file.name);
    if (!/\.(io|ldr|mpd|json)$/i.test(file.name)) { setError('Nicht unterstütztes Format. Erlaubt: IO, LDR, MPD, JSON.'); return; }
    if (file.size > MAX_BYTES) { setError('Datei ist größer als 32 MiB.'); return; }
    setBusy(true);
    try {
      const doc = await importModelFile(file);
      if (id === token.current) setPreview(doc);
    } catch (e) {
      if (id === token.current) setError(e instanceof Error ? e.message : 'Datei konnte nicht gelesen werden.');
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
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
      const a = window.document.createElement('a');
      a.href = url; a.download = filename; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
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
            <span><b>{fileName || 'Datei auswählen'}</b><small>IO, LDR, MPD oder JSON · max. 32 MiB</small></span>
            <input type="file" accept=".io,.ldr,.mpd,.json" disabled={creating} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} data-testid="input-import-file" />
          </label>
          {busy && <div className="fmt-loading" role="status"><LoaderCircle className="spin" size={15} /> Datei wird geprüft …</div>}
          {error && <div className="fmt-error" role="alert" data-testid="status-import-error">{error}</div>}
          {(preview || !busy) && (
            <>
              <p className="fmt-label">{preview ? 'Vorschau' : 'Aktuelles Projekt'}</p>
              <Report model={shown.imported} bricks={shown.bricks.length} />
              {preview && !shown.imported && <p className="fmt-muted">Geprüftes JSON-Projekt: {shown.bricks.length} Steine.</p>}
            </>
          )}
          {preview && (
            <button type="button" className="confirm-button fmt-create" onClick={() => void create()} disabled={creating} data-testid="button-create-imported">
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
        </div>
      </section>
    </div>
  );
}
