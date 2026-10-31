import { describe, expect, it } from "vitest";

import { commit, createHistory, redo, undo } from "./history";
import { createEmptyDocument } from "./model";

describe("editor history", () => {
  it("supports undo and redo for a document edit", () => {
    const initial = createEmptyDocument();
    const afterAdd = {
      ...initial,
      bricks: [
        {
          id: "brick-a",
          type: "brick-2x2" as const,
          color: "#d75b3f",
          x: 0,
          y: 0,
          z: 0,
          rotation: 0,
        },
      ],
    };
    const changed = commit(createHistory(initial), afterAdd);

    expect(undo(changed).document.bricks).toHaveLength(0);
    expect(redo(undo(changed)).document.bricks).toHaveLength(1);
  });

  it("drops the redo branch when a new edit follows undo", () => {
    const initial = createEmptyDocument();
    const first = { ...initial, name: "First" };
    const second = { ...initial, name: "Second" };
    const afterUndo = undo(commit(commit(createHistory(initial), first), second));
    const branched = commit(afterUndo, { ...initial, name: "Branch" });

    expect(branched.future).toHaveLength(0);
    expect(redo(branched).document.name).toBe("Branch");
  });
});
