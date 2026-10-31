import { afterEach, describe, expect, it } from "vitest";

import { createEmptyDocument } from "@/features/editor/model";
import {
  builderDatabase,
  listProjects,
  loadCurrentProject,
  saveProject,
} from "./database";

describe("local project database", () => {
  afterEach(async () => {
    await builderDatabase.delete();
  });

  it("saves a project and makes it available as the active project", async () => {
    const project = createEmptyDocument("Testmodell");
    await saveProject(project);

    const current = await loadCurrentProject();
    const allProjects = await listProjects();
    expect(current?.id).toBe(project.id);
    expect(current?.name).toBe("Testmodell");
    expect(allProjects.map(({ id }) => id)).toContain(project.id);
  });
});
