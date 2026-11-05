import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { catalogPalette } from '@/features/formats/colors';
import { useCatalog } from '@/features/catalog/client';
import { importDiagnostics } from '@/features/formats/import-diagnostics';
import { useBuilder } from '@/features/editor/useBuilder';
import FinePositionControls from '@/features/editor/FinePositionControls';
import {
  BRICK_DEFINITIONS,
  type BrickType,
  type ToolMode,
} from '@/features/editor/model';
import {
  Box,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Command,
  FilePlus2,
  HardDrive,
  Hammer,
  Layers3,
  LoaderCircle,
  Menu,
  PackageOpen,
  Palette,
  Plus,
  RotateCw,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Redo2,
  X,
  MousePointer2,
} from 'lucide-react';
import '@/components/mobile/editor.css';
import PartsLibrary from '@/features/parts/PartsLibrary';
import FormatDialog from '@/features/formats/FormatDialog';
import ImportPartNotification from '@/features/formats/ImportPartNotification';
import StorageManager from '@/features/storage/StorageManager';
import InventoryPanel from '@/features/inventory/InventoryPanel';
import PrivacyDialog from '@/features/privacy/PrivacyDialog';

const BRICKS = Object.entries(BRICK_DEFINITIONS).map(([type, definition]) => ({
  type: type as BrickType,
  label: definition.label,
  dimensions: `${definition.studsX} × ${definition.studsZ}`,
  studs: definition.studsX * definition.studsZ,
}));

const BuilderCanvas = lazy(() => import('@/features/engine/BuilderCanvas'));

function App() {
  const catalog = useCatalog();
  const COLORS = catalogPalette().map(color => ({ name: color.name, value: color.hex, ldrawCode: color.ldrawCode }));
  const editor = useBuilder();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [partsOpen, setPartsOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [partsTab, setPartsTab] = useState<'ldraw' | 'inventory'>('ldraw');
  const activeInventoryRow = editor.selectedInventory && editor.document.inventory?.id === editor.selectedInventory.listId
    ? editor.document.inventory.rows.find(row => row.id === editor.selectedInventory!.rowId) : undefined;
  useEffect(() => {
    if (!partsOpen) editor.cancelPartPreparation();
  }, [partsOpen, editor.cancelPartPreparation]);

  useEffect(() => {
    const onlineHandler = () => setOnline(true);
    const offlineHandler = () => setOnline(false);
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, []);

  useEffect(() => {
    if (!partsOpen && !colorsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPartsOpen(false);
      setColorsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [partsOpen, colorsOpen]);

  useEffect(() => {
    if (projectMenu) void editor.refreshProjects().catch(() => undefined);
  }, [editor.refreshProjects, projectMenu]);

  const saveProject = async () => {
    setSaveMessage('');
    try {
      await editor.save();
      setSaveMessage('Auf diesem Gerät gespeichert');
      window.setTimeout(() => setSaveMessage(''), 2600);
    } catch {
      setSaveMessage('Speichern fehlgeschlagen');
    }
  };

  const restoreProject = async () => {
    try {
      const restored = await editor.restoreLastProject();
      setRestoreMessage(restored ? 'Letztes Projekt geladen' : 'Kein gespeichertes Projekt gefunden');
    } catch {
      setRestoreMessage('Projekt konnte nicht geladen werden');
    }
    window.setTimeout(() => setRestoreMessage(''), 3000);
    setProjectMenu(false);
  };

  const startProject = async () => {
    try {
      await editor.startNewProject();
      setConfirmNew(false);
      setProjectMenu(false);
    } catch {
      setSaveMessage('Vorheriges Projekt konnte nicht gesichert werden');
    }
  };

  const openProject = async (id: string) => {
    try {
      const opened = await editor.openProject(id);
      setProjectMenu(false);
      if (!opened) setRestoreMessage('Projekt wurde nicht gefunden');
    } catch {
      setRestoreMessage('Projekt konnte nicht geöffnet werden');
    }
    window.setTimeout(() => setRestoreMessage(''), 3000);
  };

  const setMode = (mode: ToolMode) => editor.setToolMode(mode);
  const selectedBrick = BRICKS.find((brick) => brick.type === editor.selectedType) ?? BRICKS[0];
  const selectedColor = COLORS.find(color => color.ldrawCode === editor.selectedColorCode) ??
    COLORS.find((color) => color.value.toLowerCase() === editor.selectedColor.toLowerCase()) ?? { name: "Eigene Farbe", value: editor.selectedColor, ldrawCode: "" };
  const isSelectedColor = (color: typeof COLORS[number]) => editor.selectedColorCode
    ? editor.selectedColorCode === color.ldrawCode
    : editor.selectedColor.toLowerCase() === color.value.toLowerCase();

  if (!editor.isReady) {
    return (
      <main className="editor-shell boot-screen" data-testid="status-loading-project">
        <LoaderCircle className="spin" size={24} />
        <span>Lokales Projekt wird geöffnet …</span>
      </main>
    );
  }

  return (
    <main className="editor-shell workbench-grain" data-testid="editor-workspace">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}icons/brickbuilder-512.png`} alt="" width={30} height={30} />
          </div>
          <span className="brand-name">brick<span>builder</span></span>
          <span className="brand-edition">MOBILE</span>
        </div>

        <div className="project-wrap">
          <button
            type="button"
            className="project-title-button"
            onClick={() => setProjectMenu((open) => !open)}
            aria-expanded={projectMenu}
            data-testid="button-project-menu"
          >
            <span className="project-dot" />
            <span className="project-title" data-testid="text-project-name">{editor.projectName || 'Neues Modell'}</span>
            <ChevronDown size={15} />
          </button>
          {projectMenu && (
            <div className="project-popover rise-in">
              <p className="popover-eyebrow">WORKSHOP</p>
            <label className="rename-label" htmlFor="project-name">Projektname</label>
              <input
                id="project-name"
                className="project-name-input"
                value={editor.projectName}
                onChange={(event) => editor.setProjectName(event.target.value)}
                maxLength={48}
                data-testid="input-project-name"
              />
              <button type="button" className="popover-action" onClick={() => setConfirmNew(true)} data-testid="button-new-project">
                <FilePlus2 size={16} /> Neues Projekt beginnen
              </button>
              <button type="button" className="popover-action" onClick={restoreProject} data-testid="button-restore-project">
                <PackageOpen size={16} /> Letztes Projekt laden
              </button>
              <button type="button" className="popover-action" onClick={() => { setFormatsOpen(true); setProjectMenu(false); }} data-testid="button-open-formats">
                <PackageOpen size={16} /> Datei importieren / exportieren
              </button>
              <button type="button" className="popover-action" onClick={() => { setStorageOpen(true); setProjectMenu(false); }} data-testid="button-open-storage">
                <HardDrive size={16} /> Offline-Speicher verwalten
              </button>
              <button type="button" className="popover-action" onClick={() => { setPrivacyOpen(true); setProjectMenu(false); }} data-testid="button-open-privacy">
                <FilePlus2 size={16} /> Datenschutz (Android)
              </button>
              <div className="saved-projects" aria-label="Gespeicherte Projekte">
                <p>Auf diesem Gerät</p>
                {editor.projects.length ? editor.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="saved-project"
                    onClick={() => void openProject(project.id)}
                    data-testid={`button-open-project-${project.id}`}
                  >
                    <span>{project.name || 'Neues Modell'}</span>
                    <small>{project.brickCount} Steine</small>
                  </button>
                )) : <span className="no-saved-projects">Noch keine Projekte gespeichert</span>}
              </div>
            </div>
          )}
        </div>

        <div className="topbar-end">
          <div className={`connectivity ${online ? 'is-online' : 'is-offline'}`} role="status" data-testid="status-connectivity">
            {online ? <Cloud size={15} /> : <CloudOff size={15} />}
              <span>{online ? 'Offline verfügbar' : 'Offline'}</span>
          </div>
          <button
            type="button"
            className={`save-button ${editor.isSaving ? 'saving' : ''}`}
            onClick={saveProject}
            disabled={editor.isSaving}
            data-testid="button-save"
          >
            {editor.isSaving ? <LoaderCircle className="spin" size={16} /> : saveMessage === 'Auf diesem Gerät gespeichert' ? <Check size={16} /> : <Save size={16} />}
            <span>{editor.isSaving ? 'Speichert' : 'Speichern'}</span>
          </button>
        </div>
      </header>

      <section className="work-area">
        <div className="canvas-stage" aria-label="3D model workspace">
          <div className="canvas-topline">
            <div className="canvas-context">
              <span className="context-label">BAUBEREICH</span>
              <span className="context-divider" />
              <span className="brick-count" data-testid="text-brick-count">{editor.brickCount} {editor.brickCount === 1 ? 'Stein' : 'Steine'}</span>
            </div>
            <div className="history-controls">
              <button type="button" className="icon-button compact" onClick={editor.undo} disabled={!editor.canUndo} aria-label="Undo" data-testid="button-undo">
                <Undo2 size={17} />
              </button>
              <button type="button" className="icon-button compact" onClick={editor.redo} disabled={!editor.canRedo} aria-label="Redo" data-testid="button-redo">
                <Redo2 size={17} />
              </button>
            </div>
          </div>
          <div className="canvas-host">
            <Suspense fallback={<div className="canvas-loading">3D-Arbeitsfläche wird geladen …</div>}>
              <BuilderCanvas
                projectId={editor.document.id}
                bricks={editor.bricks}
                imported={editor.imported}
                selectedId={editor.selectedId}
                selectedType={editor.selectedType}
                selectedColor={editor.selectedColor}
                toolMode={editor.toolMode}
                onPlace={editor.place}
                onSelect={editor.select}
                onMove={editor.move}
              />
            </Suspense>
            {catalog.status === "error" && <div role="status" className="absolute left-3 right-3 top-3 z-10 rounded bg-white p-3 text-sm">Vollständiger Zuordnungskatalog nicht verfügbar. Vorhandene Nachweise bleiben erhalten. <button type="button" onClick={() => setPartsOpen(true)}>Katalog unter „Steine“ erneut laden</button></div>}
            {editor.partError && !partsOpen && <p role="alert" className="canvas-part-error" data-testid="status-part-error">{editor.partError}</p>}
            {editor.imported && (
              <button type="button" className="import-report-button" onClick={() => setFormatsOpen(true)} data-testid="button-import-report">
                LDraw: {editor.imported.instances.length} Teile · {importDiagnostics(editor.imported).warnings.length} Importwarnungen
              </button>
            )}
            {activeInventoryRow && (
              <div className="inventory-mode-banner" role="status" data-testid="status-inventory-mode">
                <span>Meine Teileliste: BL {activeInventoryRow.partId} · Farbe {activeInventoryRow.colorId} · LDraw {editor.selectedInventory!.ldrawId}</span>
                <button type="button" onClick={() => { setPartsTab('inventory'); setPartsOpen(true); }} data-testid="button-inventory-mode-open">Liste</button>
              </div>
            )}
            {editor.brickCount === 0 && (
              <div className="canvas-hint" aria-hidden="true">
                <span className="hint-cross">+</span>
                <span>Raster antippen, um den ersten Stein zu setzen</span>
              </div>
            )}
          </div>
          {editor.selectedId && (
            <div className="mobile-selection-actions" data-testid="mobile-selection-actions">
              <span className="mobile-selection-label"><Box size={14} /> {editor.selectedInstance ? `LDraw ${editor.selectedInstance.part.ldrawId}` : "Stein ausgewählt"}</span>
              <button type="button" onClick={() => editor.changeHeight(0.4)} aria-label="Stein eine Plattenhöhe höher" title="Höher (+1 Platte)">↑</button>
              <button type="button" onClick={() => editor.changeHeight(-0.4)} aria-label="Stein eine Plattenhöhe tiefer" title="Tiefer (−1 Platte)">↓</button>
              <FinePositionControls key={editor.selectedId} onNudge={editor.nudgeSelected} />
              <button type="button" onClick={editor.rotateSelected} aria-label="Ausgewählten Stein drehen" data-testid="mobile-button-rotate"><RotateCw size={17} /></button>
              <button type="button" onClick={editor.deleteSelected} aria-label="Ausgewählten Stein entfernen" data-testid="mobile-button-delete-selected"><Trash2 size={17} /></button>
            </div>
          )}
          <div className="canvas-footline">
            <span className="grid-caption" title="Noppen-Snapping für unterstützte Standardsteine und Platten; sonst Raster"><span className="grid-indicator" /> NOPPEN + RASTER</span>
            <button type="button" className="parts-open-button" onClick={() => setPartsOpen(true)} data-testid="button-open-parts">
              <Layers3 size={16} /><span>Steine</span><span className="parts-count">{activeInventoryRow ? 'Teileliste' : 'LDraw frei'}</span>
            </button>
          </div>
        </div>

        <aside className="tool-rail" aria-label="Bauwerkzeuge">
          <div className="rail-section">
            <div className="section-heading"><span>01</span><h2>Werkzeug</h2></div>
            <div className="tool-segment">
              {([
                { mode: 'build' as const, icon: Hammer, label: 'Bauen' },
                { mode: 'select' as const, icon: MousePointer2, label: 'Auswahl' },
                { mode: 'delete' as const, icon: Trash2, label: 'Löschen' },
              ]).map(({ mode, icon: Icon, label }) => (
                <button
                  key={mode}
                  type="button"
                  className={`tool-option ${editor.toolMode === mode ? 'active' : ''}`}
                  onClick={() => setMode(mode)}
                  aria-pressed={editor.toolMode === mode}
                  data-testid={`button-tool-${mode}`}
                >
                  <Icon size={18} /><span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rail-section parts-section">
            <div className="section-heading"><span>02</span><h2>Stein</h2></div>
            <button type="button" className="active-piece" onClick={() => setPartsOpen(true)} data-testid="button-selected-piece">
              <span aria-hidden="true"><Box size={28} /></span>
              <span className="piece-copy"><strong>{editor.selectedPart ? `LDraw ${editor.selectedPart.ldrawId}` : "LDraw-Teil wählen"}</strong><small>{editor.selectedPart?.name ?? "Offline-Bibliothek öffnen"}</small></span>
              <ChevronDown size={16} className="piece-chevron" />
            </button>
            <div className="color-heading"><span>FARBE</span><span className="color-name">{selectedColor.name}</span></div>
            <div className="color-grid" role="group" aria-label="Steinfarbe" style={{ maxHeight: 180, overflowY: "auto" }}>
              {COLORS.map((color) => (
                <button
                  key={color.ldrawCode}
                  type="button"
                  className={`swatch ${isSelectedColor(color) ? 'selected' : ''}`}
                  style={{ '--swatch-color': color.value } as CSSProperties}
                  aria-label={`${color.name} auswählen`}
                  aria-pressed={isSelectedColor(color)}
                  onClick={() => editor.setSelectedColor(color.value, color.ldrawCode)}
                  data-testid={`button-color-${color.name.toLowerCase()}`}
                >{isSelectedColor(color) && <Check size={13} />}</button>
              ))}
            </div>
          </div>

          <div className="rail-section selection-section">
            <div className="section-heading"><span>03</span><h2>Ausgewählt</h2></div>
            {editor.selectedId ? (
              <>
                <div className="selection-detail" role="status" data-testid="status-selected-brick">
                  <span className="selection-mark"><Box size={16} /></span>
                  <span><strong>{editor.selectedInstance ? `LDraw ${editor.selectedInstance.part.ldrawId}` : `${selectedBrick.dimensions} Stein`}</strong><small>Kann bearbeitet werden</small></span>
                </div>
                <div className="selection-actions">
                  <button type="button" className="selection-action" onClick={() => editor.changeHeight(0.4)} aria-label="Stein eine Plattenhöhe höher">↑ Höher</button>
                  <button type="button" className="selection-action" onClick={() => editor.changeHeight(-0.4)} aria-label="Stein eine Plattenhöhe tiefer">↓ Tiefer</button>
                  <button type="button" className="selection-action" onClick={editor.rotateSelected} data-testid="button-rotate">
                    <RotateCw size={16} /><span>Drehen</span>
                  </button>
                  <button type="button" className="selection-action danger-action" onClick={editor.deleteSelected} data-testid="button-delete-selected">
                    <Trash2 size={16} /><span>Entfernen</span>
                  </button>
                </div>
                <FinePositionControls key={editor.selectedId} onNudge={editor.nudgeSelected} />
              </>
            ) : (
              <div className="selection-empty" data-testid="status-no-selection">
                <span className="empty-symbol"><Command size={16} /></span>
                <span>Wähle einen Stein<br />im Baubereich</span>
              </div>
            )}
          </div>

          <div className="rail-bottom">
            <div className="save-status" role="status" data-testid="status-save">
              <span className={`save-dot ${editor.isSaving ? 'busy' : ''}`} />
              <span>{editor.saveError || saveMessage || (editor.isSaving ? 'Änderungen werden gespeichert' : editor.savedAt ? `Gespeichert ${new Date(editor.savedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Änderungen bleiben auf diesem Gerät')}</span>
            </div>
            {restoreMessage && <div className="toast-note" role="status" data-testid="status-restore">{restoreMessage}</div>}
            <button type="button" className="more-controls" onClick={() => setProjectMenu(true)} data-testid="button-workshop-menu">
              <Settings2 size={16} /><span>Werkstatt</span><Menu size={15} />
            </button>
          </div>
        </aside>
      </section>

      <nav className="mobile-dock" aria-label="Editor tools">
        <button type="button" className="dock-history" onClick={editor.undo} disabled={!editor.canUndo} aria-label="Undo" data-testid="mobile-button-undo"><Undo2 size={19} /></button>
        <button type="button" className={`dock-tool ${editor.toolMode === 'build' ? 'active' : ''}`} onClick={() => setMode('build')} aria-pressed={editor.toolMode === 'build'} data-testid="mobile-button-build"><Hammer size={18} /><span>Bauen</span></button>
        <button type="button" className={`dock-tool ${editor.toolMode === 'select' ? 'active' : ''}`} onClick={() => setMode('select')} aria-pressed={editor.toolMode === 'select'} data-testid="mobile-button-select"><MousePointer2 size={18} /><span>Auswahl</span></button>
        <button type="button" className={`dock-tool dock-delete ${editor.toolMode === 'delete' ? 'active' : ''}`} onClick={() => setMode('delete')} aria-pressed={editor.toolMode === 'delete'} data-testid="mobile-button-delete"><Trash2 size={17} /><span>Löschen</span></button>
        <button
          type="button"
          className="dock-color"
          onClick={() => setColorsOpen(true)}
          aria-label="Steinfarbe auswählen"
          data-testid="mobile-button-colors"
        >
          <span className="dock-color-dot" style={{ '--swatch-color': selectedColor.value } as CSSProperties}><Palette size={13} /></span>
          <span>Farbe</span>
        </button>
        <button type="button" className="dock-parts" onClick={() => setPartsOpen(true)} data-testid="mobile-button-parts"><Plus size={19} /><span>Steine</span></button>
        <button type="button" className="dock-history" onClick={editor.redo} disabled={!editor.canRedo} aria-label="Redo" data-testid="mobile-button-redo"><Redo2 size={19} /></button>
      </nav>

      {colorsOpen && (
        <div className="drawer-scrim color-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setColorsOpen(false); }}>
          <section className="color-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="colors-title" data-testid="drawer-colors">
            <div className="drawer-handle" />
            <div className="drawer-heading">
              <div><p className="popover-eyebrow">STEINFARBE</p><h2 id="colors-title">Farbe auswählen</h2></div>
              <button type="button" className="icon-button" onClick={() => setColorsOpen(false)} aria-label="Farbauswahl schließen" data-testid="button-close-colors"><X size={18} /></button>
            </div>
            <div className="mobile-color-grid" role="group" aria-label="Steinfarbe" style={{ maxHeight: "55vh", overflowY: "auto" }}>
              {COLORS.map((color) => (
                <button
                  key={color.ldrawCode}
                  type="button"
                  className={`mobile-color-option ${isSelectedColor(color) ? 'selected' : ''}`}
                  onClick={() => { editor.setSelectedColor(color.value, color.ldrawCode); setColorsOpen(false); }}
                  data-testid={`mobile-color-${color.name.toLowerCase()}`}
                >
                  <span style={{ '--swatch-color': color.value } as CSSProperties} />
                  <span>{color.name}</span>
                  {isSelectedColor(color) && <Check size={16} />}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {partsOpen && (
        <div className="drawer-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setPartsOpen(false); }}>
          <section className="parts-drawer rise-in" role="dialog" aria-modal="true" aria-labelledby="parts-title" data-testid="drawer-parts">
            <div className="drawer-handle" />
            <div className="drawer-heading">
              <div><p className="popover-eyebrow">DEINE STEINE</p><h2 id="parts-title">Steinauswahl</h2></div>
              <button type="button" className="icon-button" onClick={() => setPartsOpen(false)} aria-label="Steinauswahl schließen" data-testid="button-close-parts"><X size={18} /></button>
            </div>
            <div className="inv-tabs" role="tablist" aria-label="Teilequelle" onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const target = event.key === 'Home' ? 'ldraw' : event.key === 'End' ? 'inventory' : partsTab === 'ldraw' ? 'inventory' : 'ldraw';
              setPartsTab(target);
              window.document.getElementById(`tab-${target}`)?.focus();
            }}>
              <button type="button" role="tab" id="tab-ldraw" tabIndex={partsTab === 'ldraw' ? 0 : -1} aria-controls="panel-ldraw" aria-selected={partsTab === 'ldraw'} onClick={() => setPartsTab('ldraw')} data-testid="tab-ldraw">LDraw-Katalog</button>
              <button type="button" role="tab" id="tab-inventory" tabIndex={partsTab === 'inventory' ? 0 : -1} aria-controls="panel-inventory" aria-selected={partsTab === 'inventory'} onClick={() => setPartsTab('inventory')} data-testid="tab-inventory">Meine Teileliste</button>
            </div>
            {editor.partLoading && <p role="status">LDraw-Geometrie wird geladen …</p>}
            {editor.partError && <p role="alert">{editor.partError}</p>}
            {partsTab === 'inventory' ? (
              <div id="panel-inventory" role="tabpanel" aria-labelledby="tab-inventory">
                <InventoryPanel
                  document={editor.document}
                  selected={editor.selectedInventory}
                  onSelect={editor.selectInventoryPart}
                  onReplace={editor.replacePartsInventory}
                  onSelected={() => setPartsOpen(false)}
                />
              </div>
            ) : (
            <div id="panel-ldraw" role="tabpanel" aria-labelledby="tab-ldraw" aria-label="LDraw-Bibliothek">
                <PartsLibrary
                  online={online}
                  selectedPartId={editor.selectedPart?.ldrawId}
                  loading={editor.partLoading}
                  onSelect={part => { void editor.selectLibraryPart(part).then(success => { if (success) setPartsOpen(false); }); }}
                />
              </div>
            )}
            <p className="drawer-footnote"><span className="local-lock" /> Installierte Teilepakete bleiben offline verfügbar</p>
          </section>
        </div>
      )}

      {confirmNew && (
        <div className="modal-scrim">
          <section className="confirm-card rise-in" role="dialog" aria-modal="true" aria-labelledby="new-project-title" data-testid="dialog-new-project">
            <div className="confirm-icon"><FilePlus2 size={21} /></div>
            <h2 id="new-project-title">Neu anfangen?</h2>
            <p>Dein aktuelles Modell bleibt auf diesem Gerät gespeichert. Ein leeres Projekt wird geöffnet.</p>
            <div className="confirm-actions">
              <button type="button" className="cancel-button" onClick={() => setConfirmNew(false)} data-testid="button-cancel-new">Weiterbauen</button>
              <button type="button" className="confirm-button" onClick={() => void startProject()} data-testid="button-confirm-new">Neues Projekt</button>
            </div>
            <button type="button" className="confirm-close" onClick={() => setConfirmNew(false)} aria-label="Close dialog" data-testid="button-close-new"><X size={17} /></button>
          </section>
        </div>
      )}
      {formatsOpen && <FormatDialog document={editor.document} onClose={() => setFormatsOpen(false)} onImport={editor.importProject} onResolved={editor.resolveImportedProject} />}
      {storageOpen && <StorageManager currentProjectId={editor.document.id} onClose={() => setStorageOpen(false)} onProjectsChanged={editor.refreshProjects} />}
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
      {!formatsOpen && (
        <ImportPartNotification key={editor.document.id} model={editor.imported} floating />
      )}
      <span className="sr-only" data-testid="status-save-message">{saveMessage}</span>
    </main>
  );
}

export default App;
