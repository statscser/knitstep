"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "../db";
import type { DbProject } from "../db";
import type { Project } from "../types";
import { type ProjectStore, dbToProject } from "../projectStore";
import {
  uploadProjectImages,
  deleteProjectImages,
  rehydrateProjectImages,
} from "./imageUtils";

// ─── Column name mapping (camelCase → snake_case) ─────────────────────────────

function toCloudRow(project: Project, userId: string, uploadResult: {
  trackerData?: Project["trackerData"];
  crochetData?: Project["crochetData"];
  originalFilePaths: string[];
}) {
  // Build cloud versions of tracker/crochet data: replace imageSrc with image_path
  const trackerForCloud = uploadResult.trackerData
    ? (({ imageSrc, ...rest }) => rest)(uploadResult.trackerData) // strip imageSrc
    : project.trackerData
      ? (({ imageSrc, ...rest }) => rest)(project.trackerData)
      : null;

  const crochetForCloud = uploadResult.crochetData
    ? (({ imageSrc, ...rest }) => rest)(uploadResult.crochetData)
    : project.crochetData
      ? (({ imageSrc, ...rest }) => rest)(project.crochetData)
      : null;

  return {
    id:                   project.id,
    user_id:              userId,
    name:                 project.name,
    type:                 project.type ?? null,
    row_count:            project.rowCount,
    last_updated:         project.lastUpdated,
    selected_size:        project.selectedSize ?? "all",
    available_sizes:      project.availableSizes ?? [],
    steps:                project.steps,
    grid_data:            project.gridData ?? null,
    tracker_data:         trackerForCloud,
    crochet_data:         crochetForCloud,
    original_file_paths:  uploadResult.originalFilePaths,
    deleted:              false,
  };
}

/** Convert a cloud DB row back to a Project shape (without imageSrc — caller rehydrates lazily). */
function fromCloudRow(row: Record<string, any>): Project {
  const trackerData = row.tracker_data
    ? { ...row.tracker_data, imageSrc: "" }   // imageSrc filled in lazily by rehydrateProjectImages
    : undefined;
  const crochetData = row.crochet_data
    ? { ...row.crochet_data, imageSrc: "" }
    : undefined;

  return {
    id:             row.id,
    name:           row.name,
    type:           row.type ?? undefined,
    steps:          row.steps ?? [],
    rowCount:       row.row_count,
    lastUpdated:    row.last_updated,
    selectedSize:   row.selected_size ?? "all",
    availableSizes: row.available_sizes ?? [],
    gridData:           row.grid_data ?? undefined,
    trackerData,
    crochetData,
    originalFiles:      undefined,                            // rehydrated on demand when project is opened
    originalFilePaths:  row.original_file_paths ?? [],       // Storage paths for gallery thumbnails
  };
}

/** Translate a Partial<DbProject> patch to Supabase column names. */
function toCloudPatch(patch: Partial<Omit<DbProject, "id">>): Record<string, unknown> {
  const cloud: Record<string, unknown> = {};
  if ("name"         in patch) cloud.name          = patch.name;
  if ("steps"        in patch) cloud.steps         = patch.steps;
  if ("rowCount"     in patch) cloud.row_count      = patch.rowCount;
  if ("lastUpdated"  in patch) cloud.last_updated   = patch.lastUpdated;
  if ("selectedSize" in patch) cloud.selected_size  = patch.selectedSize;
  if ("gridData"     in patch) cloud.grid_data      = patch.gridData ?? null;
  if ("trackerData"  in patch) {
    // Strip imageSrc — only store the _imagePath reference
    const td = patch.trackerData as any;
    cloud.tracker_data = td ? (({ imageSrc, ...rest }: any) => rest)(td) : null;
  }
  if ("crochetData"  in patch) {
    const cd = patch.crochetData as any;
    cloud.crochet_data = cd ? (({ imageSrc, ...rest }: any) => rest)(cd) : null;
  }
  return cloud;
}

// ─── SupabaseProjectStore ─────────────────────────────────────────────────────
// Used when the user is logged in.
// Writes to BOTH Supabase (authoritative) AND local Dexie (cache).
// getAllProjects() reads from local Dexie so the app works offline after first sync.

export class SupabaseProjectStore implements ProjectStore {
  constructor(
    private supabase: SupabaseClient,
    private userId: string,
  ) {}

  async getAllProjects(): Promise<Project[]> {
    // Read from local cache (Dexie), filtered to this user
    const rows = await db.projects
      .orderBy("lastUpdated")
      .reverse()
      .filter((p) => p.userId === this.userId)
      .toArray();
    return rows.map(dbToProject);
  }

  async putProject(project: Project): Promise<void> {
    // 1. Upload binary images to Storage (skips if _imagePath already set)
    const uploadResult = await uploadProjectImages(this.supabase, this.userId, project);

    // 2. Build the final project with updated _imagePath references
    const updatedProject: Project = {
      ...project,
      trackerData: uploadResult.trackerData ?? project.trackerData,
      crochetData: uploadResult.crochetData ?? project.crochetData,
    };

    // 3. Upsert to Supabase
    const cloudRow = toCloudRow(updatedProject, this.userId, uploadResult);
    const { error } = await this.supabase.from("projects").upsert(cloudRow);
    if (error) throw new Error(`[SupabaseStore] upsert failed: ${error.message}`);

    // 4. Mirror to local Dexie cache with userId tagged + _imagePath stored
    await db.projects.put({
      ...updatedProject,
      userId: this.userId,
      origin: (project as any).origin ?? "local",
    } as DbProject);
  }

  async deleteProject(id: string): Promise<void> {
    // 1. Get the cloud row to find Storage paths
    const { data } = await this.supabase
      .from("projects")
      .select("tracker_data, crochet_data, original_file_paths")
      .eq("id", id)
      .eq("user_id", this.userId)
      .single();

    // 2. Delete Storage files
    if (data) {
      await deleteProjectImages(this.supabase, this.userId, id, data);
    }

    // 3. Soft-delete in Supabase (so other devices know to remove it on next sync)
    await this.supabase
      .from("projects")
      .update({ deleted: true, deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", this.userId);

    // 4. Hard-delete from local Dexie
    await db.projects.delete(id);
  }

  async patchProject(id: string, patch: Partial<Omit<DbProject, "id">>): Promise<void> {
    // 1. Write to Supabase (camelCase → snake_case, imageSrc stripped)
    const cloudPatch = toCloudPatch(patch);
    if (Object.keys(cloudPatch).length > 0) {
      const { error } = await this.supabase
        .from("projects")
        .update(cloudPatch)
        .eq("id", id)
        .eq("user_id", this.userId);
      if (error) {
        console.error("[SupabaseStore] patch failed:", error.message);
      }
    }

    // 2. Mirror to local Dexie
    await db.projects.update(id, patch);
  }

  // ── Cloud-sync helpers (called by syncOnLogin in useProjectManager) ──────────

  /** Fetch all non-deleted cloud projects for this user. */
  async fetchCloudProjects(): Promise<Project[]> {
    const { data, error } = await this.supabase
      .from("projects")
      .select("*")
      .eq("user_id", this.userId)
      .eq("deleted", false)
      .order("last_updated", { ascending: false });

    if (error) throw new Error(`[SupabaseStore] fetch failed: ${error.message}`);
    return (data ?? []).map(fromCloudRow);
  }

  /** Download a cloud project into local Dexie cache (used during login sync). */
  async cacheCloudProject(cloudProject: Project): Promise<void> {
    await db.projects.put({
      ...cloudProject,
      userId: this.userId,
      origin: "synced",
    } as DbProject);
  }

  /** Rehydrate a project's imageSrc fields by downloading from Storage.
   *  Call when the user opens a project that was synced from cloud (imageSrc = ""). */
  async rehydrate(project: Project): Promise<Project> {
    if (
      (project.trackerData?.imageSrc === "" && project.trackerData?._imagePath) ||
      (project.crochetData?.imageSrc === "" && project.crochetData?._imagePath)
    ) {
      const rehydrated = await rehydrateProjectImages(this.supabase, project);
      // Cache the rehydrated version so we don't download again
      await db.projects.update(project.id, {
        trackerData: rehydrated.trackerData,
        crochetData: rehydrated.crochetData,
      });
      return rehydrated;
    }
    return project;
  }
}
