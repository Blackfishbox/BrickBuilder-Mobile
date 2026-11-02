import { useCallback, useEffect, useRef, useState } from "react";

import {
  BRICK_HEIGHT,
  createEmptyDocument,
  normalizeDocument,
  rotateQuarterTurn,
  snapPosition,
  type Brick,
  type BrickType,
  type BuilderDocument,
  type Position3,
  type ToolMode,
} from "./model";
import { commit, createHistory, redo, undo, type HistoryState } from "./history";
import type { LibraryPart } from "../parts/types";
import { ensureCatalog, resolveStoredInventory, useCatalog } from "../catalog/client";
import { refreshedCatalogModel } from "../catalog/refresh-model";
import { resolveColor } from "../formats/colors";
import { editImported, enrichImportedGeometry, moveImported, placePreparedPart, placeInventoryPart, prepareLibraryPart, recolorImported, rotateImported, type PreparedPart } from "./ldraw-editing";
import { inheritStackingBounds } from "../engine/stacking";
import { constructionTransform } from "../connections/engine";
import type { Affine, ImportedModel } from "../formats/types";
import { groundedTransform, modelGround } from "./positioning";
import type { Inventory, InventoryChoice } from "../inventory/types";
import { replaceInventory, requireAvailable } from "../inventory/accounting";
import {
  listProjectSummaries,
  type ProjectSummary,
  loadCurrentProject,
  loadProject,
  requestPersistentStorage,
  saveProject,
  createImportedProject,
} from "@/storage/database";

export interface ModelAnalysis {
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  overlapCount: number;
}

interface AnalysisResponse extends ModelAnalysis {
  requestId: number;
}

export function useBuilder() {
  const catalog = useCatalog();
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(createEmptyDocument()),
  );
  const groundRef = useRef<{ initial?: ImportedModel; floor?: number }>({});
  useEffect(() => {
    groundRef.current = { initial: history.document.imported };
  }, [history.document.id, history.document.imported?.originalBytes]);
  const constructionGround = useCallback((model: ImportedModel) => {
    const state = groundRef.current;
    // Evaluate lazily, but retain the initial scene floor through edits and undo.
    state.floor ??= modelGround(state.initial ? { ...state.initial, resources: model.resources } : model);
    return state.floor;
  }, []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<BrickType>("brick-2x4");
  const [selectedColor, setSelectedColorValue] = useState("#B40000");
  const [selectedColorCode, setSelectedColorCode] = useState<string | undefined>("4");
  const [preparedPart, setPreparedPart] = useState<PreparedPart | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<InventoryChoice | null>(null);
  const placementRef = useRef<{ prepared: PreparedPart; inventory?: InventoryChoice } | null>(null);
  const [partLoading, setPartLoading] = useState(false);
  const [partError, setPartError] = useState<string | null>(null);
  const partControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => partControllerRef.current?.abort(), []);
  const [toolMode, setToolMode] = useState<ToolMode>("build");
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    if (!isReady || catalog.status !== "ready" || !historyRef.current.document.imported) return;
    const cache = new WeakMap();
    const apply = (document: BuilderDocument) => document.imported
      ? { ...document, imported: refreshedCatalogModel(document.imported, cache) } : document;
    const current = historyRef.current;
    const next = { document: apply(current.document), past: current.past.map(apply), future: current.future.map(apply) };
    historyRef.current = next; documentRef.current = next.document; setHistory(next);
  }, [isReady, catalog.status]);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelAnalysis, setModelAnalysis] = useState<ModelAnalysis>({
    count: 0,
    bounds: null,
    overlapCount: 0,
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const historyRef = useRef(history);
  const documentRef = useRef(history.document);
  const lastSavedDocumentRef = useRef<BuilderDocument | null>(null);
  const analysisIdRef = useRef(0);
  const analysisWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    historyRef.current = history;
    documentRef.current = history.document;
  }, [history]);

  const replaceDocument = useCallback((document: BuilderDocument, alreadySaved = false) => {
    const opened = normalizeDocument(document);
    partControllerRef.current?.abort();
    placementRef.current = null;
    setPreparedPart(null); setSelectedInventory(null); setPartLoading(false); setPartError(null);
    const next = createHistory(opened);
    historyRef.current = next;
    documentRef.current = opened;
    lastSavedDocumentRef.current = alreadySaved ? opened : null;
    setHistory(next);
  }, []);

  const refreshProjects = useCallback(async () => {
    const savedProjects = await listProjectSummaries();
    setProjects(savedProjects);
    return savedProjects;
  }, []);

  const restoreLastProject = useCallback(async (): Promise<boolean> => {
    let restored = false;
    try {
      const catalogReady = ensureCatalog().catch(() => undefined);
      const stored = await loadCurrentProject();
      if (stored?.imported) await catalogReady;
      if (stored) {
        replaceDocument(stored.imported ? { ...stored, imported: refreshedCatalogModel(stored.imported) } : stored, true);
        if (stored.imported) setToolMode("select");
        setSavedAt(stored.updatedAt);
        restored = true;
      } else {
        replaceDocument(createEmptyDocument());
      }
      await requestPersistentStorage();
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Projekt konnte nicht geladen werden.",
      );
      replaceDocument(createEmptyDocument());
    } finally {
      setIsReady(true);
    }
    await refreshProjects().catch(() => undefined);
    return restored;
  }, [refreshProjects, replaceDocument]);

  useEffect(() => {
    void restoreLastProject();
  }, [restoreLastProject]);

  const persist = useCallback(async () => {
    if (!isReady) return;
    setIsSaving(true);
    try {
      const snapshot = documentRef.current;
      await saveProject(snapshot);
      lastSavedDocumentRef.current = snapshot;
      setSavedAt(new Date().toISOString());
      setSaveError(null);
      await refreshProjects().catch(() => undefined);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Speichern fehlgeschlagen.",
      );
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [isReady, refreshProjects]);

  useEffect(() => {
    if (!isReady || history.document === lastSavedDocumentRef.current) return;
    const timeout = window.setTimeout(
      () => void persist().catch(() => undefined),
      450,
    );
    return () => window.clearTimeout(timeout);
  }, [history.document, isReady, persist]);

  useEffect(() => {
    const worker = new Worker(
      new URL("../engine/model-analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    analysisWorkerRef.current = worker;
    worker.addEventListener("message", (event: MessageEvent<AnalysisResponse>) => {
      if (event.data.requestId !== analysisIdRef.current) return;
      setModelAnalysis({
        count: event.data.count,
        bounds: event.data.bounds,
        overlapCount: event.data.overlapCount,
      });
    });
    return () => {
      worker.terminate();
      analysisWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const requestId = ++analysisIdRef.current;
    analysisWorkerRef.current?.postMessage({
      requestId,
      bricks: history.document.bricks,
    });
  }, [history.document.bricks]);

  const updateDocument = useCallback((updater: (document: BuilderDocument) => BuilderDocument) => {
    const current = historyRef.current;
    const nextDocument = updater(current.document);
    const next = commit(current, nextDocument);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
  }, []);

  const setSelectedColor = useCallback(
    (color: string, code?: string) => {
      setSelectedColorValue(color);
      setSelectedColorCode(code);
      if (!selectedId) return;
      if (historyRef.current.document.imported?.instances.some(instance => instance.id === selectedId)) {
        updateDocument(document => recolorImported(document, selectedId, color, code));
        return;
      }
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.map((brick) =>
          brick.id === selectedId ? { ...brick, color } : brick,
        ),
      }));
    },
    [selectedId, updateDocument],
  );

  const selectLibraryPart = useCallback(async (part: LibraryPart) => {
    partControllerRef.current?.abort();
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null);
    const controller = new AbortController();
    partControllerRef.current = controller;
    setPartLoading(true); setPartError(null);
    try {
      const prepared = await prepareLibraryPart(part, controller.signal);
      if (controller.signal.aborted) return false;
      setPreparedPart(prepared);
      placementRef.current = { prepared };
      setSelectedId(null); setToolMode("build");
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setPartError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { if (!controller.signal.aborted) setPartLoading(false); }
  }, []);
  const selectInventoryPart = useCallback(async (choice: InventoryChoice) => {
    partControllerRef.current?.abort();
    const controller = new AbortController();
    partControllerRef.current = controller;
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null);
    setPartLoading(true); setPartError(null);
    const projectId = documentRef.current.id;
    try {
      const row = requireAvailable(documentRef.current, choice);
      const preview = await resolveStoredInventory(documentRef.current.inventory!);
      controller.signal.throwIfAborted();
      const resolution = preview.resolutions[row.id];
      const candidate = resolution?.parts.find(part => part.ldrawId === choice.ldrawId);
      if (!candidate || !resolution.colors.some(color => color.ldrawCode === choice.colorCode)) throw new Error(`BrickLink ${row.partId}, Farbe ${row.colorId}: Auswahl nicht belegt. Bitte erneut auswählen.`);
      const prepared = await prepareLibraryPart({
        id: `inventory:${choice.listId}:${choice.rowId}`, packageId: "catalog",
        ldrawId: candidate.ldrawId, brickLinkId: row.partId, name: candidate.name,
        category: "Teileliste", keywords: [], file: `parts/${candidate.ldrawId}.dat`,
      }, controller.signal);
      controller.signal.throwIfAborted();
      if (documentRef.current.id !== projectId) return false;
      requireAvailable(documentRef.current, choice);
      const color = resolveColor(choice.colorCode);
      if (!color) throw new Error(`BrickLink-Farbe ${row.colorId}: LDraw-Farbe nicht verfügbar.`);
      placementRef.current = { prepared, inventory: { ...choice } };
      setPreparedPart(prepared); setSelectedInventory({ ...choice });
      setSelectedColorValue(color.hex); setSelectedColorCode(choice.colorCode);
      setSelectedId(null); setToolMode("build");
      return true;
    } catch (error) {
      if (!controller.signal.aborted) setPartError(error instanceof Error ? error.message : String(error));
      return false;
    } finally { if (!controller.signal.aborted) setPartLoading(false); }
  }, []);
  const replacePartsInventory = useCallback((inventory: Inventory, expectedProjectId: string) => {
    updateDocument(document => {
      if (document.id !== expectedProjectId) throw new Error("Projekt wurde inzwischen gewechselt.");
      return replaceInventory(document, inventory);
    });
    partControllerRef.current?.abort();
    placementRef.current = null; setPreparedPart(null); setSelectedInventory(null); setPartLoading(false);
  }, [updateDocument]);
  const cancelPartPreparation = useCallback(() => {
    partControllerRef.current?.abort();
    setPartLoading(false);
  }, []);

  const place = useCallback(
    (position: Position3) => {
      if (toolMode === "delete" || partLoading) return;
      const selection = placementRef.current;
      if (!selection) { setPartError("Bitte zuerst ein Teil aus dem LDraw-Katalog oder der Teileliste auswählen."); return; }
      try {
        let id: string | null = null;
        updateDocument(document => {
          let next = selection.inventory
            ? placeInventoryPart(document, selection.prepared, position, selection.inventory)
            : placePreparedPart(document, selection.prepared, position, selectedColor, selectedColorCode);
          id = next.imported!.instances.at(-1)!.id;
          inheritStackingBounds(document.imported, next.imported!);
          const instance = next.imported!.instances.at(-1)!;
          const origin = { x: position.x, y: -instance.matrix[7] / 20, z: position.z };
           const result = constructionTransform(next.imported!, id, origin);
           next = moveImported(next, id, { x: result.matrix[3] / 20, y: -result.matrix[7] / 20, z: result.matrix[11] / 20 }, false, result.matrix);
          return next;
        });
        setSelectedId(id); setPartError(null);
      } catch (error) { setPartError(error instanceof Error ? error.message : String(error)); }
    },
    [selectedColor, selectedColorCode, partLoading, toolMode, updateDocument],
  );

  const move = useCallback(
    (id: string, position: Position3, transform?: Affine) => {
      if (historyRef.current.document.imported?.instances.some(instance => instance.id === id)) {
        try { updateDocument(document => {
          const model = document.imported!;
          const matrix = groundedTransform(model, id, position, constructionGround(model), transform);
          const original = model.instances.find(instance => instance.id === id)!;
          if (matrix.every((value, index) => Math.abs(value - original.matrix[index]) < 1e-10)) return document;
          return moveImported(document, id, position, false, matrix);
        }); } catch (error) { setPartError(error instanceof Error ? error.message : String(error)); }
        return;
      }
      const snapped = snapPosition(position);
      const existing = historyRef.current.document.bricks.find((brick) => brick.id === id);
      if (
        existing &&
        existing.x === snapped.x &&
        existing.y === snapped.y &&
        existing.z === snapped.z
      ) {
        return;
      }
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.map((brick) =>
          brick.id === id
            ? { ...brick, x: snapped.x, y: snapped.y, z: snapped.z }
            : brick,
        ),
      }));
    },
    [updateDocument, constructionGround],
  );

  const remove = useCallback(
    (id: string) => {
      if (historyRef.current.document.imported?.instances.some(instance => instance.id === id)) {
        updateDocument(document => editImported(document, id, () => null));
        setSelectedId(current => current === id ? null : current);
        return;
      }
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.filter((brick) => brick.id !== id),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [updateDocument],
  );

  // Explicit adjustments bypass snapping/stacking, but never the construction floor.
  const nudgeSelected = useCallback((delta: Position3) => {
    if (!selectedId || ![delta.x, delta.y, delta.z].every(Number.isFinite)) return;
    const document = historyRef.current.document;
    const instance = document.imported?.instances.find(value => value.id === selectedId);
    const brick = document.bricks.find(value => value.id === selectedId);
    if (instance) {
      const matrix = [...instance.matrix] as Affine;
      for (const [index, amount] of [[3, delta.x * 20], [7, -delta.y * 20], [11, delta.z * 20]]) {
        if (amount) matrix[index] = Number((matrix[index] + amount).toFixed(10));
      }
      move(selectedId, { x: matrix[3] / 20, y: -matrix[7] / 20, z: matrix[11] / 20 }, matrix);
    } else if (brick) {
      const next = {
        ...brick, x: Number((brick.x + delta.x).toFixed(10)), y: Math.max(0, Number((brick.y + delta.y).toFixed(10))),
        z: Number((brick.z + delta.z).toFixed(10)),
      };
      if (next.x === brick.x && next.y === brick.y && next.z === brick.z) return;
      updateDocument(current => ({
        ...current, updatedAt: new Date().toISOString(),
        bricks: current.bricks.map(value => value.id === selectedId ? next : value),
      }));
    }
  }, [selectedId, move, updateDocument]);
  const changeHeight = useCallback((delta: number) => nudgeSelected({ x: 0, y: delta, z: 0 }), [nudgeSelected]);

  const select = useCallback(
    (id: string | null) => {
      if (toolMode === "delete" && id) {
        remove(id);
        return;
      }
      setSelectedId(id);
      setPartError(null);
      const instance = historyRef.current.document.imported?.instances.find(item => item.id === id);
      if (instance) {
        const color = resolveColor(instance.colorCode);
        if (color) { setSelectedColorValue(color.hex); setSelectedColorCode(instance.colorCode); }
      }
    },
    [remove, toolMode],
  );

  useEffect(() => {
    const instance = history.document.imported?.instances.find(item => item.id === selectedId);
    if (!instance) return;
    setSelectedColorValue(resolveColor(instance.colorCode)?.hex ?? "#ff00ff");
    setSelectedColorCode(instance.colorCode);
  }, [history.document.imported, selectedId]);

  const rotateSelected = useCallback(() => {
    if (!selectedId) return;
    if (historyRef.current.document.imported?.instances.some(instance => instance.id === selectedId)) {
      updateDocument(document => rotateImported(document, selectedId));
      return;
    }
    updateDocument((document) => ({
      ...document,
      updatedAt: new Date().toISOString(),
      bricks: document.bricks.map((brick) =>
        brick.id === selectedId
          ? { ...brick, rotation: rotateQuarterTurn(brick.rotation) }
          : brick,
      ),
    }));
  }, [selectedId, updateDocument]);

  const deleteSelected = useCallback(() => {
    if (selectedId) remove(selectedId);
  }, [remove, selectedId]);

  const undoChange = useCallback(() => {
    const next = undo(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
    setSelectedId((current) =>
      current && (next.document.bricks.some((brick) => brick.id === current) || next.document.imported?.instances.some(instance => instance.id === current))
        ? current
        : null,
    );
  }, []);

  const redoChange = useCallback(() => {
    const next = redo(historyRef.current);
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
    setSelectedId((current) =>
      current && (next.document.bricks.some((brick) => brick.id === current) || next.document.imported?.instances.some(instance => instance.id === current))
        ? current
        : null,
    );
  }, []);

  const updateProjectName = useCallback(
    (name: string) => {
      const current = historyRef.current;
      const document = {
        ...current.document,
        name: name || "Neues Modell",
        updatedAt: new Date().toISOString(),
      };
      const next = { ...current, document };
      historyRef.current = next;
      documentRef.current = document;
      setHistory(next);
    },
    [],
  );

  const openProject = useCallback(
    async (id: string) => {
      const project = await loadProject(id);
      if (!project) return false;
      await saveProject(historyRef.current.document);
      const refreshed = project.imported ? { ...project, imported: refreshedCatalogModel(project.imported) } : project;
      await saveProject(refreshed);
      replaceDocument(refreshed, true);
      setSavedAt(project.updatedAt);
      setSelectedId(null);
      setToolMode(project.imported ? "select" : "build");
      await refreshProjects();
      return true;
    },
    [refreshProjects, replaceDocument],
  );

  const startNewProject = useCallback(async () => {
    if (isReady) await saveProject(historyRef.current.document);
    const document = createEmptyDocument();
    replaceDocument(document);
    setSelectedId(null);
    setToolMode("build");
    await saveProject(document);
    setSavedAt(document.updatedAt);
    await refreshProjects();
  }, [isReady, refreshProjects, replaceDocument]);

  const importProject = useCallback(async (imported: BuilderDocument) => {
    await createImportedProject(historyRef.current.document, imported);
    replaceDocument(imported, true);
    setSelectedId(null);
    setToolMode("select");
    setSavedAt(imported.updatedAt);
    setSaveError(null);
    // The import is committed even if refreshing the project list subsequently fails.
    await refreshProjects().catch(() => undefined);
  }, [refreshProjects, replaceDocument]);

  const resolveImportedProject = useCallback(async (id: string, model: NonNullable<BuilderDocument["imported"]>) => {
    const current = historyRef.current.document;
    if (current.id !== id || current.imported?.sourceText !== model.sourceText) throw new Error("Projekt wurde inzwischen gewechselt.");
    const updated = { ...current, imported: enrichImportedGeometry(current.imported!, model), updatedAt: new Date().toISOString() };
    await saveProject(updated);
    if (historyRef.current.document.id !== id) return;
    // Merge only acquired geometry into every historical snapshot; keep its own
    // colors, transforms, added parts and deletions, including concurrent edits.
    const enrich = (doc: BuilderDocument) => doc.imported
      ? { ...doc, imported: enrichImportedGeometry(doc.imported, model) } : doc;
    const next = { document: enrich(historyRef.current.document),
      past: historyRef.current.past.map(enrich), future: historyRef.current.future.map(enrich) };
    historyRef.current = next;
    documentRef.current = next.document;
    setHistory(next);
    setSavedAt(updated.updatedAt);
    setSaveError(null);
  }, []);

  const document = history.document;
  return {
    document,
    imported: document.imported,
    importProject,
    resolveImportedProject,
    bricks: document.bricks,
    selectedId,
    selectedType,
    selectedColor,
    selectedColorCode,
    selectedPart: preparedPart?.part ?? null,
    selectedInstance: document.imported?.instances.find(instance => instance.id === selectedId) ?? null,
    selectLibraryPart, selectInventoryPart, replacePartsInventory, selectedInventory, cancelPartPreparation, partLoading, partError,
    toolMode,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    savedAt,
    isSaving,
    saveError,
    isReady,
    modelAnalysis,
    setSelectedType,
    setSelectedColor,
    setToolMode,
    select,
    place,
    move,
    changeHeight,
    nudgeSelected,
    rotateSelected,
    deleteSelected,
    undo: undoChange,
    redo: redoChange,
    save: persist,
    projects,
    refreshProjects,
    openProject,
    projectName: document.name,
    setProjectName: updateProjectName,
    brickCount: document.bricks.length + (document.imported?.instances.length ?? 0),
    startNewProject,
    restoreLastProject,
  };
}
