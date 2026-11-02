import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, FileUp, LoaderCircle, RotateCw, Search, X } from 'lucide-react';
import type { BuilderDocument } from '@/features/editor/model';
import { previewInventory, resolveStoredInventory } from '@/features/catalog/client';
import { allocatedCounts } from './accounting';
import { MAX_LIST_BYTES, MAX_ROWS, type Inventory, type InventoryChoice, type InventoryPreview, type InventoryRow } from './types';
import './inventory.css';

const PAGE = 30;
export const CSV_TEMPLATE = `part_id,color_id,quantity
3001,5,2
`;

interface Props {
  document: BuilderDocument;
  selected: InventoryChoice | null;
  onSelect(choice: InventoryChoice): Promise<boolean>;
  onReplace(inventory: Inventory, expectedProjectId: string): void;
  onSelected(): void;
}

type Pick = { ldrawId?: string; colorCode?: string };

function rowIssue(row: InventoryRow, res: InventoryPreview['resolutions'][string] | undefined): string | null {
  if (row.itemType !== 'P') return `Typ ${row.itemType} ist kein Einzelteil und nicht platzierbar.`;
  if (!res) return `BrickLink ${row.partId}: Zuordnung wird noch geprüft.`;
  if (!res.parts.length && !res.colors.length) return `BrickLink ${row.partId} und Farbe ${row.colorId} sind im Katalog unbekannt.`;
  if (!res.parts.length) return `BrickLink ${row.partId}: kein LDraw-Teil bekannt.`;
  if (!res.colors.length) return `BrickLink-Farbe ${row.colorId}: keine LDraw-Farbe bekannt.`;
  return null;
}

export default function InventoryPanel({ document, selected, onSelect, onReplace, onSelected }: Props) {
  const inventory = document.inventory;
  const projectId = document.id;
  const counts = useMemo(() => allocatedCounts(document), [document]);
  const hasAllocations = useMemo(() => [...counts.values()].some(n => n > 0), [counts]);
  const [resolutions, setResolutions] = useState<InventoryPreview['resolutions'] | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [resolveTick, setResolveTick] = useState(0);
  const [preview, setPreview] = useState<InventoryPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [busyRow, setBusyRow] = useState('');
  const [rowError, setRowError] = useState('');
  const token = useRef(0);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(projectId);
  const previewProjectRef = useRef(projectId);
  projectRef.current = projectId;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; token.current++; };
  }, []);
  useEffect(() => { token.current++; setPreview(null); setImporting(false); setImportError(''); setPicks({}); }, [projectId]);
  useEffect(() => { setPicks({}); setRowError(''); setBusyRow(''); setPage(0); }, [inventory?.id]);

  useEffect(() => {
    if (!inventory) { setResolutions(null); return; }
    let live = true;
    setResolutions(null); setResolveError('');
    resolveStoredInventory(inventory).then(p => { if (live) setResolutions(p.resolutions); })
      .catch(e => { if (live) setResolveError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [inventory?.id, resolveTick]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const my = ++token.current; const pid = projectId;
    setImportError(''); setPreview(null);
    if (!/\.(xml|csv)$/i.test(file.name)) { setImportError('Nur .xml (BrickLink) oder .csv werden unterstützt.'); return; }
    if (file.size > MAX_LIST_BYTES) { setImportError('Teileliste ist größer als 2 MiB.'); return; }
    setImporting(true);
    try {
      const p = await previewInventory(file);
      if (!mounted.current || my !== token.current || pid !== projectRef.current) return;
      previewProjectRef.current = pid;
      setPreview(p);
    } catch (e) {
      if (!mounted.current || my !== token.current || pid !== projectRef.current) return;
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && my === token.current) setImporting(false);
    }
  };

  const cancelImport = () => { token.current++; setImporting(false); setPreview(null); setImportError(''); if (fileRef.current) fileRef.current.value = ''; };

  const confirmImport = () => {
    if (!preview) return;
    try {
      onReplace(preview.inventory, previewProjectRef.current);
      setPreview(null); setPicks({}); setPage(0); setQuery('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setImportError(e instanceof Error ? e.message : String(e)); }
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' }));
    const a = window.document.createElement('a'); a.href = url; a.download = 'teileliste-vorlage.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const rows = inventory?.rows ?? [];
  const availableRows = useMemo(() => rows.filter(row => (counts.get(row.id) ?? 0) < row.quantity), [rows, counts]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return availableRows;
    return availableRows.filter(r => {
      const res = resolutions?.[r.id];
      const hay = [r.partId, r.colorId, ...(res?.parts.map(p => `${p.ldrawId} ${p.name}`) ?? []), ...(res?.colors.map(c => c.name) ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [availableRows, query, resolutions]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  useEffect(() => { setPage(previous => Math.min(previous, pages - 1)); }, [pages]);
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * PAGE, current * PAGE + PAGE);

  const choose = async (row: InventoryRow, ldrawId: string, colorCode: string) => {
    if (!inventory) return;
    const pid = projectId; setBusyRow(row.id); setRowError('');
    try {
      const ok = await onSelect({ listId: inventory.id, rowId: row.id, ldrawId, colorCode });
      if (!mounted.current || pid !== projectRef.current) return;
      if (ok) onSelected(); else setRowError('Teil konnte nicht geladen werden. Bitte erneut versuchen.');
    } catch (e) {
      if (mounted.current) setRowError(e instanceof Error ? e.message : String(e));
    } finally { if (mounted.current) setBusyRow(''); }
  };

  return (
    <div className="inv-panel" data-testid="panel-inventory">
      <section className="inv-import">
        <div className="inv-import-head">
          <div>
            <strong>{inventory ? inventory.name || 'Teileliste' : 'Noch keine Teileliste'}</strong>
            <small>{inventory ? `${rows.length} Zeilen · ${rows.reduce((s, r) => s + r.quantity, 0)} Teile` : 'BrickLink-XML oder CSV, max. 2 MiB und 5000 Zeilen'}</small>
          </div>
          <label className={`inv-file ${hasAllocations ? 'disabled' : ''}`}>
            <FileUp size={15} /> {inventory ? 'Ersetzen' : 'Importieren'}
            <input ref={fileRef} type="file" accept=".xml,.csv,text/xml,text/csv" disabled={hasAllocations || importing}
              onChange={e => void pickFile(e.target.files?.[0])} data-testid="input-inventory-file" />
          </label>
        </div>
        {hasAllocations && <p className="inv-note" data-testid="text-inventory-locked">Die Liste kann nicht ersetzt werden, solange Teile daraus verbaut sind. Entferne diese Teile oder beginne ein neues Projekt.</p>}
        <div className="inv-template">
          <code>part_id,color_id,quantity<br />3001,5,2</code>
          <button type="button" onClick={downloadTemplate} data-testid="button-inventory-template"><Download size={14} /> CSV-Vorlage</button>
        </div>
        {importing && <div className="inv-status" role="status"><LoaderCircle className="spin" size={15} /> Liste wird geprüft … <button type="button" onClick={cancelImport} data-testid="button-inventory-cancel-loading">Abbrechen</button></div>}
        {importError && <div className="inv-error" role="alert" data-testid="status-inventory-import-error">{importError}<button type="button" onClick={() => fileRef.current?.click()}><RotateCw size={13} /> Andere Datei</button></div>}
        {preview && <ImportPreview preview={preview} onCancel={cancelImport} onConfirm={confirmImport} replacing={!!inventory} />}
      </section>

      {inventory && <>
        <p className="inv-note">Die Farbe der Listenzeile bleibt an künftige Platzierungen gebunden. Spätere Farbänderungen an verbauten Teilen füllen den Bestand nicht auf.</p>
        <p className="inv-note">Vollständig verbaute Positionen werden ausgeblendet. Löschen gibt sie wieder frei. Zusätzliche Steine kannst du jederzeit ohne Listenbegrenzung im Tab „LDraw-Katalog“ auswählen.</p>
        <div className="inv-search">
          <Search size={15} />
          <input value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Name, BrickLink-Nr. oder Farbe" aria-label="Teileliste durchsuchen" data-testid="input-inventory-search" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Suche leeren"><X size={14} /></button>}
        </div>
        {resolveError && <div className="inv-error" role="alert">{resolveError}<button type="button" onClick={() => setResolveTick(t => t + 1)} data-testid="button-inventory-retry"><RotateCw size={13} /> Erneut</button></div>}
        {!resolutions && !resolveError && <div className="inv-skeleton" aria-label="Zuordnungen werden geladen">{[0, 1, 2].map(i => <span key={i} />)}</div>}
        {rowError && <p className="inv-error" role="alert">{rowError}</p>}
        {resolutions && (filtered.length === 0
          ? <p className="inv-empty" role="status">{availableRows.length === 0
            ? 'Alle Teile dieser Liste sind verbaut. Wenn du ein zugehöriges Teil löschst, erscheint es hier wieder. Im LDraw-Katalog kannst du weitere Steine ergänzen.'
            : `Keine verfügbare Zeile passt zu „${query}“.`}</p>
          : <ul className="inv-rows" aria-label="Meine Teileliste">
            {visible.map(row => {
              const res = resolutions[row.id];
              const issue = rowIssue(row, res);
              const used = counts.get(row.id) ?? 0;
              const left = Math.max(0, row.quantity - used);
              const pick = picks[row.id] ?? {};
              const ldrawId = res?.parts.length === 1 ? res.parts[0].ldrawId : pick.ldrawId;
              const colorCode = res?.colors.length === 1 ? res.colors[0].ldrawCode : pick.colorCode;
              const color = res?.colors.find(c => c.ldrawCode === colorCode) ?? (res?.colors.length === 1 ? res.colors[0] : undefined);
              const active = selected?.rowId === row.id && selected.listId === inventory.id;
              const ready = !issue && left > 0 && !!ldrawId && !!colorCode;
              const name = res?.parts.find(p => p.ldrawId === ldrawId)?.name ?? res?.parts[0]?.name ?? `BrickLink ${row.partId}`;
              return (
                <li key={row.id} className={`inv-row ${issue ? 'blocked' : ''} ${left === 0 ? 'empty' : ''} ${active ? 'active' : ''}`} data-testid={`row-inventory-${row.id}`}>
                  <div className="inv-row-main">
                    <span className="inv-chip" style={{ background: color?.hex ?? 'transparent' }} aria-hidden="true" />
                    <div className="inv-row-copy">
                      <strong>{name}</strong>
                      <small>BL {row.partId} · Farbe {row.colorId}{color ? ` (${color.name})` : ''}</small>
                    </div>
                    <div className="inv-qty" aria-label={`${left} von ${row.quantity} übrig`}>
                      <b>{left}</b><small>/ {row.quantity}</small>
                    </div>
                  </div>
                  <div className="inv-meter"><span style={{ transform: `scaleX(${row.quantity ? used / row.quantity : 0})` }} /></div>
                  <small className="inv-counts">Gesamt {row.quantity} · Verbaut {used} · Übrig {left}{row.sourceRows.length > 1 ? ` · ${row.sourceRows.length} Quellzeilen zusammengefasst` : ''}</small>
                  {issue && <p className="inv-issue"><AlertTriangle size={13} /> {issue}</p>}
                  {!issue && res && res.parts.length > 1 && (
                    <label className="inv-pick">LDraw-Teil wählen
                      <select value={pick.ldrawId ?? ''} onChange={e => setPicks(p => ({ ...p, [row.id]: { ...p[row.id], ldrawId: e.target.value || undefined } }))} data-testid={`select-inventory-part-${row.id}`}>
                        <option value="">Bitte auswählen …</option>
                        {res.parts.map(p => <option key={p.ldrawId} value={p.ldrawId}>{p.ldrawId} – {p.name}</option>)}
                      </select>
                    </label>)}
                  {!issue && res && res.colors.length > 1 && (
                    <label className="inv-pick">LDraw-Farbe wählen
                      <select value={pick.colorCode ?? ''} onChange={e => setPicks(p => ({ ...p, [row.id]: { ...p[row.id], colorCode: e.target.value || undefined } }))} data-testid={`select-inventory-color-${row.id}`}>
                        <option value="">Bitte auswählen …</option>
                        {res.colors.map(c => <option key={c.ldrawCode} value={c.ldrawCode}>{c.ldrawCode} – {c.name}</option>)}
                      </select>
                    </label>)}
                  {!issue && (
                    <button type="button" className="inv-use" disabled={!ready || !!busyRow} onClick={() => ldrawId && colorCode && void choose(row, ldrawId, colorCode)} data-testid={`button-inventory-use-${row.id}`}>
                      {busyRow === row.id ? <LoaderCircle className="spin" size={14} /> : active ? <Check size={14} /> : null}
                      {left === 0 ? 'Aufgebraucht' : !ldrawId || !colorCode ? 'Erst Auswahl treffen' : active ? 'Aktiv' : 'Damit bauen'}
                    </button>)}
                </li>
              );
            })}
          </ul>)}
        {resolutions && pages > 1 && (
          <div className="inv-pager">
            <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} data-testid="button-inventory-prev">Zurück</button>
            <span>Seite {current + 1} / {pages} · {filtered.length} Zeilen</span>
            <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} data-testid="button-inventory-next">Weiter</button>
          </div>)}
      </>}
      {!inventory && !preview && !importing && <div className="inv-empty-state"><strong>Baue mit deinen echten Teilen.</strong><span>Importiere deine BrickLink-Liste. Jede Platzierung zieht ein Teil vom Bestand ab, Löschen gibt es zurück.</span></div>}
    </div>
  );
}

function ImportPreview({ preview, onCancel, onConfirm, replacing }: { preview: InventoryPreview; onCancel(): void; onConfirm(): void; replacing: boolean }) {
  const rows = preview.inventory.rows;
  const unsupported = rows.filter(r => r.itemType !== 'P');
  const unknown = rows.filter(r => r.itemType === 'P' && (!preview.resolutions[r.id]?.parts.length || !preview.resolutions[r.id]?.colors.length));
  const ambiguous = rows.filter(r => (preview.resolutions[r.id]?.parts.length ?? 0) > 1 || (preview.resolutions[r.id]?.colors.length ?? 0) > 1);
  const merged = rows.filter(r => r.sourceRows.length > 1);
  const [page, setPage] = useState(0);
  const pages = Math.ceil(rows.length / PAGE);
  const current = Math.min(page, pages - 1);
  return (
    <div className="inv-preview" role="region" aria-label="Importvorschau" data-testid="inventory-preview">
      <p className="popover-eyebrow">VORSCHAU – NOCH NICHT ÜBERNOMMEN</p>
      <div className="inv-stats">
        <span><b>{rows.length}</b> Zeilen</span>
        <span><b>{rows.reduce((s, r) => s + r.quantity, 0)}</b> Teile</span>
        <span><b>{merged.length}</b> zusammengefasst</span>
        <span><b>{unsupported.length + unknown.length}</b> nicht platzierbar</span>
        <span><b>{ambiguous.length}</b> mehrdeutig</span>
      </div>
      {rows.length >= MAX_ROWS && <p className="inv-note">Maximal {MAX_ROWS} Zeilen.</p>}
      <ul className="inv-preview-rows" aria-label="Geprüfte Importzeilen">
        {rows.slice(current * PAGE, current * PAGE + PAGE).map(row => {
          const res = preview.resolutions[row.id];
          const issue = rowIssue(row, res);
          return <li key={row.id}>
            <strong>BL {row.partId} · Farbe {row.colorId} · Menge {row.quantity}</strong>
            <span>{res?.parts.map(p => `${p.name} (LDraw ${p.ldrawId})`).join(' / ') || 'Keine belegte Geometriezuordnung'}</span>
            <span>{res?.colors.map(c => `${c.name} (LDraw ${c.ldrawCode})`).join(' / ') || 'Keine belegte Farbzuordnung'}</span>
            <small>Quellzeilen: {row.sourceRows.join(', ')}{row.sourceRows.length > 1 ? ' · Duplikate zusammengefasst' : ''}</small>
            {issue && <span className="inv-issue">{issue} Prüfe die Quellnummern oder verwende ein passendes Einzelteil.</span>}
          </li>;
        })}
      </ul>
      {pages > 1 && <div className="inv-pager">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>Zurück</button>
        <span>Vorschau {current + 1} / {pages}</span>
        <button type="button" disabled={current === pages - 1} onClick={() => setPage(current + 1)}>Weiter</button>
      </div>}
      {ambiguous.length > 0 && <p className="inv-note">Mehrdeutige Zeilen brauchen vor dem Bauen eine ausdrückliche Teil- oder Farbauswahl.</p>}
      <div className="inv-actions">
        <button type="button" className="cancel-button" onClick={onCancel} data-testid="button-inventory-preview-cancel">Abbrechen</button>
        <button type="button" className="confirm-button" onClick={onConfirm} data-testid="button-inventory-preview-confirm">{replacing ? 'Liste ersetzen' : 'Liste übernehmen'}</button>
      </div>
    </div>
  );
}
