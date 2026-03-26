"use client";

import { useState, useEffect, useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { db, type StoredFile } from "./lib/db";
import {
  dict, parseInput, getAvailableSizes, renderStepText,
  compressImage, isStoredFile, fileToStoredFile,
  ACCESS_CODE, MAX_IMAGES,
  type Lang, type Step, type Project,
} from "./lib/types";
import ImportSection from "./components/ImportSection";
import ChecklistView from "./components/ChecklistView";
import ProjectGallery from "./components/ProjectGallery";
import ReferencePanel from "./components/ReferencePanel";
import {
  Folder, ChevronUp, ChevronLeft, ChevronRight, FileText, X, Target,
} from "lucide-react";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  // ── State ──
  const [lang, setLang]                 = useState<Lang>("zh");
  const [inputText, setInputText]       = useState<string>("");
  const [steps, setSteps]               = useState<Step[]>([]);
  const [hasConverted, setHasConverted] = useState(false);
  const [activeTab, setActiveTab]       = useState<"text" | "ai">("ai");
  const [isLoading, setIsLoading]       = useState(false);
  const [errorMsg, setErrorMsg]         = useState<string | null>(null);
  const [uploadedImages, setUploadedImages] = useState<{
    base64: string; mimeType: string; previewUrl: string;
  }[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [tipVisible, setTipVisible]       = useState(true);
  const [mounted, setMounted]             = useState(false);
  const [projects, setProjects]                     = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId]     = useState<string | null>(null);
  const [selectedSize, setSelectedSize]             = useState<string>("all");
  const [showProjectsModal, setShowProjectsModal]   = useState(false);
  const [isEditMode, setIsEditMode]                 = useState(false);
  const [showBackToTop, setShowBackToTop]           = useState(false);
  const [aiSubTab, setAiSubTab]                     = useState<"photo" | "video">("photo");
  const [videoUrl, setVideoUrl]                     = useState("");
  const [isUnlocked, setIsUnlocked]                 = useState(false);
  const [codeInput, setCodeInput]                   = useState("");
  const [codeError, setCodeError]                   = useState(false);
  const [showReferencePanel, setShowReferencePanel]     = useState(false);
  const [highlightedStepId, setHighlightedStepId]       = useState<number | null>(null);
  const [activeMenuStepId, setActiveMenuStepId]         = useState<number | null>(null);
  const [currentProjectFiles, setCurrentProjectFiles]   = useState<{ url: string; mimeType: string }[]>([]);
  const [storageWarning, setStorageWarning]             = useState(false);
  const [currentFileIndex, setCurrentFileIndex]         = useState(0);
  const currentProjectFileUrlsRef = useRef<string[]>([]);
  const [hasClickedTarget, setHasClickedTarget]         = useState(false);
  const [isInputExpanded, setIsInputExpanded]       = useState(true);
  const [dragIndex, setDragIndex]                   = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex]           = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex]           = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 320);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Dismiss the step context menu when the user clicks outside any step row
  useEffect(() => {
    if (activeMenuStepId === null) return;
    function handleOutside(e: PointerEvent) {
      if (!(e.target as Element).closest("[data-step-menu]")) {
        setActiveMenuStepId(null);
      }
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [activeMenuStepId]);
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number | null>(null);

  // Countdown timer for rate-limit (429)
  useEffect(() => {
    if (!rateLimitSecondsLeft) return;
    const timer = setTimeout(
      () => setRateLimitSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [rateLimitSecondsLeft]);

  // Lightbox keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")  setLightboxIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i !== null ? Math.min(uploadedImages.length - 1, i + 1) : null));
      if (e.key === "Escape")     setLightboxIndex(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, uploadedImages.length]);

  // Guards against saving before hydration completes (avoids overwriting restored data)
  const hydrated = useRef(false);
  // Holds all uploaded original Files (accumulates per session) so they can be persisted in IndexedDB
  const latestFilesRef = useRef<File[]>([]);
  // Ref for the checklist top anchor (used by floating nav "list top" button)
  const checklistTopRef = useRef<HTMLDivElement>(null);

  // ── Hydration — restore all state from localStorage on first mount ──
  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedLang = localStorage.getItem("knitstep-lang");
    const savedData = localStorage.getItem("knitstep-data");

    // Priority: ?lang= URL param → localStorage → browser language → "zh"
    const urlParam = new URLSearchParams(window.location.search).get("lang");
    const restoredLang: Lang =
      urlParam === "zh" || urlParam === "en" ? urlParam :
      savedLang === "zh" || savedLang === "en" ? savedLang :
      navigator.language.startsWith("zh") ? "zh" : "en";
    setLang(restoredLang);
    localStorage.setItem("knitstep-lang", restoredLang);

    if (savedData) {
      try {
        const { inputText: si, steps: ss, hasConverted: sc } = JSON.parse(savedData);
        if (typeof si === "string") setInputText(si);
        if (Array.isArray(ss))     setSteps(ss);
        if (typeof sc === "boolean") setHasConverted(sc);
      } catch {
        // Corrupt data — start fresh
      }
    }

    if (localStorage.getItem("knitstep-tip-dismissed") === "1") setTipVisible(false);

    if (localStorage.getItem("knitstep_access_granted") === "1") setIsUnlocked(true);

    // ── Capture the saved project ID NOW, before hydrated.current = true ──
    // The currentProjectId persistence effect runs immediately after the
    // hydration effect (React executes effects in definition order on first
    // mount). That effect has no hydration guard, so it fires with
    // currentProjectId = null and calls localStorage.removeItem(...).
    // If we read the key inside the async IIFE — which runs AFTER all first-
    // mount effects have fired — the key is already gone and selectProject
    // is never called, leaving currentProjectId = null permanently.
    const savedProjectId = localStorage.getItem("knitstep-current-project");

    hydrated.current = true;
    setMounted(true);


    // ── Load projects from IndexedDB; migrate localStorage data if present ──
    (async () => {
      try {
        // Migration: if old localStorage projects exist, move them into Dexie once
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

        // Load all projects sorted newest-first
        const dbProjects = await db.projects.orderBy("lastUpdated").reverse().toArray();
        const loaded: Project[] = dbProjects.map((p) => ({
          ...p,
          availableSizes: p.availableSizes ?? getAvailableSizes(p.steps),
          selectedSize:   p.selectedSize   ?? "all",
        }));
        setProjects(loaded);

        // Restore the full active project. Use savedProjectId captured above
        // (before hydrated.current = true) — by this point the persistence
        // effect has already erased the key from localStorage.
        const activeProject = savedProjectId
          ? loaded.find((p) => p.id === savedProjectId)
          : undefined;
        if (activeProject) {
          selectProject(activeProject);
        } else if (savedProjectId) {
          localStorage.removeItem("knitstep-current-project");
        }
      } catch (err) {
        console.error("[KnitStep] Failed to load projects from IndexedDB:", err);
      }
    })();
  }, []);

  // ── Persistence — save whenever relevant state changes ──
  useEffect(() => {
    if (!hydrated.current) return;
    if (typeof window === "undefined") return;
    localStorage.setItem(
      "knitstep-data",
      JSON.stringify({ inputText, steps, hasConverted })
    );
  }, [inputText, steps, hasConverted]);

  // ── Persist active project ID so the sync effect survives page refreshes ──
  useEffect(() => {
    if (!hydrated.current) return;
    if (currentProjectId) {
      localStorage.setItem("knitstep-current-project", currentProjectId);
    } else {
      localStorage.removeItem("knitstep-current-project");
    }
  }, [currentProjectId]);

  // ── Project sync — update active project in state + IndexedDB whenever steps change ──
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

  // ── Persist selectedSize preference for the active project ──
  useEffect(() => {
    if (!hydrated.current) return;
    if (!currentProjectId) return;
    db.projects
      .update(currentProjectId, { selectedSize })
      .catch((err) => console.error("[KnitStep] Failed to persist selectedSize:", err));
  }, [selectedSize, currentProjectId]);

  // ── Storage monitoring — warn when total blob data across all projects exceeds 50 MB ──
  useEffect(() => {
    if (!mounted) return;
    let totalBytes = 0;
    for (const p of projects) {
      for (const f of p.originalFiles ?? []) {
        // StoredFile: base64 length * 0.75 ≈ original byte size
        totalBytes += isStoredFile(f) ? Math.ceil(f.data.length * 0.75) : (f as Blob).size;
      }
      if (p.originalFile) totalBytes += (p.originalFile as Blob).size;
    }
    setStorageWarning(totalBytes > 50 * 1024 * 1024);
  }, [projects, mounted]);

  // ── Generate blob URLs for the reference panel whenever the active project changes ──
  // Uses the already-loaded `projects` state — no extra DB round-trip, so URLs are
  // ready synchronously in the same render cycle as the currentProjectId change.
  useEffect(() => {
    setCurrentFileIndex(0);
    setHasClickedTarget(false);

    if (!currentProjectId) {
      setCurrentProjectFiles([]);
      return;
    }

    // projects is intentionally read from closure (not in deps) — it always holds
    // the latest value because selectProject sets currentProjectId in the same
    // React batch as setProjects(loaded), so by the time this effect runs the
    // projects array is already populated.
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

    // Build blob URLs for every file. StoredFile (base64) is reconstructed into a
    // Blob first. All URLs are tracked and revoked on cleanup to prevent leaks.
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

  function toggleLang() {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("knitstep-lang", next);
  }

  const t = dict[lang];

  async function handleFileUpload(file: File, currentCount?: number) {
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;  // 5 MB for images
    const MAX_FILE_BYTES  = 10 * 1024 * 1024; // 10 MB for PDFs
    const limit = file.type.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) {
      setErrorMsg(t.errorFileTooLarge);
      return;
    }
    setErrorMsg(null);

    if (file.type.startsWith("image/")) {
      // Accumulate originals for IndexedDB storage
      latestFilesRef.current = [...latestFilesRef.current, file];
      // currentCount lets batch callers pass the pre-loop count to avoid stale closure
      if ((currentCount ?? uploadedImages.length) >= MAX_IMAGES) {
        setErrorMsg(t.errorMaxImages);
        return;
      }
      setIsCompressing(true);
      try {
        const compressed = await compressImage(file);
        setUploadedImages((prev) => [...prev, compressed]);
      } catch {
        // Fall back to raw file if compression errors
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const [header, base64] = dataUrl.split(",");
          const mimeType = header.split(":")[1].split(";")[0];
          setUploadedImages((prev) => [...prev, { base64, mimeType, previewUrl: dataUrl }]);
        };
        reader.readAsDataURL(file);
      } finally {
        setIsCompressing(false);
      }
    } else {
      // PDF — replace the entire list (PDFs are always single-file)
      latestFilesRef.current = [file];
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const [header, base64] = dataUrl.split(",");
        const mimeType = header.split(":")[1].split(";")[0];
        setUploadedImages([{ base64, mimeType, previewUrl: dataUrl }]);
      };
      reader.readAsDataURL(file);
    }
  }

  async function handleConvert() {
    setIsLoading(true);
    setErrorMsg(null);
    setRateLimitSecondsLeft(null);

    // Clear old state before starting; nulling currentProjectId prevents the sync
    // effect from overwriting the active project with empty steps mid-conversion.
    setIsEditMode(false);
    setCurrentProjectId(null);
    setSteps([]);
    setHasConverted(false);
    latestFilesRef.current = uploadedImages.length > 0 ? latestFilesRef.current : [];

    try {
      // ── Step 1: Fetch from Gemini; text tab falls back to regex on AI failure ──
      let parsed: Step[];
      try {
        let res: Response;
        if (activeTab === "ai" && aiSubTab === "video") {
          res = await fetch("/api/parse-video", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ videoUrl: videoUrl.trim(), language: lang, accessCode: ACCESS_CODE }),
          });
        } else {
          const body = activeTab === "ai" && uploadedImages.length > 0
            ? { text: "", language: lang, images: uploadedImages.map((img) => ({ base64: img.base64, mimeType: img.mimeType })), accessCode: ACCESS_CODE }
            : { text: inputText, language: lang, accessCode: ACCESS_CODE };
          res = await fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "UNKNOWN_ERROR");

        // ── sizeMap / sourceBox preserved here so Smart Sizing & visual grounding work ──
        const rawSteps: { text: string; original?: string; isHeader?: boolean; sizeMap?: Record<string, string>; sourceBox?: [number, number, number, number]; sourceFileIndex?: number }[] = data.steps;
        const base = Date.now();
        parsed = rawSteps.map((s, idx) => ({
          id:              base + idx,
          text:            s.text,
          original:        s.original,
          checked:         false,
          isHeader:        s.isHeader,
          sizeMap:         s.sizeMap,
          sourceBox:       s.sourceBox,
          sourceFileIndex: s.sourceFileIndex,
        }));
      } catch (aiErr: any) {
        // AI / video tabs: re-throw so the outer catch shows the right error message
        if (activeTab !== "text") throw aiErr;
        // Text tab: silently fall back to the original line-by-line regex parser
        const base = Date.now();
        parsed = parseInput(inputText).map((s, i) => ({ ...s, id: base + i }));
      }

      // ── Step 2: Commit parsed steps to state & persist project ──
      setSteps(parsed);
      setHasConverted(true);

      if (parsed.filter((s) => !s.isHeader).length > 0) {
        const now = Date.now();
        const d   = new Date(now);
        const projectName =
          lang === "zh"
            ? `${d.getMonth() + 1}月${d.getDate()}日 项目`
            : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} Project`;
        // Convert raw File objects → StoredFile (base64) before persisting.
        // Storing plain Blob/File in IndexedDB is unreliable on iOS Safari.
        const storedFiles: StoredFile[] = latestFilesRef.current.length > 0
          ? await Promise.all(latestFilesRef.current.map(fileToStoredFile))
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
    } catch (err: any) {
      const msg = err?.message ?? "";
      if      (msg === "QUOTA_EXCEEDED")         { setRateLimitSecondsLeft(30); }
      else if (msg === "FILE_TOO_LARGE")         setErrorMsg(t.errorFileTooLarge);
      else if (msg === "API_KEY_MISSING")        setErrorMsg(t.errorKey);
      else if (msg === "MODEL_UNAVAILABLE")      setErrorMsg(t.errorModel);
      else if (msg === "VIDEO_PROCESSING_FAILED" || msg === "NO_TEXT_EXTRACTED") setErrorMsg(t.errorVideoFailed);
      else                                       setErrorMsg(t.errorUnknown);
    } finally {
      setIsLoading(false);
    }
  }

  // 清除功能：重置所有状态并清空缓存
  function handleClear() {
    if (confirm(lang === "zh" ? "确定要清除所有进度并重新开始吗？" : "Clear all progress and restart?")) {
      setIsEditMode(false);
      setCurrentProjectId(null);
      setSelectedSize("all");
      setSteps([]);
      setHasConverted(false);
      setInputText("");
      localStorage.removeItem("knitstep-data");
      // 强制页面稍微滚动到顶部
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function handleUnlock() {
    if (codeInput.trim().toUpperCase() === ACCESS_CODE) {
      localStorage.setItem("knitstep_access_granted", "1");
      setIsUnlocked(true);
    } else {
      setCodeError(true);
      setTimeout(() => setCodeError(false), 600);
    }
  }

  function toggleStep(id: number) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        return { ...s, checked: !s.checked };
      })
    );
  }

  function updateSubCount(id: number, delta: number) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const max = parseMaxCount(s);
        const raw = (s.subCount ?? 0) + delta;
        const capped = max !== null ? Math.min(max, Math.max(0, raw)) : Math.max(0, raw);
        return {
          ...s,
          subCount: capped,
          checked: max !== null && capped >= max ? true : s.checked,
        };
      })
    );
  }

  function parseMaxCount(step: Step): number | null {
    if (step.count && step.count > 1) return step.count;
    const text = step.text;
    let m = text.match(/(\d+)[-–](\d+)\s*行/);
    if (m) {
      const isApprox = /(?:约|大约|approximately|around|~)\s*\d+[-–]/.test(text);
      return isApprox ? null : parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    }
    m = text.match(/\brows?\s+(\d+)[-–](\d+)\b/i);
    if (m) return parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
    m = text.match(/\b(\d+)\s+rows?\b/i);
    if (m) return parseInt(m[1], 10);
    const allRowNums = [...text.matchAll(/(?<!第)(\d+)\s*行/g)];
    if (allRowNums.length > 0) return parseInt(allRowNums[allRowNums.length - 1][1], 10);
    return null;
  }

  function dismissTip() {
    setTipVisible(false);
    localStorage.setItem("knitstep-tip-dismissed", "1");
  }

  function handleTextEdit(id: number, newText: string) {
    setSteps((prev) => prev.map((s) => s.id === id ? { ...s, text: newText } : s));
  }

  function handleReset() {
    if (!confirm(t.resetConfirm)) return;
    setSteps((prev) => prev.map((s) => ({ ...s, checked: false, subCount: 0 })));
  }

  function scrollToChecklistTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function scrollToFirstUnchecked() {
    const uncheckedIdx = steps.findIndex((s) => !s.isHeader && !s.checked);
    if (uncheckedIdx === -1) return;
    const firstUnchecked = steps[uncheckedIdx];
    // Scroll to the step before for visual context
    const targetIdx = Math.max(0, uncheckedIdx - 1);
    const targetId = steps[targetIdx].id;
    document.getElementById(`step-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Flash-highlight the actual first unchecked step
    setHighlightedStepId(firstUnchecked.id);
    setTimeout(() => setHighlightedStepId(null), 1100);
  }

  function addStep(insertAt: number) {
    setSteps((prev) => {
      const newStep: Step = { id: Date.now(), text: lang === "zh" ? "新步骤" : "New step", checked: false };
      const next = [...prev];
      next.splice(insertAt, 0, newStep);
      return next;
    });
  }

  function deleteStep(id: number) {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }

  // ── Central project-activation helper ──────────────────────────────────────
  // Single source of truth for switching the active project.  Call this both
  // on hydration (mount) and when the user picks a project from the modal.
  function selectProject(project: Project) {
    setCurrentProjectId(project.id);
    setSteps(project.steps);
    setHasConverted(true);
    setSelectedSize(project.selectedSize ?? "all");
    setIsInputExpanded(false);
  }

  function handleLoadProject(id: string) {
    const project = projects.find((p) => p.id === id);
    if (!project) return;
    selectProject(project);
    setShowProjectsModal(false);
  }

  function handleDeleteProject(id: string) {
    if (!confirm(t.deleteConfirm)) return;
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (currentProjectId === id) setCurrentProjectId(null);
    db.projects
      .delete(id)
      .catch((err) => console.error("[KnitStep] Failed to delete project:", err));
  }

  function handleRenameProject(id: string, name: string) {
    setProjects((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
    db.projects
      .update(id, { name })
      .catch((err) => console.error("[KnitStep] Failed to rename project:", err));
  }

  function handlePrint() {
    const currentProject = currentProjectId
      ? projects.find((p) => p.id === currentProjectId)
      : null;
    const printTitle = currentProject?.name ?? (lang === "zh" ? "KnitStep · 织步" : "KnitStep");

    function esc(s: string) {
      return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // When a specific size is selected, render each step's size-specific text;
    // otherwise fall back to step.text (which already contains all sizes).
    const stepsHtml = steps.map((step) => {
      if (step.isHeader) {
        return `<div class="hdr">${esc(step.text)}</div>`;
      }
      const displayText = esc(renderStepText(step, selectedSize));
      return `<div class="step${step.checked ? " done" : ""}">
        <span class="chk">${step.checked ? "✓" : "○"}</span>
        <div>
          <div class="txt">${displayText}</div>
          ${step.original ? `<div class="orig">${esc(step.original)}</div>` : ""}
        </div>
      </div>`;
    }).join("");

    const sizeBadgeHtml = selectedSize !== "all"
      ? `<div class="size-badge">${lang === "zh" ? "尺码" : "Size"}: <strong>${esc(selectedSize)}</strong></div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KnitStep</title>
<style>
  @page { size: A4; margin: 20mm 15mm; }
  body { font-family: system-ui, -apple-system, sans-serif; color: #111; max-width: 640px; margin: 0 auto; padding: 20px; }
  h1 { text-align: center; font-size: 18pt; margin: 0 0 4pt; }
  .sub { text-align: center; font-size: 9pt; color: #888; margin: 0 0 10pt; }
  .size-badge { text-align: center; font-size: 10pt; color: #5a7a63; background: #eef4ef; border: 1px solid #c2d9c7; border-radius: 20px; display: inline-block; padding: 3px 14px; margin: 0 auto 14pt; }
  .size-wrap { text-align: center; margin-bottom: 14pt; }
  .hdr { background: #8faf96; color: #fff; font-weight: 700; border-radius: 6px; padding: 6px 12px; margin-bottom: 5px; font-size: 10pt; }
  .step { display: flex; align-items: flex-start; gap: 10px; border: 1px solid #d1d5db; border-radius: 6px; padding: 7px 12px; margin-bottom: 5px; page-break-inside: avoid; }
  .done { background: #f9fafb; border-color: #e5e7eb; }
  .chk { flex-shrink: 0; font-size: 13px; margin-top: 3px; color: #555; }
  .txt { font-size: 10.5pt; line-height: 1.45; }
  .done .txt { color: #6b7280; text-decoration: line-through; }
  .orig { font-size: 8pt; color: #9ca3af; margin-top: 2px; }
  .footer { display: flex; justify-content: space-between; margin-top: 20pt; padding-top: 6pt; border-top: 1px solid #d1d5db; font-size: 8pt; color: #9ca3af; }
</style>
</head>
<body>
  <h1>${esc(printTitle)}</h1>
  <p class="sub">${esc(t.checklistTitle)}</p>
  ${sizeBadgeHtml ? `<div class="size-wrap">${sizeBadgeHtml}</div>` : ""}
  ${stepsHtml}
  <div class="footer">
    <span>${esc(t.printFooter)}</span>
  </div>
  <script>window.addEventListener('load', function() { window.print(); });<\/script>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank");
    if (!win) {
      // Popup blocked (common on mobile) — navigate current window instead.
      // The HTML auto-triggers print on load; Back returns to the app.
      window.location.href = url;
    }
  }

  if (mounted && !isUnlocked) {
    return (
      <AccessGate
        lang={lang}
        onToggleLang={toggleLang}
        codeInput={codeInput}
        setCodeInput={setCodeInput}
        codeError={codeError}
        onSubmit={handleUnlock}
      />
    );
  }

  // Floating nav helpers
  const firstUncheckedIdx = steps.findIndex((s) => !s.isHeader && !s.checked);
  const isDeepInList      = firstUncheckedIdx > 4;
  const isPdf             = currentProjectFiles[currentFileIndex]?.mimeType === "application/pdf";

  const isDisabled = (
    activeTab === "text" ? inputText.trim().length === 0 :
    aiSubTab === "video" ? !videoUrl.trim() :
    uploadedImages.length === 0
  ) || isLoading || isCompressing;

  return (
    <div
      suppressHydrationWarning
      className="print-container relative min-h-screen flex flex-col items-center py-16 px-4"
      style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}
    >
      {/* ── Language toggle — fixed top-right ── */}
      <div className="no-print absolute top-5 right-5 z-10">
        <LangToggle lang={lang} onToggle={toggleLang} />
      </div>

      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="print-header mb-8 relative w-full max-w-xl flex flex-col items-center gap-3 text-center px-16"
      >
        <div className="no-print absolute left-4 sm:left-6 top-1 transition-transform">
          <KnitLogo />
        </div>

        {/* My Projects — symmetric with logo, right side */}
        <motion.button
          onClick={() => setShowProjectsModal(true)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="no-print absolute right-2 sm:right-6 top-0 flex-shrink-0"
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 0 }}
          aria-label={t.myProjects}
        >
          <div style={{
            width: 56, height: 56, position: "relative",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: "3px",
          }}>
            <Folder size={26} strokeWidth={1.3} style={{ color: "var(--morandi-green)" }} />
            <span style={{
              fontSize: "9px", fontWeight: 700,
              color: "var(--morandi-green)", letterSpacing: "0.04em",
              lineHeight: 1,
            }}>
              {lang === "zh" ? "项目库" : "Projects"}
            </span>
            {projects.length > 0 && (
              <span style={{
                position: "absolute", top: 6, right: 6,
                background: "var(--morandi-pink)", color: "#fff",
                borderRadius: "999px", fontSize: "9px", fontWeight: 700,
                minWidth: "14px", height: "14px", padding: "0 3px",
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}>
                {projects.length}
              </span>
            )}
          </div>
        </motion.button>
        <div>
          <h1 className="text-3xl font-bold leading-tight flex items-center justify-center gap-2">
            <span style={{
              fontFamily: "var(--font-quicksand), 'Nunito', sans-serif",
              color: "var(--morandi-green)",
              letterSpacing: "0.04em",
            }}>
              KnitStep
            </span>
            <span aria-hidden="true" style={{ color: "var(--morandi-green)", fontWeight: 700, fontSize: "0.6em", lineHeight: 1 }}>●</span>
            <span style={{
              fontFamily: 'var(--font-zcool), "PingFang SC", sans-serif',
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "var(--morandi-green)",
            }}>
              织步
            </span>
          </h1>
          <AnimatePresence mode="wait">
            <motion.p
              key={lang + "-subtitle"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="no-print mt-1 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {t.subtitle}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      {/* ── Import Section ── */}
      <ImportSection
        lang={lang}
        t={t}
        isInputExpanded={isInputExpanded}
        setIsInputExpanded={setIsInputExpanded}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        inputText={inputText}
        setInputText={setInputText}
        uploadedImages={uploadedImages}
        setUploadedImages={setUploadedImages}
        isCompressing={isCompressing}
        isLoading={isLoading}
        errorMsg={errorMsg}
        rateLimitSecondsLeft={rateLimitSecondsLeft}
        aiSubTab={aiSubTab}
        setAiSubTab={setAiSubTab}
        videoUrl={videoUrl}
        setVideoUrl={setVideoUrl}
        lightboxIndex={lightboxIndex}
        setLightboxIndex={setLightboxIndex}
        onConvert={handleConvert}
        onClear={handleClear}
        onFileUpload={handleFileUpload}
        hasConverted={hasConverted}
        mounted={mounted}
        latestFilesRef={latestFilesRef}
        isDisabled={isDisabled}
        dragIndex={dragIndex}
        dragOverIndex={dragOverIndex}
        setDragIndex={setDragIndex}
        setDragOverIndex={setDragOverIndex}
        setErrorMsg={setErrorMsg}
      />

      {/* ── Checklist View (includes loading skeleton + results card) ── */}
      <ChecklistView
        lang={lang}
        t={t}
        steps={steps}
        hasConverted={hasConverted}
        isLoading={isLoading}
        selectedSize={selectedSize}
        isEditMode={isEditMode}
        tipVisible={tipVisible}
        checklistTopRef={checklistTopRef}
        dragIndex={dragIndex}
        dragOverIndex={dragOverIndex}
        activeMenuStepId={activeMenuStepId}
        currentProjectFiles={currentProjectFiles}
        onToggleStep={toggleStep}
        onUpdateSubCount={updateSubCount}
        onTextEdit={handleTextEdit}
        onAddStep={addStep}
        onDeleteStep={deleteStep}
        onReset={handleReset}
        onDismissTip={dismissTip}
        onScrollToTop={scrollToChecklistTop}
        onScrollToFirstUnchecked={scrollToFirstUnchecked}
        setSelectedSize={setSelectedSize}
        setIsEditMode={setIsEditMode}
        setTipVisible={setTipVisible}
        setDragIndex={setDragIndex}
        setDragOverIndex={setDragOverIndex}
        setActiveMenuStepId={setActiveMenuStepId}
        setShowReferencePanel={setShowReferencePanel}
        setHighlightedStepId={setHighlightedStepId}
        setCurrentFileIndex={setCurrentFileIndex}
        onPrint={handlePrint}
        highlightedStepId={highlightedStepId}
      />

      {/* ── Floating Navigation Group ── */}
      <AnimatePresence>
        {hasConverted && !isLoading && (
          <motion.div
            key="float-nav"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
            className="no-print fixed bottom-6 right-5 z-40 flex flex-col items-end gap-2"
          >
            {/* ChevronUp — top, only when scrolled */}
            <AnimatePresence>
              {showBackToTop && (
                <motion.div
                  key="btn-up"
                  initial={{ opacity: 0, y: 10, scale: 0.82 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.82 }}
                  transition={{ type: "spring", stiffness: 420, damping: 26 }}
                  className="group relative flex items-center"
                >
                  <span
                    className="absolute right-full mr-3 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                    style={{ background: "rgba(30,24,20,0.78)", color: "#fff", backdropFilter: "blur(4px)" }}
                  >
                    {lang === "zh" ? "回到顶部" : "List Top"}
                  </span>
                  <motion.button
                    whileHover={{ scale: 1.1, y: -1 }}
                    whileTap={{ scale: 0.92 }}
                    onClick={scrollToChecklistTop}
                    aria-label={lang === "zh" ? "回到顶部" : "List Top"}
                    style={{
                      width: "44px", height: "44px", borderRadius: "999px",
                      background: "rgba(232,168,158,0.88)",
                      backdropFilter: "blur(8px)",
                      border: "1px solid rgba(255,255,255,0.35)",
                      boxShadow: "0 4px 16px -4px rgba(180,120,115,0.4)",
                      color: "#fff", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <ChevronUp size={19} strokeWidth={2.5} />
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Target — middle, always visible, pulses when step is deep */}
            <div className="group relative flex items-center">
              <span
                className="absolute right-full mr-3 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "rgba(30,24,20,0.78)", color: "#fff", backdropFilter: "blur(4px)" }}
              >
                {lang === "zh" ? "回到当前进度" : "Jump to Current"}
              </span>
              <div style={{ position: "relative" }}>
                {/* Pulse ring — repeats until user clicks the button */}
                {isDeepInList && !hasClickedTarget && (
                  <motion.div
                    animate={{ scale: [1, 1.7, 1.7], opacity: [0.55, 0, 0] }}
                    transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity, repeatDelay: 1 }}
                    style={{
                      position: "absolute", inset: 0, borderRadius: "999px",
                      background: "rgba(143,175,150,0.55)",
                      pointerEvents: "none",
                    }}
                  />
                )}
                <motion.button
                  whileHover={{ scale: 1.1, y: -1 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => { setHasClickedTarget(true); scrollToFirstUnchecked(); }}
                  aria-label={lang === "zh" ? "回到当前进度" : "Jump to Current"}
                  style={{
                    position: "relative",
                    width: "44px", height: "44px", borderRadius: "999px",
                    background: isDeepInList ? "rgba(122,160,133,0.95)" : "rgba(143,175,150,0.90)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    boxShadow: isDeepInList
                      ? "0 4px 20px -4px rgba(90,135,105,0.65)"
                      : "0 4px 16px -4px rgba(100,145,110,0.45)",
                    color: "#fff", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.4s, box-shadow 0.4s",
                  }}
                >
                  <Target size={18} strokeWidth={2} />
                </motion.button>
              </div>
            </div>

            {/* FileText — bottom, always visible; dims when no file attached */}
            <div className="group relative flex items-center">
              <span
                className="absolute right-full mr-3 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "rgba(30,24,20,0.78)", color: "#fff", backdropFilter: "blur(4px)" }}
              >
                {lang === "zh"
                  ? (currentProjectFiles.length > 0 ? `查看原图${currentProjectFiles.length > 1 ? ` (${currentProjectFiles.length}张)` : ""}` : "无附件")
                  : (currentProjectFiles.length > 0 ? `View Pattern${currentProjectFiles.length > 1 ? ` (${currentProjectFiles.length})` : ""}` : "No file")}
              </span>
              <div style={{ position: "relative" }}>
                <motion.button
                  whileHover={{ scale: currentProjectFiles.length > 0 ? 1.1 : 1, y: currentProjectFiles.length > 0 ? -1 : 0 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    const firstFile = currentProjectFiles[0];
                    if (firstFile?.mimeType === "application/pdf") {
                      window.open(firstFile.url, "_blank", "noopener,noreferrer");
                    } else {
                      setCurrentFileIndex(0);
                      setShowReferencePanel(true);
                    }
                  }}
                  aria-label={lang === "zh" ? "查看原图" : "View Pattern"}
                  style={{
                    width: "44px", height: "44px", borderRadius: "999px",
                    background: currentProjectFiles.length > 0 ? "rgba(168,191,160,0.88)" : "rgba(168,191,160,0.42)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    boxShadow: currentProjectFiles.length > 0 ? "0 4px 16px -4px rgba(120,155,115,0.4)" : "none",
                    color: "#fff", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.3s, box-shadow 0.3s",
                  }}
                >
                  <FileText size={17} strokeWidth={1.8} />
                </motion.button>
                {/* PDF badge */}
                {isPdf && (
                  <span style={{
                    position: "absolute", top: "2px", right: "2px",
                    width: "10px", height: "10px", borderRadius: "999px",
                    background: "var(--morandi-pink)",
                    border: "1.5px solid #fff",
                    display: "block",
                  }} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Projects Modal ── */}
      <AnimatePresence>
        {showProjectsModal && (
          <ProjectGallery
            projects={projects}
            lang={lang}
            currentProjectId={currentProjectId}
            onClose={() => setShowProjectsModal(false)}
            onLoad={handleLoadProject}
            onDelete={handleDeleteProject}
            onRename={handleRenameProject}
          />
        )}
      </AnimatePresence>

      {/* ── Image Lightbox ── */}
      <AnimatePresence>
        {lightboxIndex !== null && uploadedImages[lightboxIndex] && (
          <motion.div
            key="lightbox"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.88)" }}
            onClick={() => setLightboxIndex(null)}
            onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => {
              if (touchStartX.current === null) return;
              const dx = e.changedTouches[0].clientX - touchStartX.current;
              touchStartX.current = null;
              if (Math.abs(dx) < 40) return;
              if (dx < 0) setLightboxIndex((i) => (i !== null ? Math.min(uploadedImages.length - 1, i + 1) : null));
              else         setLightboxIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
            }}
          >
            {/* Main image */}
            <motion.img
              key={lightboxIndex}
              src={uploadedImages[lightboxIndex].previewUrl}
              alt={`pattern ${lightboxIndex + 1}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: "min(92vw, 640px)",
                maxHeight: "80vh",
                objectFit: "contain",
                borderRadius: "1rem",
                userSelect: "none",
              }}
            />

            {/* Counter badge */}
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-sm font-semibold"
              style={{ background: "rgba(255,255,255,0.12)", color: "#fff", backdropFilter: "blur(6px)" }}
            >
              {lightboxIndex + 1} / {uploadedImages.length}
            </div>

            {/* Close button */}
            <button
              onClick={() => setLightboxIndex(null)}
              className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
            >
              <X size={18} strokeWidth={2.5} />
            </button>

            {/* Prev arrow */}
            {lightboxIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i - 1 : null)); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
              >
                <ChevronLeft size={22} strokeWidth={2.5} />
              </button>
            )}

            {/* Next arrow */}
            {lightboxIndex < uploadedImages.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i + 1 : null)); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
              >
                <ChevronRight size={22} strokeWidth={2.5} />
              </button>
            )}

            {/* Dot indicators */}
            {uploadedImages.length > 1 && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5">
                {uploadedImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                    style={{
                      width: i === lightboxIndex ? "18px" : "6px",
                      height: "6px",
                      borderRadius: "999px",
                      background: i === lightboxIndex ? "var(--morandi-pink)" : "rgba(255,255,255,0.4)",
                      border: "none",
                      cursor: "pointer",
                      transition: "width 0.2s, background 0.2s",
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Storage warning toast ── */}
      <AnimatePresence>
        {storageWarning && (
          <motion.div
            key="storage-warning"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium"
            style={{
              background: "rgba(180,140,130,0.95)",
              color: "#fff",
              boxShadow: "0 4px 20px -4px rgba(140,90,80,0.35)",
              backdropFilter: "blur(8px)",
              maxWidth: "min(480px, calc(100vw - 5rem))",
            }}
          >
            <span style={{ flex: 1, lineHeight: 1.45 }}>
              {lang === "zh"
                ? "项目图片占用空间较大，建议清理不再需要的项目以释放内存"
                : "Storage usage is high, consider clearing old projects to free up space"}
            </span>
            <button
              onClick={() => setStorageWarning(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#fff", padding: 0, lineHeight: 0, flexShrink: 0 }}
              aria-label="Dismiss"
            >
              <X size={15} strokeWidth={2.5} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reference Panel ── */}
      <ReferencePanel
        lang={lang}
        show={showReferencePanel}
        onClose={() => { setShowReferencePanel(false); setHighlightedStepId(null); }}
        files={currentProjectFiles}
        currentFileIndex={currentFileIndex}
        setCurrentFileIndex={setCurrentFileIndex}
        highlightedStepId={highlightedStepId}
        steps={steps}
      />
    </div>
  );
}

// ─── LangToggle ──────────────────────────────────────────────────────────────

function LangToggle({ lang, onToggle }: { lang: Lang; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className="flex items-center gap-0.5 p-1 text-xs font-bold tracking-wider"
      style={{
        background:   "var(--morandi-stone)",
        borderRadius: "999px",
        border:       "1.5px solid var(--border)",
        boxShadow:    "0 2px 12px -4px rgba(0,0,0,0.1)",
        cursor:       "pointer",
      }}
      aria-label="Toggle language"
    >
      {(["zh", "en"] as const).map((l) => {
        const active = lang === l;
        return (
          <motion.span
            key={l}
            animate={{
              background: active ? "var(--morandi-pink)" : "transparent",
              color:      active ? "#fff" : "var(--text-muted)",
            }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="relative px-2.5 py-1 rounded-full"
            style={{ minWidth: "2rem", textAlign: "center" }}
          >
            {l === "zh" ? "ZH" : "EN"}
          </motion.span>
        );
      })}
    </motion.button>
  );
}

// ─── KnitLogo ────────────────────────────────────────────────────────────────

function KnitLogo({ className = "w-10 h-10 sm:w-12 sm:h-12" }: { className?: string }) {
  const uid = useId();
  const clipId = `kl-${uid.replace(/:/g, "")}`;

  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="35" />
        </clipPath>
      </defs>

      {/* Needle 1 — steep rightward lean */}
      <line x1="25" y1="8" x2="75" y2="92" stroke="#C4A882" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="25" cy="8" r="5.5" fill="#C4A882" />
      <circle cx="23" cy="6" r="2" fill="white" fillOpacity="0.4" />

      {/* Needle 2 — shallow rightward lean */}
      <line x1="8" y1="30" x2="92" y2="70" stroke="#C4A882" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="8" cy="30" r="5.5" fill="#C4A882" />
      <circle cx="6" cy="28" r="2" fill="white" fillOpacity="0.4" />

      {/* Yarn ball — Morandi green */}
      <circle cx="50" cy="50" r="35" fill="#A8BFA0" />

      {/* Yarn winding texture clipped inside ball */}
      <g clipPath={`url(#${clipId})`}>
        <path d="M 72 16 Q 50 50 28 84" stroke="white" strokeOpacity="0.22" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 84 30 Q 65 54 46 78" stroke="white" strokeOpacity="0.15" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 60 16 Q 38 50 16 84" stroke="white" strokeOpacity="0.18" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 28 16 Q 50 50 72 84" stroke="black" strokeOpacity="0.07" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 16 30 Q 35 54 54 78" stroke="black" strokeOpacity="0.05" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M 16 42 Q 50 33 84 42" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M 15 55 Q 50 46 85 55" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M 18 68 Q 50 59 82 68" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <ellipse cx="52" cy="73" rx="30" ry="16" fill="black" fillOpacity="0.13" />
        <ellipse cx="37" cy="35" rx="15" ry="11" fill="white" fillOpacity="0.2" />
      </g>

      {/* Needle tips on top of ball */}
      <circle cx="75" cy="92" r="3" fill="#C4A882" />
      <circle cx="92" cy="70" r="3" fill="#C4A882" />
    </svg>
  );
}

// ─── AccessGate ──────────────────────────────────────────────────────────────

const gateDict = {
  zh: {
    title:       "KnitStep 内测邀请制开放中",
    subtitle:    "请输入内测邀请码以继续",
    placeholder: "输入邀请码...",
    enter:       "进入 →",
    switchLang:  "English",
  },
  en: {
    title:       "KnitStep — Invite-Only Beta",
    subtitle:    "Enter your beta access code to continue",
    placeholder: "Access code...",
    enter:       "Enter →",
    switchLang:  "中文",
  },
};

interface AccessGateProps {
  lang: Lang;
  onToggleLang: () => void;
  codeInput: string;
  setCodeInput: (v: string) => void;
  codeError: boolean;
  onSubmit: () => void;
}

function AccessGate({ lang, onToggleLang, codeInput, setCodeInput, codeError, onSubmit }: AccessGateProps) {
  const g = gateDict[lang];
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}
    >
      {/* Lang toggle — top right */}
      <div className="absolute top-5 right-5">
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={onToggleLang}
          className="text-xs font-semibold px-3 py-1.5 rounded-full"
          style={{
            background: "rgba(255,255,255,0.7)",
            color: "var(--text-muted)",
            border: "1px solid rgba(163,177,138,0.35)",
            cursor: "pointer",
            backdropFilter: "blur(8px)",
          }}
        >
          {g.switchLang}
        </motion.button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-sm flex flex-col items-center gap-6 p-8 rounded-3xl"
        style={{
          background: "rgba(255,255,255,0.62)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px -8px rgba(163,177,138,0.28)",
          border: "1px solid rgba(255,255,255,0.85)",
        }}
      >
        <KnitLogo className="w-16 h-16" />

        <div className="text-center">
          <p className="text-base font-bold" style={{ color: "var(--text-main)" }}>
            {g.title}
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {g.subtitle}
          </p>
        </div>

        <motion.div
          className="w-full"
          animate={codeError ? { x: [-8, 8, -6, 6, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.45 }}
        >
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder={g.placeholder}
            autoFocus
            className="w-full px-4 py-3 rounded-2xl text-sm font-medium text-center outline-none tracking-widest"
            style={{
              background: "rgba(255,255,255,0.85)",
              border: `1.5px solid ${codeError ? "rgba(210,100,100,0.5)" : "rgba(163,177,138,0.4)"}`,
              color: "var(--text-main)",
              boxShadow: codeError ? "0 0 0 3px rgba(210,100,100,0.12)" : "none",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          />
        </motion.div>

        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.95 }}
          onClick={onSubmit}
          className="w-full py-3 rounded-2xl text-sm font-semibold tracking-wide"
          style={{ background: "var(--morandi-pink)", color: "#fff", border: "none", cursor: "pointer" }}
        >
          {g.enter}
        </motion.button>
      </motion.div>
    </div>
  );
}
