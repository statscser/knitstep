"use client";

import { useState, useEffect } from "react";
import { parseInput, ACCESS_CODE, type Lang, type Step } from "../lib/types";

// ─── useAIConversion ──────────────────────────────────────────────────────────
// Owns all AI / API-fetch logic and related loading/error state.
// Calls onSuccess(parsed, files) after a successful conversion so the caller
// can persist the project and update its own step state.

interface UploadedImage {
  base64: string;
  mimeType: string;
  previewUrl: string;
}

interface UseAIConversionOptions {
  lang: Lang;
  activeTab: "text" | "ai";
  aiSubTab: "photo" | "video";
  inputText: string;
  uploadedImages: UploadedImage[];
  videoUrl: string;
  /** Ref holding the raw File objects accumulated during this session. */
  latestFilesRef: React.MutableRefObject<File[]>;
  /** Called at the very start of a conversion so page.tsx can reset UI state. */
  onPreConvert: () => void;
  /** Called with the parsed steps (and original files) on success. */
  onSuccess: (parsed: Step[], files: File[]) => Promise<void>;
}

export function useAIConversion({
  lang,
  activeTab,
  aiSubTab,
  inputText,
  uploadedImages,
  videoUrl,
  latestFilesRef,
  onPreConvert,
  onSuccess,
}: UseAIConversionOptions) {
  const [isLoading, setIsLoading]                 = useState(false);
  const [error, setError]                         = useState<string | null>(null);
  const [rateLimitSecondsLeft, setRateLimitSecondsLeft] = useState<number | null>(null);

  // ── Countdown timer for rate-limit (429) ───────────────────────────────────
  useEffect(() => {
    if (!rateLimitSecondsLeft) return;
    const timer = setTimeout(
      () => setRateLimitSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [rateLimitSecondsLeft]);

  // ── Error messages (mirrored from dict for simplicity; lang-reactive) ──────
  const t = {
    errorFileTooLarge: lang === "zh" ? "文件太大，请压缩后再上传" : "File too large. Please compress before uploading.",
    errorMaxImages:    lang === "zh" ? "最多上传10张图片" : "Max 10 images allowed.",
    errorKey:          lang === "zh" ? "API 密钥缺失" : "API key missing.",
    errorModel:        lang === "zh" ? "模型暂时不可用" : "Model temporarily unavailable.",
    errorVideoFailed:  lang === "zh" ? "视频处理失败，请换个视频试试" : "Video processing failed. Please try another video.",
    errorUnknown:      lang === "zh" ? "解析失败，请稍后再试" : "Parsing failed. Please try again.",
  } as const;

  async function convert() {
    setIsLoading(true);
    setError(null);
    setRateLimitSecondsLeft(null);

    // Tell page.tsx to reset its UI state (steps, isEditMode, currentProjectId…)
    // before we start so the sync effect doesn't overwrite the active project.
    onPreConvert();

    // Snapshot the files we're about to send — latestFilesRef is mutated during
    // upload so we capture once here.
    const filesToSave = activeTab === "ai" && uploadedImages.length > 0
      ? latestFilesRef.current
      : [];

    try {
      // ── Step 1: Fetch from API ─────────────────────────────────────────────
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
          const body =
            activeTab === "ai" && uploadedImages.length > 0
              ? {
                  text: "",
                  language: lang,
                  images: uploadedImages.map((img) => ({ base64: img.base64, mimeType: img.mimeType })),
                  accessCode: ACCESS_CODE,
                }
              : { text: inputText, language: lang, accessCode: ACCESS_CODE };
          res = await fetch("/api/parse", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify(body),
          });
        }

        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "UNKNOWN_ERROR");

        // Preserve sizeMap / sourceBox so Smart Sizing & visual grounding work
        const base = Date.now();
        parsed = (data.steps as {
          text: string;
          original?: string;
          isHeader?: boolean;
          sizeMap?: Record<string, string>;
          sourceBox?: [number, number, number, number];
          sourceFileIndex?: number;
        }[]).map((s, idx) => ({
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
        // AI / video tabs: re-throw so the outer catch shows the right message
        if (activeTab !== "text") throw aiErr;
        // Text tab: silently fall back to the line-by-line regex parser
        const base = Date.now();
        parsed = parseInput(inputText).map((s, i) => ({ ...s, id: base + i }));
      }

      // ── Step 2: Delegate to caller (persist project + update page state) ───
      await onSuccess(parsed, filesToSave);
    } catch (err: any) {
      const msg = err?.message ?? "";
      if      (msg === "QUOTA_EXCEEDED")           setRateLimitSecondsLeft(30);
      else if (msg === "FILE_TOO_LARGE")           setError(t.errorFileTooLarge);
      else if (msg === "API_KEY_MISSING")          setError(t.errorKey);
      else if (msg === "MODEL_UNAVAILABLE")        setError(t.errorModel);
      else if (
        msg === "VIDEO_PROCESSING_FAILED" ||
        msg === "NO_TEXT_EXTRACTED"
      )                                            setError(t.errorVideoFailed);
      else                                         setError(t.errorUnknown);
    } finally {
      setIsLoading(false);
    }
  }

  return {
    convert,
    isLoading,
    error,
    setError,
    rateLimitSecondsLeft,
  };
}
