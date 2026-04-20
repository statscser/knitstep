"use client";

import { db } from "../db";
import type { DbProject } from "../db";
import type { Project } from "../types";
import { type ProjectStore, dbToProject } from "../projectStore";

// ─── DexieProjectStore ────────────────────────────────────────────────────────
// Local-only implementation: all reads/writes go to IndexedDB via Dexie.
// Used when the user is NOT logged in.
// Scoped to anonymous projects only (userId === null).

export class DexieProjectStore implements ProjectStore {

  async getAllProjects(): Promise<Project[]> {
    const rows = await db.projects
      .orderBy("lastUpdated")
      .reverse()
      .filter((p) => !p.userId) // only anonymous (userId null/undefined)
      .toArray();
    return rows.map(dbToProject);
  }

  async putProject(project: Project): Promise<void> {
    await db.projects.put({
      ...project,
      userId: null,
      origin: "local",
    } as DbProject);
  }

  async deleteProject(id: string): Promise<void> {
    await db.projects.delete(id);
  }

  async patchProject(id: string, patch: Partial<Omit<DbProject, "id">>): Promise<void> {
    await db.projects.update(id, patch);
  }
}
