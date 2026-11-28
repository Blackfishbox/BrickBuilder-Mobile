import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ViewExporter } from '@/features/engine/view-export';
import { catalogPalette } from '@/features/formats/colors';
import { useCatalog } from '@/features/catalog/client';
import { useBuilder } from '@/features/editor/useBuilder';
import FinePositionControls from '@/features/editor/FinePositionControls';
import TiltControls from '@/features/editor/TiltControls';
import DraggablePanel from '@/features/editor/DraggablePanel';
import GroupSelectionItem, { type GroupSelectionTarget } from '@/features/editor/GroupSelectionItem';
import {
  BRICK_DEFINITIONS,
  type BrickType,
  type ToolMode,
} from '@/features/editor/model';
import {
  Box,
  Check,
  ChevronDown,
  Command,
  LoaderCircle,
  Monitor,
  Settings2,
  Star,
  Moon,
  X,
} from 'lucide-react';
import '@/components/mobile/editor.css';
import PartsLibrary from '@/features/parts/PartsLibrary';
import FormatDialog from '@/features/formats/FormatDialog';
import ImportPartNotification from '@/features/formats/ImportPartNotification';
import StorageManager from '@/features/storage/StorageManager';
import InventoryPanel from '@/features/inventory/InventoryPanel';
import PrivacyDialog from '@/features/privacy/PrivacyDialog';
import GestureHelpDialog from '@/features/engine/GestureHelpDialog';
import EvidencedColorPicker from '@/features/catalog/EvidencedColorPicker';
import { resolveColor } from '@/features/formats/colors';
import {
  applyColorTheme,
  nextColorThemePreference,
  readColorTheme,
  readSystemColorTheme,
  watchSystemColorTheme,
  type ColorTheme,
  type ColorThemePreference,
} from '@/platform/color-theme';
import { useI18n } from '@/i18n/I18nProvider';
import { isAndroidBuild } from '@/features/privacy/geometry-consent';
import { isGeneratedProjectName } from '@/i18n/project-name';
import { rotationAnchors } from '@/features/connections/rotation-anchors';
import { importedControlAngles, importedRotationOffset, importedTiltOffset } from '@/features/editor/imported-control-angles';
import { displayColorName } from '@/features/catalog/color-evidence';
import type { InstructionPart } from '@/features/instructions/parts';
import type { PreparedExport } from '@/platform/export-file';
import { sharePreparedExport } from '@/platform/export-file';
import { watchForOpenedIOFiles } from '@/platform/io-file-open';
import PremiumDialog from '@/features/premium/PremiumDialog';
import { usePremium } from '@/features/premium/usePremium';
import { nextEdgeMode, readEdgeModePreference, type EdgeMode } from '@/features/engine/edge-mode';
import { CONTROL_SYMBOLS } from '@/features/engine/control-symbols';

const BRICKS = Object.entries(BRICK_DEFINITIONS).map(([type, definition]) => ({
  type: type as BrickType,
  label: definition.label,
  dimensions: `${definition.studsX} × ${definition.studsZ}`,
  studs: definition.studsX * definition.studsZ,
}));

const BuilderCanvas = lazy(() => import('@/features/engine/BuilderCanvas'));
const InstructionsPanel = lazy(() => import('@/features/instructions/InstructionsPanel'));
const THICK_EDGES_STORAGE_KEY = "brickbuilder-thick-edges";

function readEdgesPreference(): EdgeMode {
  try { return readEdgeModePreference(window.localStorage.getItem(THICK_EDGES_STORAGE_KEY)); }
  catch { return "off"; }
}

function App() {
  const { locale, setLocale, t } = useI18n();
  const premium = usePremium();
  const [premiumOpen, setPremiumOpen] = useState(false);
  const catalog = useCatalog();
  const COLORS = catalogPalette().map(color => ({ name: color.name, value: color.hex, ldrawCode: color.ldrawCode }));
  const editor = useBuilder();
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const displayedProjectName = isGeneratedProjectName(editor.projectName) ? t("project.new") : editor.projectName;
  const [projectNameDraft, setProjectNameDraft] = useState(editor.projectName);
  const [projectNameEditing, setProjectNameEditing] = useState(false);
  const [themePreference, setThemePreference] = useState<ColorThemePreference>(readColorTheme);
  const [systemTheme, setSystemTheme] = useState<ColorTheme>(readSystemColorTheme);
  const theme = themePreference === "system" ? systemTheme : themePreference;
  const [edgeMode, setEdgeMode] = useState(readEdgesPreference);
  const [partsOpen, setPartsOpen] = useState(false);
  const [colorsOpen, setColorsOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(false);
  const projectMenuOpenerRef = useRef<HTMLButtonElement | null>(null);
  const colorDrawerOpenerRef = useRef<HTMLElement | null>(null);
  const colorDrawerRef = useRef<HTMLElement | null>(null);
  const partsDrawerOpenerRef = useRef<HTMLElement | null>(null);
  const partsDrawerRef = useRef<HTMLElement | null>(null);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const languageOptionEnRef = useRef<HTMLButtonElement | null>(null);
  const languageOptionDeRef = useRef<HTMLButtonElement | null>(null);
  const selectLanguage = (language: "en" | "de") => {
    setLocale(language);
    setLanguageMenuOpen(false);
    languageMenuTriggerRef.current?.focus();
  };
  const handleLanguageMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = [languageOptionEnRef.current, languageOptionDeRef.current];
    if (event.key === "Enter" || event.key === " ") {
      const activeOption = options.find(option => option === document.activeElement);
      if (!activeOption) return;
      event.preventDefault();
      activeOption.click();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const activeIndex = options.indexOf(document.activeElement as HTMLButtonElement | null);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? options.length - 1
        : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[nextIndex]?.focus();
  };
  const [confirmNew, setConfirmNew] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [formatsOpen, setFormatsOpen] = useState(false);
  const [externalImportFile, setExternalImportFile] = useState<File | null>(null);
  const viewExporterRef = useRef<ViewExporter | null>(null);
  const instructionExportRef = useRef<PreparedExport | null>(null);
  const [formatsMode, setFormatsMode] = useState<'import' | 'export'>('import');
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [finePositionOpen, setFinePositionOpen] = useState(false);
  const [groupSelectionOpen, setGroupSelectionOpen] = useState(false);
  const [tiltControlsOpen, setTiltControlsOpen] = useState(false);
  const openRotationForRef = useRef<string | null>(null);
  const [rotationPivot, setRotationPivot] = useState<[number, number, number] | null>(null);
  const [storageOpen, setStorageOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [gestureHelpOpen, setGestureHelpOpen] = useState(false);
  const [partsTab, setPartsTab] = useState<'ldraw' | 'inventory'>('ldraw');
  const [additionalSelectionIds, setAdditionalSelectionIds] = useState<string[]>([]);
  const [rotationTargetQuery, setRotationTargetQuery] = useState("");
  const selectionMenuAnchorUpdateRef = useRef(false);
  useEffect(() => { setFinePositionOpen(false); }, [editor.selectedId, editor.toolMode]);
  useEffect(() => {
    if (selectionMenuAnchorUpdateRef.current) {
      selectionMenuAnchorUpdateRef.current = false;
      return;
    }
    setGroupSelectionOpen(false);
    setAdditionalSelectionIds([]);
  }, [editor.selectedId, editor.toolMode]);
  useEffect(() => {
    if (openRotationForRef.current === editor.selectedId) {
      openRotationForRef.current = null;
      return;
    }
    setTiltControlsOpen(false);
  }, [editor.selectedId, editor.toolMode]);
  useEffect(() => { setAdditionalSelectionIds([]); setRotationTargetQuery(""); }, [editor.document.id]);
  useEffect(() => { setRotationTargetQuery(""); }, [editor.selectedId]);
  useEffect(() => watchSystemColorTheme(setSystemTheme), []);
  useEffect(() => { applyColorTheme(themePreference, document, undefined, systemTheme); }, [themePreference, systemTheme]);
  useEffect(() => {
    if (!languageMenuOpen) return;
    (locale === "en" ? languageOptionEnRef : languageOptionDeRef).current?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || event.target.closest(".language-menu")) return;
      setLanguageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLanguageMenuOpen(false);
        languageMenuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [languageMenuOpen]);
  useEffect(() => {
    let active = true;
    let listener: { remove(): Promise<void> } | null = null;
    void watchForOpenedIOFiles(
      file => {
        if (!active) return;
        setExternalImportFile(file);
        setFormatsMode('import');
        setFormatsOpen(true);
        setProjectMenu(false);
      },
      () => {
        if (!active) return;
        setRestoreMessage(t('format.readFailure'));
        window.setTimeout(() => setRestoreMessage(''), 3000);
      },
    ).then(handle => {
      if (!active) { void handle?.remove(); return; }
      listener = handle;
    }).catch(() => {
      if (active) {
        setRestoreMessage(t('format.readFailure'));
        window.setTimeout(() => setRestoreMessage(''), 3000);
      }
    });
    return () => {
      active = false;
      void listener?.remove();
    };
  }, [t]);
  useEffect(() => {
    if (!finePositionOpen && !groupSelectionOpen && !tiltControlsOpen) return;
    const closeMenusOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target;
      let dismissedMenu = false;
      if (finePositionOpen && !target.closest(".fine-position-toggle, .fine-position-panel")) {
        setFinePositionOpen(false);
        dismissedMenu = true;
      }
      if (groupSelectionOpen && !target.closest(".rotation-selection-toggle, .rotation-selection-panel")) {
        setGroupSelectionOpen(false);
        dismissedMenu = true;
      }
      if (tiltControlsOpen && !target.closest(".tilt-controls-toggle, .tilt-panel")) {
        setTiltControlsOpen(false);
        dismissedMenu = true;
      }
      // The first outside tap only dismisses the panel. Do not let the same
      // pointerdown reach the 3D canvas and change its selected part.
      if (dismissedMenu) event.stopPropagation();
    };
    document.addEventListener("pointerdown", closeMenusOutside, true);
    return () => document.removeEventListener("pointerdown", closeMenusOutside, true);
  }, [finePositionOpen, groupSelectionOpen, tiltControlsOpen]);
  const availableRotationTargets = useMemo<GroupSelectionTarget[]>(() => {
    const palette = catalogPalette();
    const localTargets: GroupSelectionTarget[] = editor.document.bricks.map(brick => {
      const definition = BRICK_DEFINITIONS[brick.type];
      const name = t(brick.type === "brick-2x4" ? "brick.classic" :
        brick.type === "brick-2x2" ? "brick.square" : "brick.narrow");
      const color = palette.find(entry => entry.hex.toLowerCase() === brick.color.toLowerCase());
      const colorName = displayColorName(color?.name ?? t("color.custom"));
      const imageEntry: InstructionPart = {
        kind: "legacy", part: brick, count: 1, number: definition.ldrawId,
        colorName, colorHex: brick.color,
        key: JSON.stringify(["legacy", brick.type, brick.color.toLowerCase()]),
      };
      return {
        id: brick.id, number: definition.ldrawId, name, colorName, colorHex: brick.color,
        searchText: `${definition.ldrawId} ${name} ${colorName}`, imageEntry,
      };
    });
    const importedTargets: GroupSelectionTarget[] = (editor.document.imported?.instances ?? []).map(instance => {
      const resolvedColor = instance.color ?? resolveColor(instance.colorCode);
      const colorName = displayColorName(resolvedColor?.name ?? instance.colorCode);
      const colorHex = resolvedColor?.hex ?? "#ff00ff";
      const name = instance.part.name?.trim() || t("editor.part");
      const imageEntry: InstructionPart = {
        kind: "imported", part: instance, count: 1, number: instance.part.ldrawId,
        colorName, colorHex,
        key: JSON.stringify(["imported", instance.reference.replaceAll("\\", "/").toLowerCase(),
          instance.colorCode, resolvedColor?.hex, instance.part.brickLinkId, instance.part.status]),
      };
      return {
        id: instance.id, number: instance.part.ldrawId, name, colorName, colorHex,
        searchText: `${instance.part.ldrawId} ${instance.part.brickLinkId ?? ""} ${name} ${colorName}`,
        imageEntry,
      };
    });
    return [...localTargets, ...importedTargets];
  }, [catalog, editor.document, locale]);
  const rotationTargetIds = useMemo(() => editor.selectedId
    ? [editor.selectedId, ...additionalSelectionIds.filter(id =>
      id !== editor.selectedId && availableRotationTargets.some(target => target.id === id))]
    : [], [editor.selectedId, additionalSelectionIds, availableRotationTargets]);
  const selectionIdSet = useMemo(() => new Set(rotationTargetIds), [rotationTargetIds]);
  const toggleSelectionTarget = (id: string, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...rotationTargetIds, id])]
      : rotationTargetIds.filter(selectedId => selectedId !== id);
    if (id === editor.selectedId && !checked) {
      if (!nextIds.length) return;
      selectionMenuAnchorUpdateRef.current = true;
      setAdditionalSelectionIds(nextIds.slice(1));
      editor.select(nextIds[0]);
      return;
    }
    setAdditionalSelectionIds(nextIds.filter(selectedId => selectedId !== editor.selectedId));
  };
  const toggleCanvasSelection = (id: string | null) => {
    if (id === null) {
      setAdditionalSelectionIds([]);
      editor.select(null);
      return;
    }
    if (!selectionIdSet.has(id)) {
      if (!editor.selectedId) {
        editor.select(id);
        return;
      }
      setAdditionalSelectionIds([...rotationTargetIds, id].filter(selectedId => selectedId !== editor.selectedId));
      return;
    }
    const nextIds = rotationTargetIds.filter(selectedId => selectedId !== id);
    if (id === editor.selectedId) {
      if (!nextIds.length) {
        setAdditionalSelectionIds([]);
        editor.select(null);
        return;
      }
      selectionMenuAnchorUpdateRef.current = true;
      setAdditionalSelectionIds(nextIds.slice(1));
      editor.select(nextIds[0]);
      return;
    }
    setAdditionalSelectionIds(nextIds.filter(selectedId => selectedId !== editor.selectedId));
  };
  const rotationSelection = (mobile = false) => (
    <div key={`rotation-selection-${editor.selectedId ?? "none"}-${editor.toolMode}`}
      className={`rotation-selection${mobile ? " rotation-selection-mobile" : ""}`}
      data-open={groupSelectionOpen} data-testid={mobile ? "group-selection-menu" : undefined}>
      <button type="button" className={`rotation-selection-toggle${groupSelectionOpen ? " is-open" : ""}`} aria-expanded={groupSelectionOpen}
        aria-controls={`rotation-selection-panel-${mobile ? "mobile" : "desktop"}`}
        aria-label={t("group.open")} title={t("group.title")} data-testid="button-group-selection"
        onClick={() => setGroupSelectionOpen(value => !value)}>
        <CONTROL_SYMBOLS.group size={17} aria-hidden="true" />
      </button>
      <DraggablePanel className="rotation-selection-panel"
        panelId={`rotation-selection-panel-${mobile ? "mobile" : "desktop"}`}
        title={t("group.title")} headingClassName="rotation-selection-heading"
        handleTestId={`button-move-group-panel-${mobile ? "mobile" : "desktop"}`}
        portalOnMobile={mobile}
        hidden={!groupSelectionOpen}>
        <label className="rotation-selection-search">
          <span className="sr-only">{t("group.search")}</span>
          <input aria-label={t("group.search")} value={rotationTargetQuery}
            onChange={event => setRotationTargetQuery(event.target.value)} placeholder={t("editor.idOrName")} />
        </label>
        <p>{t("group.selectedSummary", { count: rotationTargetIds.length })}</p>
        <div className="rotation-selection-list">
          {availableRotationTargets.filter(target =>
            target.searchText.toLowerCase().includes(rotationTargetQuery.trim().toLowerCase())).map(target => (
            <GroupSelectionItem key={target.id} target={target} document={editor.document}
              checked={selectionIdSet.has(target.id)}
              onChange={checked => toggleSelectionTarget(target.id, checked)} />
          ))}
        </div>
      </DraggablePanel>
    </div>
  );
  const colorInstances = editor.imported?.instances.filter(instance => selectionIdSet.has(instance.id)) ?? [];
  const colorBricks = editor.document.bricks.filter(brick => selectionIdSet.has(brick.id));
  const selectedLegacy = editor.document.bricks.find(brick => brick.id === editor.selectedId);
  const importedAngles = editor.selectedInstance ? importedControlAngles(editor.selectedInstance) : null;
  const rotationControlValue = importedAngles?.rotationY ?? selectedLegacy?.rotation ?? 0;
  const tiltXControlValue = importedAngles?.tiltX ?? selectedLegacy?.tiltX ?? 0;
  const tiltZControlValue = importedAngles?.tiltZ ?? selectedLegacy?.tiltZ ?? 0;
  const applyRotationControl = (angle: number) => editor.setSelectedRotation(
    importedAngles ? importedRotationOffset(angle, importedAngles.baseRotationY) : angle,
    rotationTargetIds,
    rotationPivot,
  );
  const applyTiltControl = (axis: "x" | "z", angle: number) => editor.setSelectedTilt(
    axis,
    importedAngles ? importedTiltOffset(angle, axis === "x" ? importedAngles.baseTiltX : importedAngles.baseTiltZ) : angle,
  );
  const availableRotationAnchors = useMemo(() => editor.selectedInstance && editor.imported
    ? rotationAnchors(editor.selectedInstance.reference, editor.imported) : [],
  [editor.selectedInstance?.reference, editor.imported]);
  useEffect(() => {
    const savedPivot = editor.selectedInstance?.rotationPivot;
    setRotationPivot(savedPivot && availableRotationAnchors.some(anchor =>
      anchor.id === savedPivot.map(value => Math.round(value * 1000) / 1000).join(","))
      ? savedPivot : null);
  }, [editor.selectedId, editor.document.id]);
  const selectedPartNumber = editor.selectedInstance?.part.ldrawId
    ?? (selectedLegacy ? BRICK_DEFINITIONS[selectedLegacy.type].ldrawId : editor.selectedPart?.ldrawId);
  const colorReferences = [
    ...colorInstances.map(instance => instance.part.ldrawId),
    ...colorBricks.map(brick => BRICK_DEFINITIONS[brick.type].ldrawId),
  ];
  if (!colorReferences.length && editor.selectedPart?.ldrawId) colorReferences.push(editor.selectedPart.ldrawId);
  const currentColors = colorInstances.length || colorBricks.length ? [
    ...colorInstances.map(instance => ({
    ldrawCode: instance.colorCode, name: instance.color?.name ?? resolveColor(instance.colorCode)?.name ?? `LDraw ${instance.colorCode}`,
    value: instance.color?.hex ?? resolveColor(instance.colorCode)?.hex ?? "#ff00ff",
    })),
    ...colorBricks.map(brick => ({
      ldrawCode: `0x2${brick.color.replace("#", "").toUpperCase()}`,
      name: displayColorName(COLORS.find(color => color.value.toLowerCase() === brick.color.toLowerCase())?.name ?? t("color.custom")),
      value: brick.color,
    })),
  ] : [{ name: resolveColor(editor.selectedColorCode ?? "")?.name ?? t("color.custom"),
    value: editor.selectedColor, ldrawCode: editor.selectedColorCode ?? "" }];
  const closeColorDrawer = () => {
    setColorsOpen(false);
    colorDrawerOpenerRef.current?.focus();
  };
  const openColorDrawer = (opener: HTMLElement) => {
    colorDrawerOpenerRef.current = opener;
    setColorsOpen(true);
  };
  const colorPicker = (mobile = false) => <EvidencedColorPicker palette={COLORS} current={currentColors}
    references={colorReferences} locked={false} mobile={mobile}
    onChange={color => {
      editor.setSelectedColor(color.value, color.ldrawCode, rotationTargetIds);
      if (mobile) closeColorDrawer();
    }} />;
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
      if (partsOpen && event.key === 'Tab') {
        const drawer = partsDrawerRef.current;
        if (!drawer) return;
        const focusable = [...drawer.querySelectorAll<HTMLElement>(
          'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
        )].filter(element =>
          element.tabIndex >= 0
          && !element.matches(':disabled')
          && !element.closest('[hidden], [inert], [aria-hidden="true"]')
          && !(element instanceof HTMLInputElement && element.type === 'hidden'),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const activeIndex = focusable.indexOf(active as HTMLElement);

        if (!first) {
          event.preventDefault();
          drawer.focus();
        } else if (!drawer.contains(active) || activeIndex === -1) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      if (partsOpen) {
        setPartsOpen(false);
        partsDrawerOpenerRef.current?.focus();
      }
      if (colorsOpen) closeColorDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [partsOpen, colorsOpen]);

  useLayoutEffect(() => {
    if (!colorsOpen) return;
    const drawer = colorDrawerRef.current;
    const search = drawer?.querySelector<HTMLElement>('input[type="search"]');
    const closeButton = drawer?.querySelector<HTMLElement>('.drawer-heading .icon-button');
    (search ?? closeButton)?.focus();
  }, [colorsOpen]);

  useLayoutEffect(() => {
    if (!partsOpen) return;
    const drawer = partsDrawerRef.current;
    if (!drawer) return;
    if (drawer.contains(document.activeElement)) return;
    const selectedTab = drawer.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const firstFocusable = [...drawer.querySelectorAll<HTMLElement>(
      'a[href], area[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    )].find(element =>
      element.tabIndex >= 0
      && !element.matches(':disabled')
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && !(element instanceof HTMLInputElement && element.type === 'hidden'),
    );
    (selectedTab ?? firstFocusable)?.focus();
  });

  useEffect(() => {
    if (projectMenu) void editor.refreshProjects().catch(() => undefined);
  }, [editor.refreshProjects, projectMenu]);

  const saveProject = async () => {
    setSaveMessage('');
    try {
      await editor.save();
      setSaveMessage(t("save.saved"));
      window.setTimeout(() => setSaveMessage(''), 2600);
    } catch {
      setSaveMessage(t("save.failed"));
    }
  };

  const closeProjectMenu = (restoreFocus = false) => {
    setProjectMenu(false);
    if (restoreFocus) projectMenuOpenerRef.current?.focus();
  };

  const openPartsDrawer = (opener: HTMLElement) => {
    partsDrawerOpenerRef.current = opener;
    setPartsOpen(true);
  };

  const startProject = async () => {
    try {
      await editor.startNewProject();
      setConfirmNew(false);
      setProjectMenu(false);
    } catch {
      setSaveMessage(t("save.previousFailed"));
    }
  };

  const openProject = async (id: string) => {
    try {
      const opened = await editor.openProject(id);
      setProjectMenu(false);
      if (!opened) setRestoreMessage(t("project.notFound"));
    } catch {
      setRestoreMessage(t("project.openFailed"));
    }
    window.setTimeout(() => setRestoreMessage(''), 3000);
  };

  const setMode = (mode: ToolMode) => editor.setToolMode(mode);
  const selectedBrick = BRICKS.find((brick) => brick.type === editor.selectedType) ?? BRICKS[0];
  const selectedColor = COLORS.find(color => color.ldrawCode === editor.selectedColorCode) ??
    COLORS.find((color) => color.value.toLowerCase() === editor.selectedColor.toLowerCase()) ?? { name: t("color.custom"), value: editor.selectedColor, ldrawCode: "" };

  if (!editor.isReady) {
    return (
        <main className="editor-shell boot-screen" data-testid="status-loading-project">
        <LoaderCircle className="spin" size={24} />
        <span>{t("editor.loading")}</span>
      </main>
    );
  }

  return (
    <main className="editor-shell workbench-grain" data-testid="editor-workspace">
      <header className="topbar">
        <div className="project-wrap">
          <button
            type="button"
            className="project-title-button"
            onClick={(event) => {
              if (projectMenu) {
                closeProjectMenu();
                return;
              }
              projectMenuOpenerRef.current = event.currentTarget;
              setProjectMenu(true);
            }}
            aria-expanded={projectMenu}
            aria-controls="project-menu"
            data-testid="button-project-menu"
          >
            <CONTROL_SYMBOLS.projectMenu size={18} aria-hidden="true" />
            <span className="project-title" data-testid="text-project-name">{displayedProjectName}</span>
            <ChevronDown size={15} />
          </button>
          {projectMenu && (
          <div
            id="project-menu"
            className="project-popover rise-in"
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              closeProjectMenu(true);
            }}
            onFocusCapture={(event) => {
              if (event.target instanceof HTMLElement) {
                event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
              }
            }}
          >
              <label className="rename-label" htmlFor="project-name">{t("project.name")}</label>
              <input
                id="project-name"
                className="project-name-input"
                value={projectNameEditing ? projectNameDraft : displayedProjectName}
                onFocus={() => {
                  setProjectNameDraft(editor.projectName);
                  setProjectNameEditing(true);
                }}
                onChange={(event) => setProjectNameDraft(event.target.value)}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  setProjectNameEditing(false);
                  if (name) {
                    setProjectNameDraft(name);
                    editor.setProjectName(name);
                  } else {
                    setProjectNameDraft(editor.projectName);
                  }
                }}
                maxLength={48}
                data-testid="input-project-name"
              />
              <button type="button" className="popover-action" onClick={() => setConfirmNew(true)} data-testid="button-new-project">
                <CONTROL_SYMBOLS.newProject size={20} aria-hidden="true" /> {t("project.newAction")}
              </button>
              <button type="button" className="popover-action" onClick={() => { setFormatsMode('import'); setFormatsOpen(true); setProjectMenu(false); }} data-testid="button-open-import">
                <CONTROL_SYMBOLS.importProject size={20} aria-hidden="true" /> {t("project.import")}
              </button>
              <button type="button" className="popover-action" onClick={() => { setFormatsMode('export'); setFormatsOpen(true); setProjectMenu(false); }} data-testid="button-open-export">
                <CONTROL_SYMBOLS.exportProject size={20} aria-hidden="true" /> {t("project.export")}
              </button>
              <button type="button" className="popover-action" onClick={() => { setInstructionsOpen(true); setProjectMenu(false); }} data-testid="button-open-instructions">
                <CONTROL_SYMBOLS.instructions size={20} aria-hidden="true" /> {t("project.instructions")}
              </button>
              <button type="button" className="popover-action" onClick={() => { setStorageOpen(true); setProjectMenu(false); }} data-testid="button-open-storage">
                <CONTROL_SYMBOLS.storage size={20} aria-hidden="true" /> {t("project.storage")}
              </button>
              <button type="button" className="popover-action" onClick={() => { setPrivacyOpen(true); setProjectMenu(false); }} data-testid="button-open-privacy">
                <CONTROL_SYMBOLS.privacy size={20} aria-hidden="true" /> {t(isAndroidBuild() ? "project.privacySettings" : "project.privacy")}
              </button>
              {isAndroidBuild() && !premium.active && (premium.status === "ready" || premium.status === "error") && (
                <button type="button" className="popover-action" onClick={() => { setPremiumOpen(true); setProjectMenu(false); }}
                  data-testid="button-open-premium">
                  <Star size={20} aria-hidden="true" /> {t(premium.status === "error" ? "premium.retry" : "premium.buy")}
                </button>
              )}
            <div className="saved-projects" aria-label={t("editor.savedProjects")}>
                <p>{t("project.device")}</p>
                {editor.projects.length ? editor.projects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="saved-project"
                    onClick={() => void openProject(project.id)}
                    data-testid={`button-open-project-${project.id}`}
                  >
                    <span>{isGeneratedProjectName(project.name) ? t("project.new") : project.name}</span>
                    <small>{t(project.brickCount === 1 ? "project.savedCount.one" : "project.savedCount", { count: project.brickCount })}</small>
                  </button>
                )) : <span className="no-saved-projects">{t("project.empty")}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="topbar-end">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setThemePreference(value => nextColorThemePreference(value))}
            aria-label={themePreference === "system"
              ? t("theme.current.system", { appearance: t(theme === "dark" ? "theme.darkTitle" : "theme.lightTitle") })
              : t(themePreference === "dark" ? "theme.current.dark" : "theme.current.light")}
            title={t(themePreference === "system" ? "theme.next.light" :
              themePreference === "light" ? "theme.next.dark" : "theme.next.system")}
            data-testid="button-toggle-theme"
          >
            {themePreference === "system" ? <Monitor size={17} /> :
              themePreference === "dark" ? <Moon size={17} /> : <CONTROL_SYMBOLS.theme size={17} />}
          </button>
          <div className="language-menu">
            <button
              type="button"
              className="theme-toggle language-toggle"
              ref={languageMenuTriggerRef}
              onClick={() => {
                setProjectMenu(false);
                setLanguageMenuOpen(value => !value);
              }}
              aria-label={t("language")}
              title={t("language")}
              aria-expanded={languageMenuOpen}
              aria-controls="language-dropdown"
              aria-haspopup="menu"
              data-testid="button-language-menu"
          >
              <CONTROL_SYMBOLS.language size={18} />
            </button>
            {languageMenuOpen && (
              <div
                className="language-dropdown rise-in"
                id="language-dropdown"
                role="menu"
                aria-label={t("language")}
                onKeyDown={handleLanguageMenuKeyDown}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  ref={languageOptionEnRef}
                  aria-checked={locale === "en"}
                  data-testid="language-option-en"
                  onClick={() => selectLanguage("en")}
                >
                  {t("english")}
                </button>
                <button
                  type="button"
                  role="menuitemradio"
                  ref={languageOptionDeRef}
                  aria-checked={locale === "de"}
                  data-testid="language-option-de"
                  onClick={() => selectLanguage("de")}
                >
                  {t("german")}
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="theme-toggle gesture-help-toggle"
            onClick={() => { setGestureHelpOpen(true); setProjectMenu(false); }}
            aria-label={t("gesture.help")}
            title={t("gesture.help")}
            aria-haspopup="dialog"
            data-testid="button-gesture-help"
          >
            <CONTROL_SYMBOLS.gestureHelp size={18} />
          </button>
          <button
            type="button"
            className={`save-button ${editor.isSaving ? 'saving' : ''}`}
            onClick={saveProject}
            disabled={editor.isSaving}
            data-testid="button-save"
          >
            {editor.isSaving ? <LoaderCircle className="spin" size={16} /> : saveMessage === t("save.saved") ? <Check size={16} /> : <CONTROL_SYMBOLS.save size={16} />}
            <span>{editor.isSaving ? t("save.saving") : t("save.action")}</span>
          </button>
        </div>
      </header>

      <section className="work-area">
        <div className={`canvas-stage${editor.selectedId && editor.toolMode !== 'view' ? ' has-selection' : ''}`} aria-label={t("canvas.workspace")}>
          <div className="canvas-topline">
            <div className="canvas-context">
              <span className="context-label">{editor.toolMode === 'view' ? t("canvas.view") : t("canvas.buildArea")}</span>
              <span className="context-divider" />
              <span className="brick-count" data-testid="text-brick-count">{t(editor.brickCount === 1 ? "canvas.partCount.one" : "canvas.partCount", { count: editor.brickCount })}</span>
            </div>
            <button type="button" className="thick-edges-toggle"
              aria-pressed={edgeMode !== "off"}
              aria-label={t(`canvas.edges.${edgeMode}`)}
              title={t(`canvas.edges.${edgeMode}`)}
              data-edge-mode={edgeMode}
              data-testid="button-thick-edges"
              onClick={() => {
                const next = nextEdgeMode(edgeMode);
                setEdgeMode(next);
                try { window.localStorage.setItem(THICK_EDGES_STORAGE_KEY, next); } catch { /* Keep the session preference if storage is unavailable. */ }
              }}>
              <CONTROL_SYMBOLS.edges />
              <span className="thick-edges-label">{t("canvas.thickEdges")}</span>
            </button>
            <div className="history-controls">
              <button type="button" className="icon-button compact" onClick={editor.undo} disabled={!editor.canUndo || editor.toolMode === 'view'} aria-label={t("history.undo")} data-testid="button-undo">
                <CONTROL_SYMBOLS.undo size={17} />
              </button>
              <button type="button" className="icon-button compact" onClick={editor.redo} disabled={!editor.canRedo || editor.toolMode === 'view'} aria-label={t("history.redo")} data-testid="button-redo">
                <CONTROL_SYMBOLS.redo size={17} />
              </button>
            </div>
          </div>
          <div className="canvas-host">
              <Suspense fallback={<div className="canvas-loading">{t("canvas.loading")}</div>}>
              {!instructionsOpen && <BuilderCanvas
                viewExporterRef={viewExporterRef}
                showConstructionControls={!finePositionOpen && !groupSelectionOpen && !tiltControlsOpen}
                emptyDoubleTapZoomEnabled={!gestureHelpOpen && !projectMenu && !languageMenuOpen && !partsOpen && !colorsOpen &&
                  !formatsOpen && !instructionsOpen && !storageOpen && !privacyOpen && !premiumOpen && !confirmNew &&
                  !finePositionOpen && !groupSelectionOpen && !tiltControlsOpen}
                projectId={editor.document.id}
                darkMode={theme === 'dark'}
                edgeMode={edgeMode}
                bricks={editor.bricks}
                imported={editor.imported}
                selectedId={editor.selectedId}
                selectedIds={rotationTargetIds}
                selectedRotationAnchor={rotationPivot}
                selectedType={editor.selectedType}
                selectedColor={editor.selectedColor}
                 selectedColorCode={editor.selectedColorCode}
                 placementPreview={editor.placementPreview}
                toolMode={editor.toolMode}
                onPlace={editor.place}
                onSelect={editor.select}
                onToggleSelection={toggleCanvasSelection}
                onViewPartTap={(id) => {
                  editor.setToolMode('select');
                  editor.select(id);
                }}
                onOpenRotationControls={(id) => {
                  openRotationForRef.current = id;
                  editor.setToolMode('select');
                  editor.select(id);
                  setTiltControlsOpen(true);
                }}
                onMove={editor.move}
                onMoveGroup={editor.moveGroup}
              />}
            </Suspense>
            {catalog.status === "error" && <div role="status" className="absolute left-3 right-3 top-3 z-10 rounded bg-white p-3 text-sm">{t("catalog.error")} <button type="button" onClick={(event) => openPartsDrawer(event.currentTarget)}>{t("catalog.retry")}</button></div>}
            {editor.partError && !partsOpen && <p role="alert" className="canvas-part-error" data-testid="status-part-error">{editor.partError}</p>}
            {activeInventoryRow && (
              <div className="inventory-mode-banner" role="status" data-testid="status-inventory-mode">
                <span>{t("inventory.banner", { partId: activeInventoryRow.partId, colorId: activeInventoryRow.colorId, ldrawId: editor.selectedInventory!.ldrawId })}</span>
                <button type="button" onClick={(event) => { setPartsTab('inventory'); openPartsDrawer(event.currentTarget); }} data-testid="button-inventory-mode-open">{t("inventory.open")}</button>
              </div>
            )}
            {editor.brickCount === 0 && (
              <div className="canvas-hint" aria-hidden="true">
                <span className="hint-cross">+</span>
                <span>{editor.toolMode === 'view' ? t("editor.viewHint") : t("editor.tapGrid")}</span>
              </div>
            )}
          </div>
          {editor.selectedId && editor.toolMode !== 'view' && (
            <div className="mobile-selection-actions" data-testid="mobile-selection-actions">
              <span className="mobile-selection-label"><Box size={14} />{selectedPartNumber ?? t("editor.stone")}</span>
              <button type="button" onClick={() => editor.changeHeight(0.4)} aria-label={t("editor.higherOnePlate")} title={t("editor.placeHigher")}><CONTROL_SYMBOLS.heightUp /></button>
              <button type="button" onClick={() => editor.changeHeight(-0.4)} aria-label={t("editor.lowerOnePlate")} title={t("editor.placeLower")}><CONTROL_SYMBOLS.heightDown /></button>
              <FinePositionControls key={`fine-${editor.selectedId}-${editor.toolMode}`} onNudge={editor.nudgeSelected}
                onOpenChange={setFinePositionOpen} open={finePositionOpen} portalOnMobile />
              {rotationSelection(true)}
              <TiltControls key={`tilt-${editor.selectedId}-${editor.toolMode}`} tiltX={tiltXControlValue}
                tiltZ={tiltZControlValue}
                rotationY={rotationControlValue}
                onRotate={applyRotationControl} onTilt={applyTiltControl}
                onRotateStart={editor.beginSelectedRotationEdit} onRotateEnd={editor.endSelectedRotationEdit}
                open={tiltControlsOpen} onOpenChange={setTiltControlsOpen}
                 portalOnMobile
                anchors={availableRotationAnchors} rotationPivot={rotationPivot} onPivotChange={setRotationPivot} />
              <button type="button" onClick={editor.deleteSelected} aria-label={t("editor.deleteSelected")} data-testid="mobile-button-delete-selected"><CONTROL_SYMBOLS.removePart size={17} /></button>
            </div>
          )}
        </div>

        <aside className="tool-rail" aria-label={t("editor.workspace")}>
          <div className="rail-section">
            <div className="section-heading"><span>01</span><h2>{t("editor.tool")}</h2></div>
            <div className="tool-segment">
              {([
                { mode: 'view' as const, icon: CONTROL_SYMBOLS.viewMode, label: t("editor.viewMode") },
                { mode: 'build' as const, icon: CONTROL_SYMBOLS.buildMode, label: t("editor.buildMode") },
                { mode: 'select' as const, icon: CONTROL_SYMBOLS.selectMode, label: t("editor.selectMode") },
                { mode: 'delete' as const, icon: CONTROL_SYMBOLS.deleteMode, label: t("editor.deleteMode") },
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
            <div className="section-heading"><span>02</span><h2>{t("editor.part")}</h2></div>
            <button type="button" className="active-piece" onClick={(event) => openPartsDrawer(event.currentTarget)} data-testid="button-selected-piece">
              <span aria-hidden="true"><Box size={28} /></span>
              <span className="piece-copy"><strong>{editor.selectedPart ? `LDraw ${editor.selectedPart.ldrawId}` : t("editor.choosePart")}</strong><small>{editor.selectedPart?.name ?? t("editor.openOfflineLibrary")}</small></span>
              <ChevronDown size={16} className="piece-chevron" />
            </button>
            <div className="color-heading"><span>{t("editor.color")}</span><span className="color-name">{selectedColor.name}</span></div>
            {colorPicker()}
            {rotationTargetIds.length > 1 && editor.toolMode !== "view" && <button type="button" className="selection-action"
              onClick={event => openColorDrawer(event.currentTarget)}>{t("editor.moreColors")}</button>}
          </div>

          <div className="rail-section selection-section">
            <div className="section-heading"><span>03</span><h2>{t("editor.selected")}</h2></div>
            {editor.selectedId && editor.toolMode !== 'view' ? (
              <>
                <div className="selection-detail" role="status" data-testid="status-selected-brick">
                  <span className="selection-mark"><Box size={16} /></span>
                  <span><strong>{editor.selectedInstance ? editor.selectedInstance.part.ldrawId : `${selectedBrick.dimensions} ${t("editor.stone")}`}</strong><small>{t("editor.editable")}</small></span>
                </div>
                <div className="selection-actions">
                  <button type="button" className="selection-action" onClick={() => editor.changeHeight(0.4)} aria-label={t("editor.higherOnePlate")}><CONTROL_SYMBOLS.heightUp /> {t("editor.higher")}</button>
                  <button type="button" className="selection-action" onClick={() => editor.changeHeight(-0.4)} aria-label={t("editor.lowerOnePlate")}><CONTROL_SYMBOLS.heightDown /> {t("editor.lower")}</button>
                  <button type="button" className="selection-action danger-action" onClick={editor.deleteSelected} data-testid="button-delete-selected">
                    <CONTROL_SYMBOLS.removePart size={16} /><span>{t("editor.remove")}</span>
                  </button>
                </div>
                {rotationSelection()}
                <TiltControls key={`desktop-tilt-${editor.selectedId}-${editor.toolMode}`} tiltX={tiltXControlValue}
                  tiltZ={tiltZControlValue}
                  rotationY={rotationControlValue}
                  onRotate={applyRotationControl} onTilt={applyTiltControl}
                  onRotateStart={editor.beginSelectedRotationEdit} onRotateEnd={editor.endSelectedRotationEdit}
                  open={tiltControlsOpen} onOpenChange={setTiltControlsOpen}
                  anchors={availableRotationAnchors} rotationPivot={rotationPivot} onPivotChange={setRotationPivot} />
                <FinePositionControls key={`desktop-fine-${editor.selectedId}-${editor.toolMode}`} onNudge={editor.nudgeSelected}
                  onOpenChange={setFinePositionOpen} open={finePositionOpen} />
              </>
            ) : (
              <div className="selection-empty" data-testid="status-no-selection">
                <span className="empty-symbol"><Command size={16} /></span>
                <span>{t("editor.emptySelection")}</span>
              </div>
            )}
          </div>

          <div className="rail-bottom">
            <div className="save-status" role="status" data-testid="status-save">
              <span className={`save-dot ${editor.isSaving ? 'busy' : ''}`} />
              <span>{editor.saveError || saveMessage || (editor.isSaving ? t("save.inProgress") : editor.savedAt
                ? t("save.savedAt", { time: new Date(editor.savedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })
                : t("save.localNotice"))}</span>
            </div>
            {restoreMessage && <div className="toast-note" role="status" data-testid="status-restore">{restoreMessage}</div>}
            <button
              type="button"
              className="more-controls"
              onClick={(event) => {
                projectMenuOpenerRef.current = event.currentTarget;
                setProjectMenu(true);
              }}
              aria-expanded={projectMenu}
              aria-controls="project-menu"
              data-testid="button-workshop-menu"
            >
              <Settings2 size={16} /><span>{t("editor.workshop")}</span><CONTROL_SYMBOLS.projectMenu size={15} />
            </button>
          </div>
        </aside>
      </section>

      <nav className="mobile-dock" aria-label={t("editor.workspace")}>
        <button type="button" className="dock-history" onClick={editor.undo} disabled={!editor.canUndo || editor.toolMode === 'view'} aria-label={t("history.undo")} data-testid="mobile-button-undo"><CONTROL_SYMBOLS.undo size={19} /></button>
        <button type="button" className={`dock-tool ${editor.toolMode === 'view' ? 'active' : ''}`} onClick={() => setMode('view')} aria-pressed={editor.toolMode === 'view'} data-testid="mobile-button-view"><CONTROL_SYMBOLS.viewMode size={18} /><span>{t("editor.viewMode")}</span></button>
        <button type="button" className={`dock-tool ${editor.toolMode === 'build' ? 'active' : ''}`} onClick={() => setMode('build')} aria-pressed={editor.toolMode === 'build'} data-testid="mobile-button-build"><CONTROL_SYMBOLS.buildMode size={18} /><span>{t("editor.buildMode")}</span></button>
        <button type="button" className={`dock-tool ${editor.toolMode === 'select' ? 'active' : ''}`} onClick={() => setMode('select')} aria-pressed={editor.toolMode === 'select'} data-testid="mobile-button-select"><CONTROL_SYMBOLS.selectMode size={18} /><span>{t("editor.selectMode")}</span></button>
        <button type="button" className={`dock-tool dock-delete ${editor.toolMode === 'delete' ? 'active' : ''}`} onClick={() => setMode('delete')} aria-pressed={editor.toolMode === 'delete'} data-testid="mobile-button-delete"><CONTROL_SYMBOLS.deleteMode size={17} /><span>{t("editor.deleteMode")}</span></button>
        <button
          type="button"
          className="dock-color"
          onClick={event => openColorDrawer(event.currentTarget)}
          aria-label={t("editor.partColor")}
          data-testid="mobile-button-colors"
        >
          <span className="dock-color-dot" style={{ '--swatch-color': selectedColor.value } as CSSProperties}><CONTROL_SYMBOLS.colorMode size={13} /></span>
          <span>{t("editor.colorMode")}</span>
        </button>
        <button type="button" className="dock-parts" onClick={(event) => openPartsDrawer(event.currentTarget)} data-testid="mobile-button-parts"><CONTROL_SYMBOLS.partsTool size={19} /><span>{t("editor.partsTool")}</span></button>
        <button type="button" className="dock-history" onClick={editor.redo} disabled={!editor.canRedo || editor.toolMode === 'view'} aria-label={t("history.redo")} data-testid="mobile-button-redo"><CONTROL_SYMBOLS.redo size={19} /></button>
      </nav>

      {colorsOpen && (
        <div className="drawer-scrim color-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) closeColorDrawer(); }}>
          <section className="color-drawer rise-in" ref={colorDrawerRef} onFocusCapture={event => {
            if (event.target instanceof HTMLElement) {
              event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            }
          }} role="dialog" aria-modal="true" aria-labelledby="colors-title" data-testid="drawer-colors">
            <div className="drawer-handle" />
            <div className="drawer-heading">
              <div><p className="popover-eyebrow">{t("editor.sectionColor")}</p><h2 id="colors-title">{t("color.title")}</h2></div>
              <button type="button" className="icon-button" onClick={closeColorDrawer} aria-label={t("color.close")} data-testid="button-close-colors"><X size={18} /></button>
            </div>
            {rotationTargetIds.length > 1 && <p className="color-evidence-status" data-testid="text-color-selection-count">
              {t("color.multiSelectionHint", { count: rotationTargetIds.length })}
            </p>}
            {editor.selectedInstance && <p className="color-evidence-status">{t("color.additionalHelp")}</p>}
            {colorPicker(true)}
          </section>
        </div>
      )}

      {partsOpen && (
        <div className="drawer-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) setPartsOpen(false); }}>
          <section className="parts-drawer rise-in" ref={partsDrawerRef} tabIndex={-1} onFocusCapture={event => {
            if (event.target instanceof HTMLElement) {
              event.target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
            }
          }} role="dialog" aria-modal="true" aria-labelledby="parts-title" data-testid="drawer-parts">
            <div className="drawer-handle" />
            <div className="drawer-heading">
              <div><p className="popover-eyebrow">{t("editor.partsSection")}</p><h2 id="parts-title">{t("editor.partSelectionHeading")}</h2></div>
              <button type="button" className="icon-button" onClick={() => setPartsOpen(false)} aria-label={t("editor.closeParts")} data-testid="button-close-parts"><X size={18} /></button>
            </div>
            <div className="inv-tabs" role="tablist" aria-label={t("editor.partsSource")} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const target = event.key === 'Home' ? 'ldraw' : event.key === 'End' ? 'inventory' : partsTab === 'ldraw' ? 'inventory' : 'ldraw';
              setPartsTab(target);
              window.document.getElementById(`tab-${target}`)?.focus();
            }}>
              <button type="button" role="tab" id="tab-ldraw" tabIndex={partsTab === 'ldraw' ? 0 : -1} aria-controls="panel-ldraw" aria-selected={partsTab === 'ldraw'} onClick={() => setPartsTab('ldraw')} data-testid="tab-ldraw">{t("editor.offlineCatalogTab")}</button>
              <button type="button" role="tab" id="tab-inventory" tabIndex={partsTab === 'inventory' ? 0 : -1} aria-controls="panel-inventory" aria-selected={partsTab === 'inventory'} onClick={() => setPartsTab('inventory')} data-testid="tab-inventory">{t("editor.inventoryListTab")}</button>
            </div>
            {editor.partLoading && <p role="status">{t("editor.loadingGeometry")}</p>}
            {editor.partError && <p role="alert">{editor.partError}</p>}
            {partsTab === 'inventory' ? (
              <div id="panel-inventory" role="tabpanel" aria-labelledby="tab-inventory">
                <InventoryPanel
                  document={editor.document}
                  selected={editor.selectedInventory}
                  onSelect={editor.selectInventoryPart}
                  onSpread={editor.spreadInventoryParts}
                  onReplace={editor.replacePartsInventory}
                  onSelected={() => setPartsOpen(false)}
                />
              </div>
            ) : (
            <div id="panel-ldraw" role="tabpanel" aria-labelledby="tab-ldraw" aria-label={t("editor.ldrawLibrary")}>
                <PartsLibrary
                  online={online}
                  selectedPartId={editor.selectedPart?.ldrawId}
                  selectedColor={editor.selectedColor}
                  selectedColorCode={editor.selectedColorCode}
                  paletteRevision={catalog.status}
                  loading={editor.partLoading}
                  selectionError={editor.partError}
                  onSelect={async part => {
                    const success = await editor.selectLibraryPart(part);
                    if (success) setPartsOpen(false);
                    return success;
                  }}
                  onPlaceQuantity={async (part, quantity) => {
                    const success = await editor.placeLibraryQuantity(part, quantity);
                    if (success) setPartsOpen(false);
                    return success ? true : undefined;
                  }}
                />
              </div>
            )}
            <p className="drawer-footnote"><span className="local-lock" /> {t("editor.morePartsOffline")}</p>
          </section>
        </div>
      )}

      {confirmNew && (
        <div className="modal-scrim">
          <section className="confirm-card rise-in" role="dialog" aria-modal="true" aria-labelledby="new-project-title" data-testid="dialog-new-project">
            <div className="confirm-icon"><CONTROL_SYMBOLS.newProject size={21} /></div>
            <h2 id="new-project-title">{t("editor.chooseNew")}</h2>
            <p>{t("editor.keepEditing")}</p>
            <div className="confirm-actions">
              <button type="button" className="cancel-button" onClick={() => setConfirmNew(false)} data-testid="button-cancel-new">{t("editor.cancelNew")}</button>
              <button type="button" className="confirm-button" onClick={() => void startProject()} data-testid="button-confirm-new">{t("editor.confirmNew")}</button>
            </div>
            <button type="button" className="confirm-close" onClick={() => setConfirmNew(false)} aria-label={t("editor.closeNew")} data-testid="button-close-new"><X size={17} /></button>
          </section>
        </div>
      )}
      {formatsOpen && <FormatDialog document={editor.document} viewExporterRef={viewExporterRef}
        initialMode={formatsMode} initialFile={externalImportFile} autoImportInitialFile={!!externalImportFile}
        onClose={() => { setFormatsOpen(false); setExternalImportFile(null); }} onImport={editor.importProject} />}
      {gestureHelpOpen && <GestureHelpDialog onClose={() => setGestureHelpOpen(false)} />}
      {instructionsOpen && <Suspense fallback={<div role="status" className="canvas-loading">{t("editor.instructionsLoading")}</div>}>
        <InstructionsPanel document={editor.document} darkMode={theme === 'dark'} onChange={editor.setInstructionPlan} onClose={() => setInstructionsOpen(false)}
          onExportPDF={async (plan, onProgress, signal, highlight, omitBranding) => {
            const { exportInstructionPdfFile } = await import('@/platform/instruction-pdf-export');
            instructionExportRef.current = null;
            await exportInstructionPdfFile({ document: editor.document, plan, onProgress, signal, highlight, locale, omitBranding,
              onPrepared: file => { instructionExportRef.current = file; } });
          }}
          onExportStudioPDF={async (plan, onProgress, signal, highlight, omitBranding) => {
            const { exportInstructionPdfFile } = await import('@/platform/instruction-pdf-export');
            instructionExportRef.current = null;
            await exportInstructionPdfFile({ document: editor.document, plan, onProgress, signal, highlight, locale, studio: true, omitBranding,
              onPrepared: file => { instructionExportRef.current = file; } });
          }}
          onRetryExport={async () => {
            const prepared = instructionExportRef.current;
            if (!prepared) return false;
            await sharePreparedExport(prepared);
            return true;
          }} />
      </Suspense>}
      {storageOpen && <StorageManager currentProjectId={editor.document.id} onClose={() => setStorageOpen(false)} onProjectsChanged={editor.refreshProjects} />}
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
      {premiumOpen && <PremiumDialog onClose={() => setPremiumOpen(false)} />}
      {!formatsOpen && (
        <ImportPartNotification key={editor.document.id} model={editor.imported} floating />
      )}
      <span className="sr-only" data-testid="status-save-message">{saveMessage}</span>
    </main>
  );
}

export default App;
