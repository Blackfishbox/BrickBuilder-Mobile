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
import {
  listProjects,
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
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(createEmptyDocument()),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<BrickType>("brick-2x4");
  const [selectedColor, setSelectedColorValue] = useState("#d75b3f");
  const [toolMode, setToolMode] = useState<ToolMode>("build");
  const [isReady, setIsReady] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [modelAnalysis, setModelAnalysis] = useState<ModelAnalysis>({
    count: 0,
    bounds: null,
    overlapCount: 0,
  });
  const [projects, setProjects] = useState<BuilderDocument[]>([]);
  const historyRef = useRef(history);
  const documentRef = useRef(history.document);
  const analysisIdRef = useRef(0);
  const analysisWorkerRef = useRef<Worker | null>(null);

  useEffect(() => {
    historyRef.current = history;
    documentRef.current = history.document;
  }, [history]);

  const replaceDocument = useCallback((document: BuilderDocument) => {
    const opened = normalizeDocument(document);
    const next = createHistory(opened);
    historyRef.current = next;
    documentRef.current = opened;
    setHistory(next);
  }, []);

  const refreshProjects = useCallback(async () => {
    const savedProjects = await listProjects();
    setProjects(savedProjects);
    return savedProjects;
  }, []);

  const restoreLastProject = useCallback(async (): Promise<boolean> => {
    let restored = false;
    try {
      const stored = await loadCurrentProject();
      if (stored) {
        replaceDocument(stored);
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
      await saveProject(documentRef.current);
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
    if (!isReady) return;
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
    (color: string) => {
      setSelectedColorValue(color);
      if (!selectedId) return;
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

  const place = useCallback(
    (position: Position3) => {
      const snapped = snapPosition(position);
      const brick: Brick = {
        id: crypto.randomUUID(),
        type: selectedType,
        color: selectedColor,
        x: snapped.x,
        y: Math.round(snapped.y / BRICK_HEIGHT) * BRICK_HEIGHT,
        z: snapped.z,
        rotation: 0,
      };
      if (toolMode === "delete") return;
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: [...document.bricks, brick],
      }));
      setSelectedId(brick.id);
    },
    [selectedColor, selectedType, toolMode, updateDocument],
  );

  const move = useCallback(
    (id: string, position: Position3) => {
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
    [updateDocument],
  );

  const remove = useCallback(
    (id: string) => {
      updateDocument((document) => ({
        ...document,
        updatedAt: new Date().toISOString(),
        bricks: document.bricks.filter((brick) => brick.id !== id),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [updateDocument],
  );

  const select = useCallback(
    (id: string | null) => {
      if (toolMode === "delete" && id) {
        remove(id);
        return;
      }
      setSelectedId(id);
    },
    [remove, toolMode],
  );

  const rotateSelected = useCallback(() => {
    if (!selectedId) return;
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
      current && next.document.bricks.some((brick) => brick.id === current)
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
      current && next.document.bricks.some((brick) => brick.id === current)
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
      await saveProject(project);
      replaceDocument(project);
      setSavedAt(project.updatedAt);
      setSelectedId(null);
      setToolMode("build");
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
    replaceDocument(imported);
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
    const updated = { ...current, imported: model, updatedAt: new Date().toISOString() };
    await saveProject(updated);
    if (historyRef.current.document.id !== id) return;
    // Geometry is read-only enrichment; preserve the editable brick undo/redo history.
    const enrich = (doc: BuilderDocument) => ({ ...doc, imported: model });
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
