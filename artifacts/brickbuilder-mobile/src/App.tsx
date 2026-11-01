import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useBuilder } from '@/features/editor/useBuilder';
import {
  BRICK_DEFINITIONS,
  BRICK_PALETTE,
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
  Grid2X2,
  Hammer,
  Layers3,
  LoaderCircle,
  Menu,
  PackageOpen,
  Palette,
  Plus,
  RotateCw,
  Save,
  Search,
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

const BRICKS = Object.entries(BRICK_DEFINITIONS).map(([type, definition]) => ({
  type: type as BrickType,
  label: definition.label,
  dimensions: `${definition.studsX} × ${definition.studsZ}`,
  studs: definition.studsX * definition.studsZ,
}));

const COLORS = BRICK_PALETTE;
const BuilderCanvas = lazy(() => import('@/features/engine/BuilderCanvas'));

function App() {
  const editor = useBuilder();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [partsOpen, setPartsOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [partsTab, setPartsTab] = useState<'basis' | 'ldraw'>('basis');
  const [projectMenu, setProjectMenu] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [formatsOpen, setFormatsOpen] = useState(false);

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

  const filteredBricks = useMemo(
    () => BRICKS.filter((item) => `${item.label} ${item.dimensions}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );

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
  const selectedColor = COLORS.find((color) => color.value.toLowerCase() === editor.selectedColor.toLowerCase()) ?? COLORS[0];

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
          <div className="brand-mark" aria-hidden="true"><Grid2X2 size={19} strokeWidth={2.3} /></div>
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
                    <small>{project.bricks.length + (project.imported?.instances.length ?? 0)} Steine</small>
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
            {editor.imported && (
              <button type="button" className="import-report-button" onClick={() => setFormatsOpen(true)} data-testid="button-import-report">
                Import: {editor.imported.instances.length} Instanzen · {editor.imported.issues.length} Hinweise / Zuordnungen
              </button>
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
              <span className="mobile-selection-label"><Box size={14} /> Stein ausgewählt</span>
              <button type="button" onClick={editor.rotateSelected} aria-label="Ausgewählten Stein drehen" data-testid="mobile-button-rotate"><RotateCw size={17} /></button>
              <button type="button" onClick={editor.deleteSelected} aria-label="Ausgewählten Stein entfernen" data-testid="mobile-button-delete-selected"><Trash2 size={17} /></button>
            </div>
          )}
          <div className="canvas-footline">
            <span className="grid-caption"><span className="grid-indicator" /> GRID SNAP ON</span>
            <button type="button" className="parts-open-button" onClick={() => setPartsOpen(true)} data-testid="button-open-parts">
              <Layers3 size={16} /><span>Steine</span><span className="parts-count">{BRICKS.length}</span>
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
              <span className={`brick-glyph ${editor.selectedType}`} style={{ '--brick-color': selectedColor.value } as CSSProperties} aria-hidden="true">
                {Array.from({ length: selectedBrick.studs }, (_, index) => <i key={index} />)}
              </span>
              <span className="piece-copy"><strong>{selectedBrick.dimensions}</strong><small>{selectedBrick.label}</small></span>
              <ChevronDown size={16} className="piece-chevron" />
            </button>
            <div className="color-heading"><span>FARBE</span><span className="color-name">{selectedColor.name}</span></div>
            <div className="color-grid" role="group" aria-label="Brick color">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`swatch ${editor.selectedColor.toLowerCase() === color.value.toLowerCase() ? 'selected' : ''}`}
                  style={{ '--swatch-color': color.value } as CSSProperties}
                  aria-label={`${color.name} auswählen`}
                  aria-pressed={editor.selectedColor.toLowerCase() === color.value.toLowerCase()}
                  onClick={() => editor.setSelectedColor(color.value)}
                  data-testid={`button-color-${color.name.toLowerCase()}`}
                >{editor.selectedColor.toLowerCase() === color.value.toLowerCase() && <Check size={13} />}</button>
              ))}
            </div>
          </div>

          <div className="rail-section selection-section">
            <div className="section-heading"><span>03</span><h2>Ausgewählt</h2></div>
            {editor.selectedId ? (
              <>
                <div className="selection-detail" role="status" data-testid="status-selected-brick">
                  <span className="selection-mark"><Box size={16} /></span>
                  <span><strong>{selectedBrick.dimensions} Stein</strong><small>Kann bearbeitet werden</small></span>
                </div>
                <div className="selection-actions">
                  <button type="button" className="selection-action" onClick={editor.rotateSelected} data-testid="button-rotate">
                    <RotateCw size={16} /><span>Drehen</span>
                  </button>
                  <button type="button" className="selection-action danger-action" onClick={editor.deleteSelected} data-testid="button-delete-selected">
                    <Trash2 size={16} /><span>Entfernen</span>
                  </button>
                </div>
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
            <div className="mobile-color-grid" role="group" aria-label="Steinfarbe">
              {COLORS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`mobile-color-option ${editor.selectedColor.toLowerCase() === color.value.toLowerCase() ? 'selected' : ''}`}
                  onClick={() => { editor.setSelectedColor(color.value); setColorsOpen(false); }}
                  data-testid={`mobile-color-${color.name.toLowerCase()}`}
                >
                  <span style={{ '--swatch-color': color.value } as CSSProperties} />
                  <span>{color.name}</span>
                  {editor.selectedColor.toLowerCase() === color.value.toLowerCase() && <Check size={16} />}
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
            <div className="drawer-tabs" role="tablist" aria-label="Steinquelle">
              <button type="button" role="tab" id="tab-basis" aria-controls="panel-basis" aria-selected={partsTab === 'basis'} onClick={() => setPartsTab('basis')} data-testid="tab-parts-basis">Baukasten</button>
              <button type="button" role="tab" id="tab-ldraw" aria-controls="panel-ldraw" aria-selected={partsTab === 'ldraw'} onClick={() => setPartsTab('ldraw')} data-testid="tab-parts-ldraw">LDraw-Bibliothek</button>
            </div>
            {partsTab === 'basis' ? (
              <div role="tabpanel" id="panel-basis" aria-labelledby="tab-basis">
              <label className="search-field">
                <Search size={17} />
                <input type="search" placeholder="Stein suchen" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Steine suchen" data-testid="input-search-parts" />
                {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search" data-testid="button-clear-search"><X size={15} /></button>}
              </label>
              <div className="drawer-list">
                {filteredBricks.length ? filteredBricks.map((brick) => (
                  <button
                    type="button"
                    key={brick.type}
                    className={`drawer-piece ${editor.selectedType === brick.type ? 'chosen' : ''}`}
                    onClick={() => { editor.setSelectedType(brick.type); setMode('build'); setPartsOpen(false); }}
                    data-testid={`button-part-${brick.type}`}
                  >
                    <span className={`brick-glyph ${brick.type}`} style={{ '--brick-color': selectedColor.value } as CSSProperties} aria-hidden="true">
                      {Array.from({ length: brick.studs }, (_, index) => <i key={index} />)}
                    </span>
                    <span className="drawer-piece-copy"><strong>{brick.label}</strong><small>{brick.dimensions} Noppen · {brick.studs} Verbindungspunkte</small></span>
                    {editor.selectedType === brick.type ? <Check size={17} className="chosen-check" /> : <Plus size={17} className="add-glyph" />}
                  </button>
                )) : (
                  <div className="drawer-empty" data-testid="status-no-parts">
                    <Search size={21} /><strong>Keine passenden Steine</strong><span>Versuche eine Größe wie 2 × 4.</span>
                  </div>
                )}
              </div>
                </div>
            ) : (
              <div role="tabpanel" id="panel-ldraw" aria-labelledby="tab-ldraw">
                <PartsLibrary
                  online={online}
                  selectedType={editor.selectedType}
                  onSelect={(type) => { editor.setSelectedType(type); setMode('build'); setPartsOpen(false); }}
                />
              </div>
            )}
            <p className="drawer-footnote"><span className="local-lock" /> Die Auswahl wird lokal gespeichert</p>
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
      {!formatsOpen && (
        <ImportPartNotification key={editor.document.id} model={editor.imported} floating />
      )}
      <span className="sr-only" data-testid="status-save-message">{saveMessage}</span>
    </main>
  );
}

export default App;
