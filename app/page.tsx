"use client";

import { useState, useEffect, useRef, useId } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  dict, renderStepText, compressImage,
  MAX_IMAGES,
  type Lang, type Step, type CrochetData,
} from "./lib/types";
import { DEFAULT_PROMPT_VERSION, type PromptVersion } from "./lib/prompts";
import { ENABLE_AUTH } from "./config";
import { createClient } from "./lib/supabase/client";
import { getSignedUrl } from "./lib/stores/imageUtils";
import { checkAccessCode } from "./actions";
import { useProjectManager } from "./hooks/useProjectManager";
import { useAIConversion }   from "./hooks/useAIConversion";
import ImportSection  from "./components/ImportSection";
import ChecklistView  from "./components/ChecklistView";
import GridView       from "./components/Viewer/GridView";
import GridCalibrator, { type CalibrationResult } from "./components/Viewer/GridCalibrator";
import RowTracker, { type RowTrackerState } from "./components/Viewer/RowTracker";
import CrochetCalibrator, { type CrochetCalibrationResult } from "./components/Viewer/CrochetCalibrator";
import CrochetTracker from "./components/Viewer/CrochetTracker";
import ProjectGallery from "./components/ProjectGallery";
import ReferencePanel from "./components/ReferencePanel";
import AuthModal     from "./components/AuthModal";
import AuthButton    from "./components/AuthButton";
import {
  Folder, ChevronUp, ChevronLeft, ChevronRight, FileText, X, Target,
} from "lucide-react";
import { Analytics } from "@vercel/analytics/next";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  // ── UI-only state (no db involvement) ──────────────────────────────────────
  const [lang, setLang]                   = useState<Lang>("zh");
  const [inputText, setInputText]         = useState<string>("");
  const [steps, setSteps]                 = useState<Step[]>([]);
  const [hasConverted, setHasConverted]   = useState(false);
  const [activeTab, setActiveTab]         = useState<"text" | "ai">("ai");
  const [uploadedImages, setUploadedImages] = useState<{
    base64: string; mimeType: string; previewUrl: string;
  }[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [tipVisible, setTipVisible]       = useState(true);
  const [mounted, setMounted]             = useState(false);
  const [isEditMode, setIsEditMode]       = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [aiSubTab, setAiSubTab]           = useState<"photo" | "video">("photo");
  const [videoUrl, setVideoUrl]           = useState("");
  const [isUnlocked, setIsUnlocked]       = useState(false);
  const [codeInput, setCodeInput]         = useState("");
  const [codeError, setCodeError]         = useState(false);
  const [showReferencePanel, setShowReferencePanel] = useState(false);
  const [highlightedStepId, setHighlightedStepId]   = useState<number | null>(null);
  const [activeMenuStepId, setActiveMenuStepId]     = useState<number | null>(null);
  const [showProjectsModal, setShowProjectsModal]   = useState(false);
  const [cloudThumbnailUrls, setCloudThumbnailUrls] = useState<Record<string, string>>({});
  const [showAuthModal, setShowAuthModal]           = useState(false);
  const [gridConfidenceModal, setGridConfidenceModal] = useState<{ confidence: number; analysisReport?: string } | null>(null);
  const [isInputExpanded, setIsInputExpanded]       = useState(true);
  const [isGridMode, setIsGridMode]       = useState(false);
  const [promptVersion, setPromptVersion] = useState<PromptVersion>(DEFAULT_PROMPT_VERSION);
  const [dragIndex, setDragIndex]         = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [showCalibrator, setShowCalibrator] = useState(false);
  const [rowTrackerData, setRowTrackerData] = useState<RowTrackerState | null>(null);
  const [isCrochetMode, setIsCrochetMode]         = useState(false);
  const [showCrochetCalibrator, setShowCrochetCalibrator] = useState(false);
  const [crochetData, setCrochetData]             = useState<CrochetData | null>(null);
  const [lastCrochetMode, setLastCrochetMode]     = useState<import("./lib/types").CrochetMode | null>(null);
  const touchStartX    = useRef<number | null>(null);
  const latestFilesRef = useRef<File[]>([]);
  // Captures the active grid project ID just before conversion starts, so that
  // onSuccess can update the existing project instead of creating a duplicate.
  const prevGridProjectIdRef = useRef<string | null>(null);
  const checklistTopRef  = useRef<HTMLDivElement>(null);
  const rowTrackerRef    = useRef<HTMLDivElement>(null);
  const crochetTrackerRef = useRef<HTMLDivElement>(null);

  // ── Project manager — owns all IndexedDB state ─────────────────────────────
  const pm = useProjectManager({ steps, mounted });

  // ── AI conversion — owns all API-fetch + error state ──────────────────────
  const ai = useAIConversion({
    lang,
    activeTab,
    aiSubTab,
    inputText,
    uploadedImages,
    videoUrl,
    isGridMode,
    promptVersion,
    latestFilesRef,
    onPreConvert() {
      setIsEditMode(false);
      // Capture the active project ID before clearing it, so onSuccess can
      // update an existing grid project instead of creating a duplicate.
      const activeProject = pm.currentProjectId
        ? pm.projects.find((p) => p.id === pm.currentProjectId)
        : null;
      prevGridProjectIdRef.current =
        activeProject?.type === "grid" ? activeProject.id : null;
      pm.setCurrentProjectId(null);
      setSteps([]);
      setHasConverted(false);
      setRowTrackerData(null);
      setShowCalibrator(false);
      // Reset accumulated files if no images are queued
      if (uploadedImages.length === 0) latestFilesRef.current = [];
    },
    async onSuccess(parsed, files, gridData) {
      setSteps(parsed);
      setHasConverted(true);
      setIsInputExpanded(false);
      // Clear upload state so the input area is a clean slate for the next project
      setUploadedImages([]);
      setVideoUrl("");
      setInputText("");
      latestFilesRef.current = [];
      // If the user re-analyzed an existing grid project, update it in place
      // instead of creating a duplicate entry in the gallery.
      if (gridData && prevGridProjectIdRef.current) {
        await pm.updateGridCalibration(prevGridProjectIdRef.current, gridData);
        pm.setCurrentProjectId(prevGridProjectIdRef.current);
        prevGridProjectIdRef.current = null;
      } else {
        prevGridProjectIdRef.current = null;
        await pm.saveNewProject(parsed, files, lang, gridData);
      }
      if (gridData?.confidence !== undefined) {
        setGridConfidenceModal({ confidence: gridData.confidence, analysisReport: gridData.analysisReport });
      }
    },
  });

  const t = dict[lang];

  // ── Effects ────────────────────────────────────────────────────────────────

  // Load persisted row tracker from localStorage on mount.
  // Skip if there's a saved project ID — the DB restore will provide full data including patternMeta,
  // and mounting RowTracker without it would trigger a redundant analyze-pattern API call.
  useEffect(() => {
    if (localStorage.getItem("knitstep-current-project")) return;
    try {
      const saved = JSON.parse(localStorage.getItem("knitstep_tracker") ?? "{}");
      if (saved.imageSrc && saved.rect && saved.rows) {
        setRowTrackerData({ imageSrc: saved.imageSrc, rect: saved.rect, rows: saved.rows, stitches: saved.stitches ?? 1 });
      }
    } catch {}
  }, []);

  // Load persisted crochet tracker from localStorage on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("knitstep_crochet") ?? "{}");
      if (saved.imageSrc && saved.mode && typeof saved.totalRows === "number") {
        setCrochetData(saved as CrochetData);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 320);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (activeMenuStepId === null) return;
    function handleOutside(e: PointerEvent) {
      if (!(e.target as Element).closest("[data-step-menu]")) setActiveMenuStepId(null);
    }
    document.addEventListener("pointerdown", handleOutside);
    return () => document.removeEventListener("pointerdown", handleOutside);
  }, [activeMenuStepId]);

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

  // Propagate background sync updates to the active RowTracker.
  // syncOnLogin calls setProjects() after merging — if the current project's row changed,
  // update rowTrackerData.initialRow so RowTracker's sync-response effect picks it up.
  useEffect(() => {
    if (!pm.currentProjectId || !rowTrackerData) return;
    const proj = pm.projects.find((p) => p.id === pm.currentProjectId);
    const syncedRow = proj?.trackerData?.currentRow;
    if (typeof syncedRow === "number" && syncedRow !== rowTrackerData.initialRow) {
      setRowTrackerData((prev) => prev ? { ...prev, initialRow: syncedRow } : prev);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pm.projects, pm.currentProjectId]);

  // Generate signed URLs for cloud-synced projects that have no local originalFiles.
  // Handles three cases:
  //   1. tracker/crochet: use trackerData._imagePath / crochetData._imagePath
  //   2. instruction/grid with originalFilePaths cached locally
  //   3. instruction/grid with no local path cache → query Supabase for original_file_paths
  useEffect(() => {
    if (!ENABLE_AUTH || !showProjectsModal || !pm.user) return;
    const supabase = createClient();
    const noLocalFiles = pm.projects.filter(
      (p) => !p.originalFiles || p.originalFiles.length === 0
    );
    if (noLocalFiles.length === 0) return;

    async function fetchThumbnails() {
      const results: Record<string, string> = {};

      // Pass 1: use _imagePath already in the local record (tracker / crochet)
      const stillNeed: string[] = [];
      for (const p of noLocalFiles) {
        const imgPath = p.trackerData?._imagePath ?? (p.crochetData as any)?._imagePath;
        if (imgPath) {
          const url = await getSignedUrl(supabase, imgPath);
          if (url) { results[p.id] = url; continue; }
        }
        if (p.originalFilePaths?.length) {
          const url = await getSignedUrl(supabase, p.originalFilePaths[0]);
          if (url) { results[p.id] = url; continue; }
        }
        stillNeed.push(p.id);
      }

      // Pass 2: query Supabase for original_file_paths not yet in local Dexie cache
      if (stillNeed.length > 0) {
        const { data } = await supabase
          .from("projects")
          .select("id, original_file_paths")
          .in("id", stillNeed)
          .eq("user_id", pm.user!.id);
        for (const row of data ?? []) {
          const paths = (row.original_file_paths ?? []) as string[];
          if (paths.length) {
            const url = await getSignedUrl(supabase, paths[0]);
            if (url) results[row.id] = url;
          }
        }
      }

      if (Object.keys(results).length > 0) {
        setCloudThumbnailUrls((prev) => ({ ...prev, ...results }));
      }
    }

    fetchThumbnails();
  // pm.projects intentionally read via closure — array-in-deps causes React size-mismatch warning
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProjectsModal, pm.user?.id]);

  // Auto-scroll to RowTracker whenever it first appears (calibration complete or project load)
  useEffect(() => {
    if (!rowTrackerData) return;
    const el = rowTrackerRef.current;
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [rowTrackerData]);

  // Auto-scroll to CrochetTracker when it first appears
  useEffect(() => {
    if (!crochetData) return;
    const el = crochetTrackerRef.current;
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, [crochetData]);

  // ── Hydration — restore all state from localStorage on first mount ──────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Priority: ?lang= URL param → localStorage → browser language → "zh"
    const savedLang = localStorage.getItem("knitstep-lang");
    const urlParam  = new URLSearchParams(window.location.search).get("lang");
    const restoredLang: Lang =
      urlParam === "zh" || urlParam === "en" ? urlParam :
      savedLang === "zh" || savedLang === "en" ? savedLang :
      navigator.language.startsWith("zh") ? "zh" : "en";
    setLang(restoredLang);
    localStorage.setItem("knitstep-lang", restoredLang);

    const savedData = localStorage.getItem("knitstep-data");
    if (savedData) {
      try {
        const { inputText: si, steps: ss, hasConverted: sc } = JSON.parse(savedData);
        if (typeof si === "string")  setInputText(si);
        if (Array.isArray(ss))       setSteps(ss);
        if (typeof sc === "boolean") setHasConverted(sc);
      } catch { /* corrupt — start fresh */ }
    }

    if (localStorage.getItem("knitstep-tip-dismissed")  === "1") setTipVisible(false);
    if (localStorage.getItem("knitstep_access_granted") === "1") setIsUnlocked(true);

    // Capture BEFORE markHydrated() — the currentProjectId persistence effect
    // fires immediately after and would erase this key.
    const savedProjectId = localStorage.getItem("knitstep-current-project");

    pm.markHydrated();
    setMounted(true);

    // Load projects from IndexedDB; restore active project if found.
    // The callback is async so cloud-synced projects can rehydrate their images.
    pm.loadProjects(savedProjectId, async (project) => {
      pm.selectProject(project);
      setIsInputExpanded(false);

      if (project.type === "tracker" && project.trackerData) {
        // Cloud-synced tracker projects have imageSrc="" — fetch from Storage on demand
        if (!project.trackerData.imageSrc && project.trackerData._imagePath) {
          project = await pm.rehydrateIfNeeded(project);
        }
        setSteps([]);
        setHasConverted(false);
        setCrochetData(null);
        try { localStorage.removeItem("knitstep_crochet"); } catch {}
        const { imageSrc, rect, rows, stitches, currentRow, patternMeta } = project.trackerData!;
        setRowTrackerData({ imageSrc, rect, rows, stitches, patternMeta, initialRow: currentRow });
      } else if (project.type === "crochet") {
        // Cloud-synced crochet projects have imageSrc="" — fetch from Storage on demand
        if (project.crochetData && !project.crochetData.imageSrc && project.crochetData._imagePath) {
          project = await pm.rehydrateIfNeeded(project);
        }
        setSteps([]);
        setHasConverted(false);
        setRowTrackerData(null);
        try { localStorage.removeItem("knitstep_tracker"); } catch {}
        if (project.crochetData) setCrochetData(project.crochetData);
      } else {
        // Checklist / grid project: restore steps and mark as converted.
        setSteps(project.steps);
        setHasConverted(true);
        setRowTrackerData(null);
        setCrochetData(null);
        try { localStorage.removeItem("knitstep_tracker"); } catch {}
        try { localStorage.removeItem("knitstep_crochet"); } catch {}
        setIsGridMode(false);
        setIsCrochetMode(false);
        setShowCalibrator(false);
        setShowCrochetCalibrator(false);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist non-project state to localStorage ──────────────────────────────
  useEffect(() => {
    if (!pm.hydrated.current) return;
    if (typeof window === "undefined") return;
    localStorage.setItem(
      "knitstep-data",
      JSON.stringify({ inputText, steps, hasConverted })
    );
  }, [inputText, steps, hasConverted]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  function toggleLang() {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("knitstep-lang", next);
  }

  async function handleFileUpload(file: File, currentCount?: number) {
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    const MAX_FILE_BYTES  = 10 * 1024 * 1024;
    const limit = file.type.startsWith("image/") ? MAX_IMAGE_BYTES : MAX_FILE_BYTES;
    if (file.size > limit) { ai.setError(t.errorFileTooLarge); return; }
    ai.setError(null);

    if (file.type.startsWith("image/")) {
      latestFilesRef.current = [...latestFilesRef.current, file];
      if ((currentCount ?? uploadedImages.length) >= MAX_IMAGES) {
        ai.setError(t.errorMaxImages);
        return;
      }
      setIsCompressing(true);
      try {
        const compressed = await compressImage(file);
        setUploadedImages((prev) => [...prev, compressed]);
        if (isCrochetMode) {
          // Starting a new crochet calibration — clear whatever was active before
          pm.setCurrentProjectId(null);
          setSteps([]);
          setHasConverted(false);
          setRowTrackerData(null);
          setCrochetData(null);
          setLastCrochetMode(null);
          try { localStorage.removeItem("knitstep_crochet"); } catch {}
          try { localStorage.removeItem("knitstep_tracker"); } catch {}
          setShowCrochetCalibrator(true);
        }
      } catch {
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const [header, base64] = dataUrl.split(",");
          const mimeType = header.split(":")[1].split(";")[0];
          setUploadedImages((prev) => [...prev, { base64, mimeType, previewUrl: dataUrl }]);
          if (isCrochetMode) {
            pm.setCurrentProjectId(null);
            setSteps([]);
            setHasConverted(false);
            setRowTrackerData(null);
            setCrochetData(null);
            setLastCrochetMode(null);
            try { localStorage.removeItem("knitstep_crochet"); } catch {}
            try { localStorage.removeItem("knitstep_tracker"); } catch {}
            setShowCrochetCalibrator(true);
          }
        };
        reader.readAsDataURL(file);
      } finally {
        setIsCompressing(false);
      }
    } else {
      // PDF — replace entire list (single-file)
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

  function handleClear() {
    if (confirm(lang === "zh" ? "确定要清除所有进度并重新开始吗？" : "Clear all progress and restart?")) {
      setIsEditMode(false);
      pm.setCurrentProjectId(null);
      pm.setSelectedSize("all");
      setSteps([]);
      setHasConverted(false);
      setInputText("");
      localStorage.removeItem("knitstep-data");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function handleUnlock() {
    const valid = await checkAccessCode(codeInput.trim().toUpperCase());
    if (valid) {
      localStorage.setItem("knitstep_access_granted", "1");
      setIsUnlocked(true);
    } else {
      setCodeError(true);
      setTimeout(() => setCodeError(false), 600);
    }
  }

  async function handleCrochetCalibrationComplete(result: CrochetCalibrationResult) {
    const img = uploadedImages[0];
    const imageSrc = img ? `data:${img.mimeType};base64,${img.base64}` : "";
    const data: CrochetData = {
      imageSrc,
      mode:        result.mode,
      startPoint:  result.startPoint,
      startCorner: result.startCorner,
      landmarks:   result.landmarks,
      currentRow:  1,
      totalRows:   result.totalRows > 0 ? result.totalRows : 1,
    };
    try { localStorage.setItem("knitstep_crochet", JSON.stringify(data)); } catch {}
    setCrochetData(data);
    setShowCrochetCalibrator(false);
    setIsInputExpanded(false);
    // Capture files before clearing (needed when creating a new project)
    const filesToSave = latestFilesRef.current.slice(0, 1);
    // Clear input so the upload area is blank next time the user expands it
    setUploadedImages([]);
    latestFilesRef.current = [];
    // Clear any stale checklist state so knitstep-data doesn't restore a ghost
    // checklist on the next page refresh when this crochet project is active
    setSteps([]);
    setHasConverted(false);

    if (pm.currentProjectId) {
      // Recalibration: update the existing project in place.
      // Preserves the original cover image (originalFiles) and project name.
      await pm.updateCrochetCalibration(pm.currentProjectId, data);
    } else {
      // First calibration: create a new project (includes the uploaded image as cover).
      await pm.saveCrochetProject(data, filesToSave, lang);
    }
  }

  async function handleCalibrationComplete(result: CalibrationResult) {
    const img = uploadedImages[0];
    const imageSrc = img ? `data:${img.mimeType};base64,${img.base64}` : "";
    const trackerState = { imageSrc, rect: result.rect, rows: result.rows, stitches: result.stitches };
    // Write currentRow:1 to localStorage BEFORE mounting RowTracker so its
    // lazy useState initializer always reads 1, not a stale value from a prior session.
    try { localStorage.setItem("knitstep_tracker", JSON.stringify({ ...trackerState, currentRow: 1 })); } catch {}
    setRowTrackerData(trackerState);
    setShowCalibrator(false);
    // Save as a project so progress survives page reloads and shows in the gallery
    await pm.saveTrackerProject(
      { ...trackerState, currentRow: 1 },
      latestFilesRef.current.slice(0, 1),
      lang,
    );
  }

  function toggleStep(id: number) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s)));
  }

  function updateSubCount(id: number, delta: number) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const max  = parseMaxCount(s);
        const raw  = (s.subCount ?? 0) + delta;
        const capped = max !== null ? Math.min(max, Math.max(0, raw)) : Math.max(0, raw);
        return { ...s, subCount: capped, checked: max !== null && capped >= max ? true : s.checked };
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
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, text: newText } : s)));
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
    const targetIdx = Math.max(0, uncheckedIdx - 1);
    const targetId  = steps[targetIdx].id;
    document.getElementById(`step-${targetId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // ── Project action wrappers (add UI behaviour on top of pm) ────────────────

  async function handleLoadProject(id: string) {
    let project = pm.handleLoadProject(id);
    if (!project) return;

    // Clear all viewer state before switching projects.
    setRowTrackerData(null);
    setCrochetData(null);
    setShowCalibrator(false);
    setShowCrochetCalibrator(false);
    setIsGridMode(false);
    setIsCrochetMode(false);
    setHasConverted(false);
    setSteps([]);

    if (project.type === "tracker" && project.trackerData) {
      // Cloud-synced projects have imageSrc="" — fetch from Storage on demand
      if (!project.trackerData.imageSrc && project.trackerData._imagePath) {
        project = await pm.rehydrateIfNeeded(project);
      }
      const { imageSrc, rect, rows, stitches, currentRow, patternMeta } = project.trackerData!;
      try {
        localStorage.setItem("knitstep_tracker", JSON.stringify({ imageSrc, rect, rows, stitches, currentRow }));
      } catch {}
      try { localStorage.removeItem("knitstep_crochet"); } catch {}
      setRowTrackerData({ imageSrc, rect, rows, stitches, patternMeta, initialRow: currentRow });
      setIsInputExpanded(false);
      setShowProjectsModal(false);
      return;
    }

    if (project.type === "crochet" && project.crochetData) {
      // Cloud-synced projects have imageSrc="" — fetch from Storage on demand
      if (!project.crochetData.imageSrc && project.crochetData._imagePath) {
        project = await pm.rehydrateIfNeeded(project);
      }
      try {
        localStorage.setItem("knitstep_crochet", JSON.stringify(project.crochetData));
      } catch {}
      try { localStorage.removeItem("knitstep_tracker"); } catch {}
      setCrochetData(project.crochetData!);
      setIsInputExpanded(false);
      setShowProjectsModal(false);
      return;
    }

    // Checklist / grid: clear both tracker keys
    try { localStorage.removeItem("knitstep_tracker"); } catch {}
    try { localStorage.removeItem("knitstep_crochet"); } catch {}

    setSteps(project.steps);
    setHasConverted(true);
    setIsInputExpanded(false);
    setShowProjectsModal(false);
  }

  function handleDeleteProject(id: string) {
    if (!confirm(t.deleteConfirm)) return;
    pm.handleDeleteProject(id);
  }

  function handlePrint() {
    const currentProject = pm.currentProjectId
      ? pm.projects.find((p) => p.id === pm.currentProjectId)
      : null;
    const printTitle = currentProject?.name ?? (lang === "zh" ? "KnitStep · 织步" : "KnitStep");

    function esc(s: string) {
      return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    const stepsHtml = steps.map((step) => {
      if (step.isHeader) return `<div class="hdr">${esc(step.text)}</div>`;
      const displayText = esc(renderStepText(step, pm.selectedSize));
      return `<div class="step${step.checked ? " done" : ""}">
        <span class="chk">${step.checked ? "✓" : "○"}</span>
        <div>
          <div class="txt">${displayText}</div>
          ${step.original ? `<div class="orig">${esc(step.original)}</div>` : ""}
        </div>
      </div>`;
    }).join("");

    const sizeBadgeHtml = pm.selectedSize !== "all"
      ? `<div class="size-badge">${lang === "zh" ? "尺码" : "Size"}: <strong>${esc(pm.selectedSize)}</strong></div>`
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
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, "_blank");
    if (!win) window.location.href = url;
  }

  // ── Access gate ────────────────────────────────────────────────────────────
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

  // ── Derived values ─────────────────────────────────────────────────────────
  const firstUncheckedIdx = steps.findIndex((s) => !s.isHeader && !s.checked);
  const isDeepInList      = firstUncheckedIdx > 4;
  const isPdf             = pm.currentProjectFiles[pm.currentFileIndex]?.mimeType === "application/pdf";

  const isDisabled = (
    activeTab === "text" ? inputText.trim().length === 0 :
    aiSubTab  === "video" ? !videoUrl.trim() :
    uploadedImages.length === 0
  ) || ai.isLoading || isCompressing;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      suppressHydrationWarning
      className="print-container relative min-h-screen flex flex-col items-center py-16 px-4"
      style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}
    >
      {/* ── Top-right: AuthButton + Language toggle ── */}
      <div className="no-print absolute top-5 right-5 z-10 flex items-center gap-2">
        {ENABLE_AUTH && (
          <AuthButton
            user={pm.user}
            authLoading={pm.authLoading}
            isSyncing={pm.isSyncing}
            lang={lang}
            onOpenModal={() => setShowAuthModal(true)}
            onLogout={pm.logout}
          />
        )}
        <LangToggle lang={lang} onToggle={toggleLang} />
      </div>

      {/* ── Auth modal ── */}
      {ENABLE_AUTH && showAuthModal && (
        <AuthModal
          lang={lang}
          onLogin={pm.login}
          onSignup={pm.signup}
          onLoginGoogle={pm.loginWithGoogle}
          onClose={() => setShowAuthModal(false)}
        />
      )}

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
              color: "var(--morandi-green)", letterSpacing: "0.04em", lineHeight: 1,
            }}>
              {lang === "zh" ? "项目库" : "Projects"}
            </span>
            {pm.projects.length > 0 && (
              <span style={{
                position: "absolute", top: 6, right: 6,
                background: "var(--morandi-pink)", color: "#fff",
                borderRadius: "999px", fontSize: "9px", fontWeight: 700,
                minWidth: "14px", height: "14px", padding: "0 3px",
                display: "flex", alignItems: "center", justifyContent: "center",
                lineHeight: 1,
              }}>
                {pm.projects.length}
              </span>
            )}
          </div>
        </motion.button>

        <div>
          <h1 className="text-3xl font-bold leading-tight flex items-center justify-center gap-2">
            <span style={{
              fontFamily: "var(--font-quicksand), 'Nunito', sans-serif",
              color: "var(--morandi-green)", letterSpacing: "0.04em",
            }}>
              KnitStep
            </span>
            <span aria-hidden="true" style={{ color: "var(--morandi-green)", fontWeight: 700, fontSize: "0.6em", lineHeight: 1 }}>●</span>
            <span style={{
              fontFamily: 'var(--font-zcool), "PingFang SC", sans-serif',
              fontWeight: 700, letterSpacing: "0.1em", color: "var(--morandi-green)",
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
        isLoading={ai.isLoading}
        errorMsg={ai.error}
        rateLimitSecondsLeft={ai.rateLimitSecondsLeft}
        aiSubTab={aiSubTab}
        setAiSubTab={setAiSubTab}
        videoUrl={videoUrl}
        setVideoUrl={setVideoUrl}
        lightboxIndex={lightboxIndex}
        setLightboxIndex={setLightboxIndex}
        onConvert={ai.convert}
        onCancel={ai.cancel}
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
        setErrorMsg={ai.setError}
        isGridMode={isGridMode}
        setIsGridMode={setIsGridMode}
        isCrochetMode={isCrochetMode}
        setIsCrochetMode={setIsCrochetMode}
        promptVersion={promptVersion}
        setPromptVersion={setPromptVersion}
        onCalibrate={
          isGridMode && uploadedImages.length > 0 ? () => setShowCalibrator(true) : undefined
        }
      />

      {/* ── Calibrator ── */}
      <AnimatePresence>
        {showCalibrator && uploadedImages[0] && (
          <motion.div
            key="calibrator"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full max-w-4xl"
          >
            <GridCalibrator
              imageSrc={uploadedImages[0].previewUrl}
              lang={lang}
              onComplete={handleCalibrationComplete}
              onCancel={() => setShowCalibrator(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Crochet Calibrator ── */}
      <AnimatePresence>
        {showCrochetCalibrator && uploadedImages[0] && (
          <motion.div
            key="crochet-calibrator"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full max-w-4xl"
          >
            <CrochetCalibrator
              imageSrc={uploadedImages[0].previewUrl}
              imageBase64={uploadedImages[0].base64}
              imageMimeType={uploadedImages[0].mimeType}
              lang={lang}
              initialMode={lastCrochetMode ?? undefined}
              onComplete={handleCrochetCalibrationComplete}
              onCancel={() => setShowCrochetCalibrator(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Crochet Tracker ── */}
      <AnimatePresence>
        {crochetData && !showCrochetCalibrator && (
          <motion.div
            key={`crochet-tracker-${pm.currentProjectId ?? "local"}`}
            ref={crochetTrackerRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full max-w-4xl"
          >
            <CrochetTracker
              data={crochetData}
              lang={lang}
              onReset={() => {
                if (crochetData?.mode) setLastCrochetMode(crochetData.mode);
                // Restore image from stored data URL so the calibrator has an image to show
                if (crochetData?.imageSrc) {
                  const src = crochetData.imageSrc;
                  const [header, base64] = src.split(",");
                  const mimeType = header.split(":")[1]?.split(";")[0] ?? "image/jpeg";
                  setUploadedImages([{ base64, mimeType, previewUrl: src }]);
                }
                setCrochetData(null);
                localStorage.removeItem("knitstep_crochet");
                setShowCrochetCalibrator(true);
              }}
              onRowChange={(row) => {
                if (pm.currentProjectId) pm.updateCrochetProgress(pm.currentProjectId, row);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Row Tracker ── */}
      <AnimatePresence>
        {rowTrackerData && !showCalibrator && (
          <motion.div
            key={`row-tracker-${pm.currentProjectId ?? "local"}`}
            ref={rowTrackerRef}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full max-w-4xl"
          >
            <RowTracker
              {...rowTrackerData}
              lang={lang}
              onReset={() => {
                setRowTrackerData(null);
                localStorage.removeItem("knitstep_tracker");
                setShowCalibrator(true);
              }}
              onRowChange={(row) => {
                if (pm.currentProjectId) pm.updateTrackerProgress(pm.currentProjectId, row);
              }}
              onPatternMetaReady={(meta) => {
                if (pm.currentProjectId) pm.updateTrackerPatternMeta(pm.currentProjectId, meta);
                // Also update local state so switching away and back won't re-call
                setRowTrackerData((prev) => prev ? { ...prev, patternMeta: meta } : prev);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Grid View (grid projects) ── */}
      {(() => {
        const activeProject = pm.currentProjectId
          ? pm.projects.find((p) => p.id === pm.currentProjectId)
          : null;
        const isGridProject = hasConverted && activeProject?.type === "grid" && !!activeProject.gridData;
        if (isGridProject) {
          return (
            <GridView
              projectName={activeProject!.name}
              data={activeProject!.gridData!}
              onProgressUpdate={(row) => pm.updateGridProgress(activeProject!.id, row)}
              promptVersion={promptVersion}
            />
          );
        }
        return null;
      })()}

      {/* ── Checklist View — hidden for grid/tracker projects and in grid mode ── */}
      {(() => {
        const activeProject = pm.currentProjectId
          ? pm.projects.find((p) => p.id === pm.currentProjectId)
          : null;
        if (activeProject?.type === "tracker") return null;
        if (activeProject?.type === "crochet") return null;
        const isGridProject = hasConverted && activeProject?.type === "grid" && !!activeProject.gridData;
        if (isGridProject) return null;
        // Only let the grid/crochet-mode toggle hide the checklist when no checklist
        // project is already loaded — browsing upload options shouldn't affect it.
        const hasActiveChecklist = hasConverted && activeProject?.type !== "grid";
        if ((isGridMode || isCrochetMode) && !hasActiveChecklist) return null;
        return <ChecklistView
        lang={lang}
        t={t}
        steps={steps}
        hasConverted={hasConverted}
        isLoading={ai.isLoading}
        selectedSize={pm.selectedSize}
        isEditMode={isEditMode}
        tipVisible={tipVisible}
        checklistTopRef={checklistTopRef}
        dragIndex={dragIndex}
        dragOverIndex={dragOverIndex}
        activeMenuStepId={activeMenuStepId}
        currentProjectFiles={pm.currentProjectFiles}
        onToggleStep={toggleStep}
        onUpdateSubCount={updateSubCount}
        onTextEdit={handleTextEdit}
        onAddStep={addStep}
        onDeleteStep={deleteStep}
        onReset={handleReset}
        onDismissTip={dismissTip}
        onScrollToTop={scrollToChecklistTop}
        onScrollToFirstUnchecked={scrollToFirstUnchecked}
        setSelectedSize={pm.setSelectedSize}
        setIsEditMode={setIsEditMode}
        setTipVisible={setTipVisible}
        setDragIndex={setDragIndex}
        setDragOverIndex={setDragOverIndex}
        setActiveMenuStepId={setActiveMenuStepId}
        setShowReferencePanel={setShowReferencePanel}
        setHighlightedStepId={setHighlightedStepId}
        setCurrentFileIndex={pm.setCurrentFileIndex}
        onPrint={handlePrint}
        highlightedStepId={highlightedStepId}
      />;
      })()}

      {/* ── Floating Navigation Group ── */}
      <AnimatePresence>
        {hasConverted && !ai.isLoading && (
          <motion.div
            key="float-nav"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 24 }}
            className="no-print fixed bottom-6 right-5 z-40 flex flex-col items-end gap-2"
          >
            {/* ChevronUp — only when scrolled */}
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
                      background: "rgba(232,168,158,0.88)", backdropFilter: "blur(8px)",
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

            {/* Target — jump to first unchecked step */}
            <div className="group relative flex items-center">
              <span
                className="absolute right-full mr-3 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "rgba(30,24,20,0.78)", color: "#fff", backdropFilter: "blur(4px)" }}
              >
                {lang === "zh" ? "回到当前进度" : "Jump to Current"}
              </span>
              <div style={{ position: "relative" }}>
                {isDeepInList && !pm.hasClickedTarget && (
                  <motion.div
                    animate={{ scale: [1, 1.7, 1.7], opacity: [0.55, 0, 0] }}
                    transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity, repeatDelay: 1 }}
                    style={{
                      position: "absolute", inset: 0, borderRadius: "999px",
                      background: "rgba(143,175,150,0.55)", pointerEvents: "none",
                    }}
                  />
                )}
                <motion.button
                  whileHover={{ scale: 1.1, y: -1 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => { pm.setHasClickedTarget(true); scrollToFirstUnchecked(); }}
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

            {/* FileText — view reference file */}
            <div className="group relative flex items-center">
              <span
                className="absolute right-full mr-3 px-2.5 py-1 rounded-xl text-xs font-semibold whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                style={{ background: "rgba(30,24,20,0.78)", color: "#fff", backdropFilter: "blur(4px)" }}
              >
                {lang === "zh"
                  ? (pm.currentProjectFiles.length > 0 ? `查看原图${pm.currentProjectFiles.length > 1 ? ` (${pm.currentProjectFiles.length}张)` : ""}` : "无附件")
                  : (pm.currentProjectFiles.length > 0 ? `View Pattern${pm.currentProjectFiles.length > 1 ? ` (${pm.currentProjectFiles.length})` : ""}` : "No file")}
              </span>
              <div style={{ position: "relative" }}>
                <motion.button
                  whileHover={{ scale: pm.currentProjectFiles.length > 0 ? 1.1 : 1, y: pm.currentProjectFiles.length > 0 ? -1 : 0 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => {
                    const firstFile = pm.currentProjectFiles[0];
                    if (firstFile?.mimeType === "application/pdf") {
                      window.open(firstFile.url, "_blank", "noopener,noreferrer");
                    } else {
                      pm.setCurrentFileIndex(0);
                      setShowReferencePanel(true);
                    }
                  }}
                  aria-label={lang === "zh" ? "查看原图" : "View Pattern"}
                  style={{
                    width: "44px", height: "44px", borderRadius: "999px",
                    background: pm.currentProjectFiles.length > 0 ? "rgba(168,191,160,0.88)" : "rgba(168,191,160,0.42)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.35)",
                    boxShadow: pm.currentProjectFiles.length > 0 ? "0 4px 16px -4px rgba(120,155,115,0.4)" : "none",
                    color: "#fff", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "background 0.3s, box-shadow 0.3s",
                  }}
                >
                  <FileText size={17} strokeWidth={1.8} />
                </motion.button>
                {isPdf && (
                  <span style={{
                    position: "absolute", top: "2px", right: "2px",
                    width: "10px", height: "10px", borderRadius: "999px",
                    background: "var(--morandi-pink)",
                    border: "1.5px solid #fff", display: "block",
                  }} />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Grid Confidence Modal ── */}
      <AnimatePresence>
        {gridConfidenceModal && (
          <motion.div
            key="confidence-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}
            onClick={() => setGridConfidenceModal(null)}
          >
            <motion.div
              key="confidence-modal"
              initial={{ opacity: 0, scale: 0.94, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 12 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm mx-4 rounded-3xl px-6 py-6 flex flex-col gap-4"
              style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)", boxShadow: "0 20px 60px -10px rgba(0,0,0,0.18)" }}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold" style={{ color: "var(--text-main)" }}>
                  {lang === "zh" ? "AI 识别报告" : "AI Recognition Report"}
                </span>
                <button
                  onClick={() => setGridConfidenceModal(null)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", lineHeight: 0, padding: 4 }}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Confidence ring / score */}
              <div className="flex flex-col items-center gap-1 py-2">
                <span
                  className="text-5xl font-bold tabular-nums"
                  style={{ color: gridConfidenceModal.confidence >= 80 ? "#8FAF96" : "#C97B3A" }}
                >
                  {gridConfidenceModal.confidence}%
                </span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {lang === "zh" ? "置信度" : "Confidence"}
                </span>
              </div>

              {/* Analysis report */}
              {gridConfidenceModal.analysisReport && (
                <p className="text-xs text-center px-1" style={{ color: "var(--text-muted)", lineHeight: 1.6 }}>
                  {gridConfidenceModal.analysisReport}
                </p>
              )}

              {/* Low-confidence warning */}
              {gridConfidenceModal.confidence < 80 && (
                <div
                  className="rounded-2xl px-4 py-3 text-xs flex flex-col gap-2"
                  style={{ background: "rgba(245,200,50,0.12)", border: "1.5px solid rgba(215,170,30,0.40)", color: "#7A6000" }}
                >
                  <span style={{ fontWeight: 600 }}>
                    {lang === "zh" ? "⚠ 识别置信度较低，建议人工核对图解。" : "⚠ Low confidence — please review the chart manually."}
                  </span>
                  <span style={{ color: "#9A7A00" }}>
                    {lang === "zh" ? "橙色边框的格子表示 AI 存疑的位置。" : "Cells with orange borders are flagged as uncertain."}
                  </span>
                  <button
                    disabled
                    className="mt-1 rounded-xl px-3 py-1.5 text-xs font-semibold self-start"
                    style={{ background: "rgba(215,170,30,0.18)", border: "1px solid rgba(215,170,30,0.35)", color: "#9A7A00", cursor: "not-allowed", opacity: 0.7 }}
                  >
                    {lang === "zh" ? "手动模式（开发中）" : "Manual Mode (Coming Soon)"}
                  </button>
                </div>
              )}

              {/* Dismiss */}
              <button
                onClick={() => setGridConfidenceModal(null)}
                className="rounded-2xl py-2 text-sm font-semibold"
                style={{ background: "var(--morandi-stone)", color: "#fff", border: "none", cursor: "pointer" }}
              >
                {lang === "zh" ? "好的" : "Got it"}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Projects Modal ── */}
      <AnimatePresence>
        {showProjectsModal && (
          <ProjectGallery
            projects={pm.projects}
            lang={lang}
            currentProjectId={pm.currentProjectId}
            onClose={() => setShowProjectsModal(false)}
            onLoad={handleLoadProject}
            onDelete={handleDeleteProject}
            onRename={pm.handleRenameProject}
            cloudThumbnailUrls={cloudThumbnailUrls}
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
              else        setLightboxIndex((i) => (i !== null ? Math.max(0, i - 1) : null));
            }}
          >
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
                maxWidth: "min(92vw, 640px)", maxHeight: "80vh",
                objectFit: "contain", borderRadius: "1rem", userSelect: "none",
              }}
            />
            <div
              className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-sm font-semibold"
              style={{ background: "rgba(255,255,255,0.12)", color: "#fff", backdropFilter: "blur(6px)" }}
            >
              {lightboxIndex + 1} / {uploadedImages.length}
            </div>
            <button
              onClick={() => setLightboxIndex(null)}
              className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
            >
              <X size={18} strokeWidth={2.5} />
            </button>
            {lightboxIndex > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i - 1 : null)); }}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
              >
                <ChevronLeft size={22} strokeWidth={2.5} />
              </button>
            )}
            {lightboxIndex < uploadedImages.length - 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => (i !== null ? i + 1 : null)); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full"
                style={{ background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: "#fff" }}
              >
                <ChevronRight size={22} strokeWidth={2.5} />
              </button>
            )}
            {uploadedImages.length > 1 && (
              <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex gap-1.5">
                {uploadedImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                    style={{
                      width: i === lightboxIndex ? "18px" : "6px", height: "6px",
                      borderRadius: "999px",
                      background: i === lightboxIndex ? "var(--morandi-pink)" : "rgba(255,255,255,0.4)",
                      border: "none", cursor: "pointer",
                      transition: "width 0.2s, background 0.2s", padding: 0,
                    }}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sync progress toast ── */}
      <AnimatePresence>
        {pm.isSyncing && (
          <motion.div
            key="sync-toast"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium"
            style={{
              background: "rgba(143,175,150,0.95)", color: "#fff",
              boxShadow: "0 4px 20px -4px rgba(100,145,110,0.30)",
              backdropFilter: "blur(8px)",
              whiteSpace: "nowrap",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"
              style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
              <path d="M12 2 a10 10 0 0 1 10 10" />
            </svg>
            {lang === "zh" ? "正在同步云端数据..." : "Syncing to cloud…"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Storage warning toast ── */}
      <AnimatePresence>
        {pm.storageWarning && (
          <motion.div
            key="storage-warning"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3 }}
            className="no-print fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium"
            style={{
              background: "rgba(180,140,130,0.95)", color: "#fff",
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
              onClick={() => pm.setStorageWarning(false)}
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
        files={pm.currentProjectFiles}
        currentFileIndex={pm.currentFileIndex}
        setCurrentFileIndex={pm.setCurrentFileIndex}
        highlightedStepId={highlightedStepId}
        steps={steps}
      />

      {/* ── Persistent feedback footer ── */}
      <div className="no-print w-full flex items-center justify-center gap-2 flex-wrap pb-8 pt-2">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t.feedback}</span>
        <a
          href="https://xhslink.com/m/A11u8iECHmb"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
          style={{ color: "var(--morandi-pink)" }}
        >
          小红书
        </a>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>·</span>
        <a
          href="https://www.instagram.com/gammeeloveknitting/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold underline underline-offset-2 transition-opacity hover:opacity-70"
          style={{ color: "var(--morandi-pink)" }}
        >
          Instagram
        </a>
      </div>
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
        background: "var(--morandi-stone)", borderRadius: "999px",
        border: "1.5px solid var(--border)",
        boxShadow: "0 2px 12px -4px rgba(0,0,0,0.1)", cursor: "pointer",
      }}
      aria-label="Toggle language"
    >
      {(["zh", "en"] as const).map((l) => {
        const active = lang === l;
        return (
          <motion.span
            key={l}
            animate={{
              background: active ? "var(--morandi-pink)" : "rgba(0,0,0,0)",
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
  const uid    = useId();
  const clipId = `kl-${uid.replace(/:/g, "")}`;

  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <clipPath id={clipId}>
          <circle cx="50" cy="50" r="35" />
        </clipPath>
      </defs>
      <line x1="25" y1="8"  x2="75" y2="92" stroke="#C4A882" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="25" cy="8"  r="5.5" fill="#C4A882" />
      <circle cx="23" cy="6"  r="2"   fill="white" fillOpacity="0.4" />
      <line x1="8"  y1="30" x2="92" y2="70" stroke="#C4A882" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="8"  cy="30" r="5.5" fill="#C4A882" />
      <circle cx="6"  cy="28" r="2"   fill="white" fillOpacity="0.4" />
      <circle cx="50" cy="50" r="35"  fill="#A8BFA0" />
      <g clipPath={`url(#${clipId})`}>
        <path d="M 72 16 Q 50 50 28 84" stroke="white" strokeOpacity="0.22" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 84 30 Q 65 54 46 78" stroke="white" strokeOpacity="0.15" strokeWidth="3"   fill="none" strokeLinecap="round" />
        <path d="M 60 16 Q 38 50 16 84" stroke="white" strokeOpacity="0.18" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d="M 28 16 Q 50 50 72 84" stroke="black" strokeOpacity="0.07" strokeWidth="3"   fill="none" strokeLinecap="round" />
        <path d="M 16 30 Q 35 54 54 78" stroke="black" strokeOpacity="0.05" strokeWidth="3"   fill="none" strokeLinecap="round" />
        <path d="M 16 42 Q 50 33 84 42" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M 15 55 Q 50 46 85 55" stroke="white" strokeOpacity="0.18" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M 18 68 Q 50 59 82 68" stroke="white" strokeOpacity="0.12" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <ellipse cx="52" cy="73" rx="30" ry="16" fill="black" fillOpacity="0.13" />
        <ellipse cx="37" cy="35" rx="15" ry="11" fill="white" fillOpacity="0.2"  />
      </g>
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
      <div className="absolute top-5 right-5">
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.94 }}
          onClick={onToggleLang}
          className="text-xs font-semibold px-3 py-1.5 rounded-full"
          style={{
            background: "rgba(255,255,255,0.7)", color: "var(--text-muted)",
            border: "1px solid rgba(163,177,138,0.35)", cursor: "pointer",
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
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          boxShadow: "0 8px 32px -8px rgba(163,177,138,0.28)",
          border: "1px solid rgba(255,255,255,0.85)",
        }}
      >
        <KnitLogo className="w-16 h-16" />
        <div className="text-center">
          <p className="text-base font-bold" style={{ color: "var(--text-main)" }}>{g.title}</p>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>{g.subtitle}</p>
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
