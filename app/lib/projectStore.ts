"use client";

import type { DbProject } from "./db";
import type { Project, GridData, TrackerData, CrochetData, PatternMeta } from "./types";

// ─── ProjectStore interface ───────────────────────────────────────────────────
// Both DexieProjectStore (local) and SupabaseProjectStore (cloud) implement this.
// useProjectManager holds one instance and delegates all persistence here.
// The UI never changes — only the hook's internal store implementation swaps.

export interface ProjectStore {
  /** Load all projects visible to the current auth context. */
  getAllProjects(): Promise<Project[]>;

  /** Create or fully overwrite a project (used for new projects and first-time cloud upload). */
  putProject(project: Project): Promise<void>;

  /** Delete a project and its associated storage files. */
  deleteProject(id: string): Promise<void>;

  /** Apply a partial update to an existing project.
   *  Pass only the fields that changed — the implementation decides which
   *  DB columns / Storage paths need updating.
   */
  patchProject(id: string, patch: Partial<Omit<DbProject, "id">>): Promise<void>;
}

// ─── Type helpers ─────────────────────────────────────────────────────────────

/** Coerce a raw DbProject row (from Dexie or Supabase) to the Project shape used by UI. */
export function dbToProject(p: DbProject): Project {
  return {
    ...p,
    availableSizes: (p as any).availableSizes ?? [],
    selectedSize:   (p as any).selectedSize   ?? "all",
  } as Project;
}
