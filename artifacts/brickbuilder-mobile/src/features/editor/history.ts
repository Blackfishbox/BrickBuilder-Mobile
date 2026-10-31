import type { BuilderDocument } from "./model";

export interface HistoryState {
  document: BuilderDocument;
  past: BuilderDocument[];
  future: BuilderDocument[];
}

const HISTORY_LIMIT = 100;

export function createHistory(document: BuilderDocument): HistoryState {
  return { document, past: [], future: [] };
}

export function commit(
  state: HistoryState,
  document: BuilderDocument,
): HistoryState {
  if (document === state.document) return state;
  const past = [...state.past, state.document].slice(-HISTORY_LIMIT);
  return { document, past, future: [] };
}

export function undo(state: HistoryState): HistoryState {
  const previous = state.past.at(-1);
  if (!previous) return state;
  return {
    document: previous,
    past: state.past.slice(0, -1),
    future: [state.document, ...state.future],
  };
}

export function redo(state: HistoryState): HistoryState {
  const next = state.future[0];
  if (!next) return state;
  return {
    document: next,
    past: [...state.past, state.document].slice(-HISTORY_LIMIT),
    future: state.future.slice(1),
  };
}
