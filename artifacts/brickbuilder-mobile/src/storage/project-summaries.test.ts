import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmptyDocument } from "@/features/editor/model";
import { builderDatabase, listProjectSummaries, loadProject, saveProject } from "./database";
import { removeStoredProject } from "./management";

afterEach(async () => { vi.restoreAllMocks(); await builderDatabase.delete(); });
describe("lightweight project lists", () => {
  it("reads cached summaries without cloning full project archives again", async () => {
    await builderDatabase.open();
    const document = createEmptyDocument();
    await saveProject(document);
    const getter = vi.spyOn(builderDatabase.projects, "get");
    expect(await listProjectSummaries()).toEqual([expect.objectContaining({
      id: document.id, name: document.name, brickCount: document.bricks.length,
    })]);
    expect(getter).not.toHaveBeenCalled();
    expect((await loadProject(document.id))?.bricks).toEqual(document.bricks);
  });
  it("backfills legacy summaries without changing stored project data", async () => {
    await builderDatabase.open();
    const document = createEmptyDocument();
    await builderDatabase.projects.put(document);
    expect(await listProjectSummaries()).toHaveLength(1);
    expect(await loadProject(document.id)).toEqual(document);
    const getter = vi.spyOn(builderDatabase.projects, "get");
    expect(await listProjectSummaries()).toHaveLength(1);
    expect(getter).not.toHaveBeenCalled();
  });
  it("removes derived summary metadata when its inactive project is deleted", async () => {
    await builderDatabase.open();
    const old = createEmptyDocument(), active = createEmptyDocument();
    await saveProject(old); await saveProject(active);
    await removeStoredProject(old.id, active.id);
    expect(await builderDatabase.metadata.get("project-summary:" + old.id)).toBeUndefined();
    expect((await listProjectSummaries()).map(summary => summary.id)).toEqual([active.id]);
  });
});
