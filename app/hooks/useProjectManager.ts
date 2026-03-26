"use client";

import { useState, useEffect, useRef } from "react";
import { db } from "../lib/db";
import {
  isStoredFile, getAvailableSizes, fileToStoredFile,
  type Step, type Project,
} from "../lib/types";
import type { StoredFile } from "../lib/db";

// ─── useProjectManager ────────────────────────────────────────────────────────
// Owns all IndexedDB state and operations, plus the blob-URL lifecycle for the
// reference panel.  Pass `steps` (from page state) so the sync effect can write
// the latest checklist progress to the database without page.tsx touching db.

export function useProjectManager({
  steps,
  mounted,
}: {
  steps: Step[];
  mounted: boolean;
}) {
  const [projects, setProjects]             = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [selectedSize, setSelectedSize]     = useState<string>("all");
  const [storageWarning, setStorageWarning] = useState(false);

  // Reference-panel file state
  const [currentProjectFiles, setCurrentProjectFiles] = useState<{ url: string; mimeType: string }[]>([]);
  const [currentFileIndex, setCurrentFileIndex]       = useState(0);
  const [hasClickedTarget, setHasClickedTarget]       = useState(false);
  const currentProjectFileUrlsRef = useRef<string[]>([]);

  // Prevents effects from firing with stale data before the first localStorage
  // restore completes.  Set to true via markHydrated() called by page.tsx.
  const hydrated = useRef(false);

  // ── Persist active project ID to localStorage ──────────────────────────────
  useEffect(() => {
    if (!hydrated.current) return;
    if (currentProjectId) {
      localStorage.setItem("knitstep-current-project", currentProjectId);
    } else {
      localStorage.removeItem("knitstep-current-project");
    }
  }, [currentProjectId]);

  // ── Sync checklist progress → IndexedDB whenever steps change ──────────────
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
    db.projects
      .update(currentProjectId, {
        steps,
        rowCount: steps.filter((s) => !s.isHeader).length,
        lastUpdated: now,
      })
      .catch((err) => console.error("[KnitStep] Failed to sync project:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps, currentProjectId]);

  // ── Persist selected size preference ───────────────────────────────────────
  useEffect(() => {
    if (!hydrated.current) return;
    if (!currentProjectId) return;
    db.projects
      .update(currentProjectId, { selectedSize })
      .catch((err) => console.error("[KnitStep] Failed to persist selectedSize:", err));
  }, [selectedSize, currentProjectId]);

  // ── Storage usage monitor — warn at > 50 MB ────────────────────────────────
  useEffect(() => {
    if (!mounted) return;
    let totalBytes = 0;
    for (const p of projects) {
      for (const f of p.originalFiles ?? []) {
        totalBytes += isStoredFile(f) ? Math.ceil(f.data.length * 0.75) : (f as Blob).size;
      }
      if (p.originalFile) totalBytes += (p.originalFile as Blob).size;
    }
    setStorageWarning(totalBytes > 50 * 1024 * 1024);
  }, [projects, mounted]);

  // ── Generate blob URLs for the reference panel ─────────────────────────────
  // Re-runs whenever the active project changes.  All created URLs are revoked
  // in the cleanup function to prevent memory leaks / mobile "Undefined Pointer"
  // crashes caused by dangling blob object references.
  useEffect(() => {
    setCurrentFileIndex(0);
    setHasClickedTarget(false);

    if (!currentProjectId) {
      setCurrentProjectFiles([]);
      return;
    }

    // `projects` is read from closure — it holds the latest array because
    // selectProject / saveNewProject always set currentProjectId in the same
    // React batch as setProjects(), so by the time this effect runs the array
    // is already up to date.
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

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Call once from page.tsx's hydration effect, just before setMounted(true). */
  function markHydrated() {
    hydrated.current = true;
  }

  /**
   * Load all projects from IndexedDB (with legacy localStorage migration).
   * Calls onProjectRestored if the previously active project is found so
   * page.tsx can restore steps / hasConverted / isInputExpanded.
   */
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
              }))
            );
          }
        } catch { /* ignore corrupt legacy data */ }
        localStorage.removeItem("knitstep-projects");
      }

      const dbProjects = await db.projects.orderBy("lastUpdated").reverse().toArray();
      const loaded: Project[] = dbProjects.map((p) => ({
        ...p,
        availableSizes: p.availableSizes ?? getAvailableSizes(p.steps),
        selectedSize:   p.selectedSize   ?? "all",
      }));
      setProjects(loaded);

      const activeProject = savedProjectId
        ? loaded.find((p) => p.id === savedProjectId)
        : undefined;
      if (activeProject) {
        onProjectRestored(activeProject);
      } else if (savedProjectId) {
        localStorage.removeItem("knitstep-current-project");
      }
    } catch (err) {
      console.error("[KnitStep] Failed to load projects from IndexedDB:", err);
    }
  }

  /**
   * Persist a newly converted project to IndexedDB and update local state.
   * Raw File objects are serialised to StoredFile (base64) for iOS Safari
   * compatibility.  No-op if parsed contains no actionable steps.
   */
  async function saveNewProject(parsed: Step[], files: File[], lang: string) {
    if (parsed.filter((s) => !s.isHeader).length === 0) return;

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
    };
    setSelectedSize("all");
    try {
      await db.projects.put(newProject);
    } catch (dbErr) {
      console.error("[KnitStep] Failed to save project to IndexedDB:", dbErr);
    }
    setProjects((prev) => [newProject, ...prev]);
    setCurrentProjectId(now.toString());
  }

  /** Activate a project (sets ID + size; page.tsx handles steps / hasConverted). */
  function selectProject(project: Project) {
    setCurrentProjectId(project.id);
    setSelectedSize(project.selectedSize ?? "all");
  }

  /** Find a project by ID, activate it, and return it (undefined if not found). */
  function handleLoadProject(id: string): Project | undefined {
    const project = projects.find((p) => p.id === id);
    if (project) selectProject(project);
    return project;
  }

  /** Delete a project from state and IndexedDB. */
  function handleDeleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (currentProjectId === id) setCurrentProjectId(null);
    db.projects
      .delete(id)
      .catch((err) => console.error("[KnitStep] Failed to delete project:", err));
  }

  /** Rename a project in state and IndexedDB. */
  function handleRenameProject(id: string, name: string) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    db.projects
      .update(id, { name })
      .catch((err) => console.error("[KnitStep] Failed to rename project:", err));
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
    // Actions
    markHydrated,
    loadProjects,
    saveNewProject,
    selectProject,
    handleLoadProject,
    handleDeleteProject,
    handleRenameProject,
  };
}
