"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "../lib/supabase/client";
import { db } from "../lib/db";
import type { DbProject } from "../lib/db";
import {
  isStoredFile, getAvailableSizes, fileToStoredFile,
  type Step, type Project, type GridData, type TrackerData, type CrochetData, type PatternMeta,
} from "../lib/types";
import type { StoredFile } from "../lib/db";
import { createProjectStore } from "../lib/stores/createProjectStore";
import { SupabaseProjectStore } from "../lib/stores/SupabaseProjectStore";
import { planSync, resolveConflict } from "../lib/stores/syncUtils";
import { dbToProject } from "../lib/projectStore";

// Lazy singleton: only created in the browser (never during SSR prerender)
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createClient();
  return _supabase;
}

// ─── useProjectManager ────────────────────────────────────────────────────────
// Owns all storage state and operations, plus the blob-URL lifecycle for the
// reference panel.  Pass `steps` (from page state) so the sync effect can write
// the latest checklist progress to the database without page.tsx touching db.

export function useProjectManager({
  steps,
  mounted,
}: {
  steps: Step[];
  mounted: boolean;
}) {
  const [projects, setProjects]                     = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId]     = useState<string | null>(null);
  const [selectedSize, setSelectedSize]             = useState<string>("all");
  const [storageWarning, setStorageWarning]         = useState(false);

  // Auth state
  const [user, setUser]             = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSyncing, setIsSyncing]   = useState(false);

  // Reference-panel file state
  const [currentProjectFiles, setCurrentProjectFiles] = useState<{ url: string; mimeType: string }[]>([]);
  const [currentFileIndex, setCurrentFileIndex]       = useState(0);
  const [hasClickedTarget, setHasClickedTarget]       = useState(false);
  const currentProjectFileUrlsRef = useRef<string[]>([]);

  // Prevents effects from firing with stale data before the first localStorage
  // restore completes.  Set to true via markHydrated() called by page.tsx.
  const hydrated = useRef(false);

  // Steps cloud-write debounce timer
  const stepsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Guard: prevent concurrent syncOnLogin calls (e.g. if SIGNED_IN fires twice)
  const syncInProgressRef = useRef(false);

  // Stash loadProjects args so INITIAL_SESSION can call onProjectRestored
  const pendingRestoreRef = useRef<{
    savedProjectId: string | null;
    onProjectRestored: (project: Project) => void;
  } | null>(null);

  // ── Build the store based on auth state ───────────────────────────────────
  const store = useMemo(
    () => createProjectStore(user, getSupabase()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id],
  );

  // ── Auth: subscribe to Supabase auth state changes ───────────────────────
  useEffect(() => {
    const { data: { subscription } } = getSupabase().auth.onAuthStateChange(
      async (event, session) => {
        const nextUser = session?.user ?? null;
        setUser(nextUser);
        setAuthLoading(false);

        if (event === "SIGNED_IN" && nextUser) {
          await syncOnLogin(nextUser);
        }

        if (event === "INITIAL_SESSION" && nextUser) {
          // Page reloaded while already logged in — load this user's projects from
          // local Dexie cache (they were synced during the original login).
          const rows = await db.projects
            .orderBy("lastUpdated").reverse()
            .filter((p) => p.userId === nextUser.id)
            .toArray();
          const loaded = rows.map(dbToProject);
          setProjects(loaded);

          // Restore the active project if page.tsx already stashed the callback
          const pending = pendingRestoreRef.current;
          if (pending) {
            pendingRestoreRef.current = null;
            const active = pending.savedProjectId
              ? loaded.find((p) => p.id === pending.savedProjectId)
              : undefined;
            if (active) {
              pending.onProjectRestored(active);
            }
          }
        }

        if (event === "SIGNED_OUT") {
          // Remove cloud-cached projects from IndexedDB (keep local-origin ones)
          await db.projects
            .filter((p) => p.origin === "synced")
            .delete();
          // Reload anonymous projects
          const anonRows = await db.projects
            .orderBy("lastUpdated").reverse()
            .filter((p) => !p.userId)
            .toArray();
          setProjects(anonRows.map(dbToProject));
          setCurrentProjectId(null);
          try { localStorage.removeItem("knitstep-current-project"); } catch {}
        }
      },
    );

    // Eagerly check current session so authLoading resolves fast on reload
    getSupabase().auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist active project ID to localStorage ──────────────────────────────
  useEffect(() => {
    if (!hydrated.current) return;
    if (currentProjectId) {
      localStorage.setItem("knitstep-current-project", currentProjectId);
    } else {
      localStorage.removeItem("knitstep-current-project");
    }
  }, [currentProjectId]);

  // ── Sync checklist progress → storage whenever steps change ───────────────
  useEffect(() => {
    if (!hydrated.current) return;
    if (!currentProjectId) return;
    const now = Date.now();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === currentProjectId
          ? { ...p, steps, rowCount: steps.filter((s) => !s.isHeader).length, lastUpdated: now }
          : p
      )
    );

    const patch: Partial<Omit<DbProject, "id">> = {
      steps,
      rowCount: steps.filter((s) => !s.isHeader).length,
      lastUpdated: now,
    };

    if (user) {
      // Local write immediately; debounce cloud write to avoid hammering Supabase
      db.projects.update(currentProjectId, patch).catch(console.error);
      if (stepsDebounceRef.current) clearTimeout(stepsDebounceRef.current);
      stepsDebounceRef.current = setTimeout(() => {
        store.patchProject(currentProjectId, patch).catch(
          (err) => console.error("[KnitStep] Failed to sync steps to cloud:", err),
        );
      }, 2000);
    } else {
      store.patchProject(currentProjectId, patch).catch(
        (err) => console.error("[KnitStep] Failed to sync project:", err),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, currentProjectId]);

  // ── Persist selected size preference ───────────────────────────────────────
  useEffect(() => {
    if (!hydrated.current) return;
    if (!currentProjectId) return;
    store
      .patchProject(currentProjectId, { selectedSize })
      .catch((err) => console.error("[KnitStep] Failed to persist selectedSize:", err));
  }, [selectedSize, currentProjectId, store]);

  // ── Storage usage monitor — warn at > 50 MB (local-only users) ────────────
  useEffect(() => {
    if (!mounted || user) return; // cloud users have no local cap
    let totalBytes = 0;
    for (const p of projects) {
      for (const f of p.originalFiles ?? []) {
        totalBytes += isStoredFile(f) ? Math.ceil(f.data.length * 0.75) : (f as Blob).size;
      }
      if (p.originalFile) totalBytes += (p.originalFile as Blob).size;
    }
    setStorageWarning(totalBytes > 50 * 1024 * 1024);
  }, [projects, mounted, user]);

  // ── Generate blob URLs for the reference panel ─────────────────────────────
  useEffect(() => {
    setCurrentFileIndex(0);
    setHasClickedTarget(false);

    if (!currentProjectId) {
      setCurrentProjectFiles([]);
      return;
    }

    const proj = projects.find((p) => p.id === currentProjectId);
    const rawFiles =
      proj?.originalFiles && proj.originalFiles.length > 0
        ? proj.originalFiles
        : proj?.originalFile
          ? [proj.originalFile]
          : [];

    if (rawFiles.length === 0) {
      setCurrentProjectFiles([]);
      return;
    }

    const blobUrlsToRevoke: string[] = [];
    const entries = rawFiles.map((f) => {
      let blob: Blob;
      if (isStoredFile(f)) {
        const bytes = atob(f.data);
        const arr   = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        blob = new Blob([arr], { type: f.mimeType });
      } else {
        blob = f as Blob;
      }
      const url = URL.createObjectURL(blob);
      blobUrlsToRevoke.push(url);
      return { url, mimeType: blob.type || "application/octet-stream" };
    });

    currentProjectFileUrlsRef.current = blobUrlsToRevoke;
    setCurrentProjectFiles(entries);

    return () => {
      blobUrlsToRevoke.forEach((u) => URL.revokeObjectURL(u));
      currentProjectFileUrlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId]);

  // ── Login sync ─────────────────────────────────────────────────────────────

  async function syncOnLogin(loggedInUser: User) {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    setIsSyncing(true);
    try {
      const cloudStore = new SupabaseProjectStore(getSupabase(), loggedInUser.id);

      // 1. Fetch both sides
      const [localRows, cloudProjects] = await Promise.all([
        db.projects.orderBy("lastUpdated").reverse()
          .filter((p) => !p.userId || p.userId === loggedInUser.id)
          .toArray(),
        cloudStore.fetchCloudProjects().catch(() => [] as Project[]),
      ]);
      const localProjects = localRows.map(dbToProject);

      // 2. Tag all currently anonymous local projects with this userId
      const anonIds = localRows.filter((r) => !r.userId).map((r) => r.id);
      if (anonIds.length > 0) {
        await db.projects.where("id").anyOf(anonIds).modify({ userId: loggedInUser.id, origin: "local" });
      }

      // 3. Plan the sync
      const { toUpload, toDownload, toMerge } = planSync(localProjects, cloudProjects);

      // 4. Upload local-only projects to cloud (sequential to avoid Supabase auth-lock race)
      for (const p of toUpload) {
        await cloudStore.putProject({ ...p, origin: "local" } as any);
      }

      // 5. Download cloud-only projects to local cache (sequential)
      for (const p of toDownload) {
        await cloudStore.cacheCloudProject(p);
      }

      // 6. Resolve conflicts
      for (const { local, cloud } of toMerge) {
        const merged = resolveConflict(local, cloud);
        // Upload the merged version to cloud if local is newer or merged has more checks
        if (local.lastUpdated >= cloud.lastUpdated) {
          await cloudStore.putProject({ ...merged, origin: "local" } as any);
        } else {
          // Cloud wins overall; write merged to both
          await cloudStore.cacheCloudProject(merged);
          await cloudStore.putProject({ ...merged, origin: "synced" } as any).catch(() => {});
        }
      }

      // 7. Reload from local cache and update state
      const mergedRows = await db.projects
        .orderBy("lastUpdated").reverse()
        .filter((p) => p.userId === loggedInUser.id)
        .toArray();
      setProjects(mergedRows.map(dbToProject));

    } catch (err) {
      console.error("[KnitStep] Sync failed:", err);
    } finally {
      setIsSyncing(false);
      syncInProgressRef.current = false;
    }
  }

  // ── Auth actions ───────────────────────────────────────────────────────────

  async function login(email: string, password: string): Promise<void> {
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async function signup(email: string, password: string): Promise<void> {
    const { error } = await getSupabase().auth.signUp({ email, password });
    if (error) throw error;
  }

  async function loginWithGoogle(): Promise<void> {
    const { error } = await getSupabase().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) throw error;
  }

  async function logout(): Promise<void> {
    const prevUserId = user?.id;
    await getSupabase().auth.signOut();
    // Clean up cloud-synced cache for this user
    if (prevUserId) {
      await db.projects
        .filter((p) => p.userId === prevUserId && p.origin === "synced")
        .delete();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  function markHydrated() {
    hydrated.current = true;
  }

  async function loadProjects(
    savedProjectId: string | null,
    onProjectRestored: (project: Project) => void,
  ) {
    try {
      // One-time migration: move old localStorage project array into Dexie
      const rawLegacy = localStorage.getItem("knitstep-projects");
      if (rawLegacy) {
        try {
          const legacy: any[] = JSON.parse(rawLegacy);
          if (Array.isArray(legacy) && legacy.length > 0) {
            await db.projects.bulkPut(
              legacy.map((p) => ({
                id:          String(p.id ?? Date.now()),
                name:        p.name ?? "Project",
                steps:       p.steps ?? [],
                rowCount:    p.rowCount ?? 0,
                lastUpdated: p.lastUpdated ?? Date.now(),
                userId:      null,
                origin:      "local" as const,
              }))
            );
          }
        } catch { /* ignore corrupt legacy data */ }
        localStorage.removeItem("knitstep-projects");
      }

      const loaded = await store.getAllProjects();
      setProjects(loaded);

      const activeProject = savedProjectId
        ? loaded.find((p) => p.id === savedProjectId)
        : undefined;
      if (activeProject) {
        onProjectRestored(activeProject);
      } else if (savedProjectId) {
        // If auth hasn't resolved yet, the user may be logged in and their
        // projects not yet visible — stash the callback for INITIAL_SESSION
        // to call once projects are loaded.  Don't erase the saved project ID.
        if (authLoading) {
          pendingRestoreRef.current = { savedProjectId, onProjectRestored };
        } else {
          localStorage.removeItem("knitstep-current-project");
        }
      }
    } catch (err) {
      console.error("[KnitStep] Failed to load projects:", err);
    }
  }

  async function saveNewProject(parsed: Step[], files: File[], lang: string, gridData?: GridData) {
    if (parsed.filter((s) => !s.isHeader).length === 0 && !gridData) return;

    const now = Date.now();
    const d   = new Date(now);
    const projectName =
      lang === "zh"
        ? `${d.getMonth() + 1}月${d.getDate()}日 项目`
        : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} Project`;

    const storedFiles: StoredFile[] = files.length > 0
      ? await Promise.all(files.map(fileToStoredFile))
      : [];

    const newProject: Project = {
      id:             now.toString(),
      name:           projectName,
      steps:          parsed,
      rowCount:       parsed.filter((s) => !s.isHeader).length,
      lastUpdated:    now,
      originalFiles:  storedFiles.length > 0 ? storedFiles : undefined,
      availableSizes: getAvailableSizes(parsed),
      selectedSize:   "all",
      type:           gridData ? "grid" : "instruction",
      gridData,
    };
    setSelectedSize("all");
    try {
      await store.putProject(newProject);
    } catch (dbErr) {
      console.error("[KnitStep] Failed to save project:", dbErr);
    }
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(now.toString());
  }

  function selectProject(project: Project) {
    setCurrentProjectId(project.id);
    setSelectedSize(project.selectedSize ?? "all");
  }

  function handleLoadProject(id: string): Project | undefined {
    const project = projects.find((p) => p.id === id);
    if (project) selectProject(project);
    return project;
  }

  /** Rehydrate a cloud-synced project's images when it's opened. */
  async function rehydrateIfNeeded(project: Project): Promise<Project> {
    if (!user) return project;
    const cloudStore = store as SupabaseProjectStore;
    if (typeof cloudStore.rehydrate !== "function") return project;
    try {
      const rehydrated = await cloudStore.rehydrate(project);
      if (rehydrated !== project) {
        setProjects((prev) => prev.map((p) => p.id === project.id ? rehydrated : p));
      }
      return rehydrated;
    } catch {
      return project;
    }
  }

  function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (currentProjectId === id) setCurrentProjectId(null);
    store
      .deleteProject(id)
      .catch((err) => console.error("[KnitStep] Failed to delete project:", err));
  }

  function handleRenameProject(id: string, name: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    store
      .patchProject(id, { name })
      .catch((err) => console.error("[KnitStep] Failed to rename project:", err));
  }

  async function saveTrackerProject(trackerData: TrackerData, files: File[], lang: string) {
    const now = Date.now();
    const d   = new Date(now);
    const projectName =
      lang === "zh"
        ? `${d.getMonth() + 1}月${d.getDate()}日 图解`
        : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} Chart`;

    const storedFiles: StoredFile[] = files.length > 0
      ? await Promise.all(files.map(fileToStoredFile))
      : [];

    const newProject: Project = {
      id:             now.toString(),
      name:           projectName,
      steps:          [],
      rowCount:       trackerData.rows,
      lastUpdated:    now,
      originalFiles:  storedFiles.length > 0 ? storedFiles : undefined,
      availableSizes: [],
      selectedSize:   "all",
      type:           "tracker",
      trackerData,
    };

    try {
      await store.putProject(newProject);
    } catch (dbErr) {
      console.error("[KnitStep] Failed to save tracker project:", dbErr);
    }
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(now.toString());
  }

  async function updateGridCalibration(id: string, gridData: GridData) {
    const now = Date.now();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, gridData, rowCount: gridData.totalRows, lastUpdated: now }
          : p
      )
    );
    try {
      await store.patchProject(id, { gridData, rowCount: gridData.totalRows, lastUpdated: now });
    } catch (dbErr) {
      console.error("[KnitStep] Failed to update grid calibration:", dbErr);
    }
  }

  function updateGridProgress(id: string, currentRow: number) {
    const proj = projects.find((p) => p.id === id);
    if (!proj?.gridData) return;
    const now        = Date.now();
    const newGridData = { ...proj.gridData, currentRow };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, gridData: newGridData, lastUpdated: now } : p
      )
    );
    store
      .patchProject(id, { gridData: newGridData, lastUpdated: now })
      .catch((err) => console.error("[KnitStep] Failed to update grid progress:", err));
  }

  async function saveCrochetProject(crochetData: CrochetData, files: File[], lang: string) {
    const now  = Date.now();
    const d    = new Date(now);
    const projectName =
      lang === "zh"
        ? `${d.getMonth() + 1}月${d.getDate()}日 钩针图解`
        : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} Crochet`;

    const storedFiles: StoredFile[] = files.length > 0
      ? await Promise.all(files.map(fileToStoredFile))
      : [];

    const newProject: Project = {
      id:             now.toString(),
      name:           projectName,
      steps:          [],
      rowCount:       crochetData.totalRows,
      lastUpdated:    now,
      originalFiles:  storedFiles.length > 0 ? storedFiles : undefined,
      availableSizes: [],
      selectedSize:   "all",
      type:           "crochet",
      crochetData,
    };

    try {
      await store.putProject(newProject);
    } catch (dbErr) {
      console.error("[KnitStep] Failed to save crochet project:", dbErr);
    }
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(now.toString());
  }

  async function updateCrochetCalibration(id: string, crochetData: CrochetData) {
    const now = Date.now();
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, crochetData, rowCount: crochetData.totalRows, lastUpdated: now }
          : p
      )
    );
    try {
      await store.patchProject(id, { crochetData, rowCount: crochetData.totalRows, lastUpdated: now });
    } catch (dbErr) {
      console.error("[KnitStep] Failed to update crochet calibration:", dbErr);
    }
  }

  function updateCrochetProgress(id: string, currentRow: number) {
    const proj = projects.find((p) => p.id === id);
    if (!proj?.crochetData) return;
    const now            = Date.now();
    const newCrochetData = { ...proj.crochetData, currentRow };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, crochetData: newCrochetData, lastUpdated: now } : p
      )
    );
    store
      .patchProject(id, { crochetData: newCrochetData, lastUpdated: now })
      .catch((err) => console.error("[KnitStep] Failed to update crochet progress:", err));
  }

  function updateTrackerPatternMeta(id: string, patternMeta: PatternMeta) {
    const proj = projects.find((p) => p.id === id);
    if (!proj?.trackerData) return;
    const now            = Date.now();
    const newTrackerData = { ...proj.trackerData, patternMeta };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, trackerData: newTrackerData, lastUpdated: now } : p
      )
    );
    store
      .patchProject(id, { trackerData: newTrackerData, lastUpdated: now })
      .catch((err) => console.error("[KnitStep] Failed to save patternMeta:", err));
  }

  function updateTrackerProgress(id: string, currentRow: number) {
    const proj = projects.find((p) => p.id === id);
    if (!proj?.trackerData) return;
    const now            = Date.now();
    const newTrackerData = { ...proj.trackerData, currentRow };
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, trackerData: newTrackerData, lastUpdated: now } : p
      )
    );
    store
      .patchProject(id, { trackerData: newTrackerData, lastUpdated: now })
      .catch((err) => console.error("[KnitStep] Failed to update tracker progress:", err));
  }

  return {
    // State
    projects, setProjects,
    currentProjectId, setCurrentProjectId,
    selectedSize, setSelectedSize,
    storageWarning, setStorageWarning,
    currentProjectFiles,
    currentFileIndex, setCurrentFileIndex,
    hasClickedTarget, setHasClickedTarget,
    currentProjectFileUrlsRef,
    hydrated,
    // Auth state
    user,
    authLoading,
    isSyncing,
    // Auth actions
    login,
    signup,
    loginWithGoogle,
    logout,
    // Project actions
    markHydrated,
    loadProjects,
    saveNewProject,
    selectProject,
    handleLoadProject,
    rehydrateIfNeeded,
    handleDeleteProject,
    handleRenameProject,
    updateGridCalibration,
    updateGridProgress,
    saveTrackerProject,
    updateTrackerPatternMeta,
    updateTrackerProgress,
    saveCrochetProject,
    updateCrochetCalibration,
    updateCrochetProgress,
  };
}
