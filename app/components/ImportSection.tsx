"use client";

import React, { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, Camera, FileText, Plus, Video, ArrowUpLeft, ArrowDownRight } from "lucide-react";
import { CARD_STYLE, RADIUS, SAMPLE_PATTERN, MAX_IMAGES, type Lang, type dict } from "../lib/types";
import { PROMPT_GALLERY, type PromptVersion } from "../lib/prompts";
import { ENABLE_PROMPT_LAB } from "../config";

export interface ImportSectionProps {
  lang: Lang;
  t: typeof dict[Lang];
  isInputExpanded: boolean;
  setIsInputExpanded: (v: boolean) => void;
  activeTab: "text" | "ai";
  setActiveTab: (tab: "text" | "ai") => void;
  inputText: string;
  setInputText: (s: string) => void;
  uploadedImages: { base64: string; mimeType: string; previewUrl: string }[];
  setUploadedImages: React.Dispatch<React.SetStateAction<{ base64: string; mimeType: string; previewUrl: string }[]>>;
  isCompressing: boolean;
  isLoading: boolean;
  errorMsg: string | null;
  rateLimitSecondsLeft: number | null;
  aiSubTab: "photo" | "video";
  setAiSubTab: (tab: "photo" | "video") => void;
  videoUrl: string;
  setVideoUrl: (s: string) => void;
  lightboxIndex: number | null;
  setLightboxIndex: (i: number | null) => void;
  onConvert: () => void;
  onCancel: () => void;
  onClear: () => void;
  onFileUpload: (file: File, currentCount?: number) => Promise<void>;
  hasConverted: boolean;
  mounted: boolean;
  latestFilesRef: React.MutableRefObject<File[]>;
  isDisabled: boolean;
  dragIndex: number | null;
  dragOverIndex: number | null;
  setDragIndex: (i: number | null) => void;
  setDragOverIndex: (i: number | null) => void;
  setErrorMsg: (msg: string | null) => void;
  isGridMode: boolean;
  setIsGridMode: (v: boolean) => void;
  isCrochetMode: boolean;
  setIsCrochetMode: (v: boolean) => void;
  promptVersion: PromptVersion;
  setPromptVersion: (v: PromptVersion) => void;
  /** Optional: triggers the manual calibration flow (grid or crochet) */
  onCalibrate?: () => void;
}

export default function ImportSection({
  lang,
  t,
  isInputExpanded,
  setIsInputExpanded,
  activeTab,
  setActiveTab,
  inputText,
  setInputText,
  uploadedImages,
  setUploadedImages,
  isCompressing,
  isLoading,
  errorMsg,
  rateLimitSecondsLeft,
  aiSubTab,
  setAiSubTab,
  videoUrl,
  setVideoUrl,
  lightboxIndex,
  setLightboxIndex,
  onConvert,
  onCancel,
  onClear,
  onFileUpload,
  hasConverted,
  mounted,
  latestFilesRef,
  isDisabled,
  dragIndex,
  dragOverIndex,
  setDragIndex,
  setDragOverIndex,
  setErrorMsg,
  isGridMode,
  setIsGridMode,
  isCrochetMode,
  setIsCrochetMode,
  promptVersion,
  setPromptVersion,
  onCalibrate,
}: ImportSectionProps) {
  return (
    <div className="no-print w-full max-w-xl" style={{ marginBottom: isInputExpanded ? "1.5rem" : "0.5rem" }}>
    {isInputExpanded ? (
    <div style={{ ...CARD_STYLE, borderRadius: RADIUS, overflow: "hidden" }}>
      {/* ── Tabs ── */}
      <div className="flex items-stretch" style={{ borderBottom: "1.5px solid var(--border)" }}>
        {/* Collapse button */}
        <button
          onClick={() => setIsInputExpanded(false)}
          title={lang === "zh" ? "收起" : "Collapse"}
          style={{
            padding: "0 14px",
            background: "none", border: "none", borderRight: "1.5px solid var(--border)",
            cursor: "pointer", color: "var(--text-muted)", lineHeight: 0, flexShrink: 0,
          }}
        >
          <ArrowUpLeft size={20} strokeWidth={2} />
        </button>
        {(["ai", "text"] as const).map((tab) => {
          const label  = tab === "text" ? t.tabText : t.tabAI;
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="relative flex-1 py-3.5 text-sm font-semibold tracking-wide transition-colors duration-200"
              style={{
                color:      active ? "var(--morandi-pink)" : "var(--text-muted)",
                background: "transparent",
                border:     "none",
                cursor:     "pointer",
              }}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={lang + tab}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  {label}
                </motion.span>
              </AnimatePresence>

              {active && (
                <motion.span
                  layoutId="tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: "var(--morandi-pink)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ── Tab panels ── */}
      <div className="p-8">
        <AnimatePresence mode="wait">

          {/* Text panel */}
          {activeTab === "text" && (
            <motion.div
              key="text"
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 14 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <textarea
                id="pattern-input"
                rows={7}
                suppressHydrationWarning
                maxLength={10000}
                className="w-full p-4 text-base resize-none focus:outline-none transition-all duration-200"
                style={{
                  background:  "var(--bg)",
                  border:      "1.5px solid var(--border)",
                  borderRadius: "1.25rem",
                  color:       "var(--text-main)",
                  fontFamily:  "var(--font-body)",
                }}
                onFocus={(e) =>
                  (e.currentTarget.style.border = "1.5px solid var(--morandi-pink)")
                }
                onBlur={(e) =>
                  (e.currentTarget.style.border = "1.5px solid var(--border)")
                }
                placeholder={t.placeholder}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <div className="flex items-center justify-between mt-1.5 px-1">
                <button
                  type="button"
                  onClick={() => setInputText(SAMPLE_PATTERN)}
                  className="text-xs font-medium underline-offset-2 underline transition-opacity hover:opacity-70"
                  style={{ color: "var(--morandi-sage)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  {t.trySample}
                </button>
                {mounted && (
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: inputText.length >= 4800 ? "var(--morandi-blush)" : "var(--text-muted)" }}
                  >
                    {inputText.length} / 10000
                  </span>
                )}
              </div>

              <motion.button
                onClick={onConvert}
                disabled={isDisabled}
                whileHover={isDisabled ? {} : { scale: 1.05 }}
                whileTap={isDisabled ? {} : { scale: 0.95 }}
                // breathing animation while loading
                animate={isLoading ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
                transition={
                  isLoading
                    ? { opacity: { repeat: Infinity, duration: 1.4, ease: "easeInOut" } }
                    : { type: "spring", stiffness: 380, damping: 16 }
                }
                className="mt-5 w-full py-3.5 text-base font-semibold tracking-wide"
                style={{
                  background:   "var(--morandi-pink)",
                  color:        "#fff",
                  borderRadius: RADIUS,
                  boxShadow:    "0 4px 20px -6px rgba(231,200,197,0.7)",
                  opacity:      inputText.trim().length === 0 ? 0.45 : 1,
                  cursor:       isDisabled ? "not-allowed" : "pointer",
                }}
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={isLoading ? "loading" : lang + "-btn"}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="block"
                  >
                    {isLoading ? (aiSubTab === "video" ? t.loadingVideoBtn : t.loadingBtn) : t.convertBtn}
                  </motion.span>
                </AnimatePresence>
              </motion.button>

              {/* Cancel button — visible while AI is running */}
              <AnimatePresence>
                {isLoading && (
                  <motion.button
                    key="cancel-text"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.18 }}
                    onClick={onCancel}
                    className="mt-3 w-full py-2 text-sm font-medium"
                    style={{
                      background: "transparent",
                      border: "1.5px solid var(--border)",
                      borderRadius: RADIUS,
                      color: "var(--text-muted)",
                      cursor: "pointer",
                    }}
                  >
                    {lang === "zh" ? "取消" : "Cancel"}
                  </motion.button>
                )}
              </AnimatePresence>

              {/* 新增的清除按钮 */}
              {hasConverted && !isLoading && (
                <motion.button
                  onClick={onClear}
                  className="mt-4 text-xs font-medium underline transition-opacity hover:opacity-70 w-full text-center"
                  style={{ color: "var(--text-muted)" }}
                >
                  {lang === "zh" ? "清除数据并重来" : "Clear and Restart"}
                </motion.button>
              )}

              {/* ── Error / rate-limit countdown ── */}
              <AnimatePresence>
                {rateLimitSecondsLeft !== null && rateLimitSecondsLeft > 0 ? (
                  <motion.p
                    key="countdown"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-stone)" }}
                  >
                    ⏳ {lang === "zh"
                      ? `AI 正在休息，${rateLimitSecondsLeft} 秒后可重试…`
                      : `AI is resting — retry in ${rateLimitSecondsLeft}s…`}
                  </motion.p>
                ) : rateLimitSecondsLeft === 0 ? (
                  <motion.p
                    key="countdown-done"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-green)" }}
                  >
                    ✅ {lang === "zh" ? "可以重试了！" : "Ready to retry!"}
                  </motion.p>
                ) : errorMsg ? (
                  <motion.p
                    key="error"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-blush)" }}
                  >
                    ⚠️ {errorMsg}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}

          {/* AI Upload panel */}
          {activeTab === "ai" && (
            <motion.div
              key="ai"
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {/* ── Checklist / Grid Chart / Crochet Chart mode toggle ── */}
              <div
                className="flex mb-4 rounded-xl p-0.5"
                style={{ background: "var(--bg)", border: "1.5px solid var(--border)" }}
              >
                {([
                  {
                    grid: false, crochet: false,
                    label: lang === "zh" ? "文字图解"   : "Checklist",
                    sub:   lang === "zh" ? "文字图片、PDF、视频" : "Text, PDF, or Video",
                  },
                  {
                    grid: true,  crochet: false,
                    label: lang === "zh" ? "编织格子图" : "Grid Chart",
                    sub:   lang === "zh" ? "手动标定，按行追踪"  : "Manual row tracking",
                  },
                  {
                    grid: false, crochet: true,
                    label: lang === "zh" ? "钩针图解"   : "Crochet Chart",
                    sub:   lang === "zh" ? "圈织/片织追踪"       : "Circular or flat",
                  },
                ]).map(({ grid, crochet, label, sub }) => {
                  const active = isGridMode === grid && isCrochetMode === crochet;
                  return (
                    <button
                      key={`${grid}-${crochet}`}
                      onClick={() => {
                        setIsGridMode(grid);
                        setIsCrochetMode(crochet);
                        setUploadedImages([]);
                        latestFilesRef.current = [];
                        setVideoUrl("");
                        setErrorMsg(null);
                        if (grid || crochet) setAiSubTab("photo");
                      }}
                      className="flex-1 flex flex-col items-center py-2 rounded-lg transition-all duration-200"
                      style={{
                        background: active ? "var(--morandi-pink)" : "transparent",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      <span className="text-xs font-bold" style={{ color: active ? "#fff" : "var(--text-main)" }}>
                        {label}
                      </span>
                      <span className="text-xs mt-0.5" style={{ color: active ? "rgba(255,255,255,0.75)" : "var(--text-muted)" }}>
                        {sub}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ── KnitStep Lab: prompt version selector (grid mode only) ── */}
              {ENABLE_PROMPT_LAB && isGridMode && !isCrochetMode && (
                <div className="mb-4 flex flex-col gap-1.5">
                  <label
                    className="text-xs font-semibold tracking-wide uppercase"
                    style={{ color: "var(--text-muted)" }}
                  >
                    🧪 Lab — AI 提示词版本
                  </label>
                  <select
                    value={promptVersion}
                    onChange={(e) => setPromptVersion(e.target.value as PromptVersion)}
                    className="w-full px-3 py-2 rounded-xl text-sm font-medium outline-none"
                    style={{
                      background:   "var(--bg)",
                      border:       "1.5px solid var(--morandi-sage)",
                      color:        "var(--text-main)",
                      cursor:       "pointer",
                      appearance:   "none",
                    }}
                  >
                    {(Object.values(PROMPT_GALLERY) as typeof PROMPT_GALLERY[PromptVersion][]).map((cfg) => (
                      <option key={cfg.id} value={cfg.id}>
                        {cfg.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs px-1" style={{ color: "var(--text-muted)" }}>
                    {PROMPT_GALLERY[promptVersion].description}
                  </p>
                </div>
              )}

              {/* ── Photo / Video sub-tab toggle (hidden in grid/crochet mode) ── */}
              {!isGridMode && !isCrochetMode && (
              <div className="flex gap-2 mb-4">
                {(["photo", "video"] as const).map((sub) => {
                  const active = aiSubTab === sub;
                  return (
                    <button
                      key={sub}
                      onClick={() => { setAiSubTab(sub); setUploadedImages([]); latestFilesRef.current = []; setVideoUrl(""); setErrorMsg(null); }}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold transition-all duration-200"
                      style={{
                        background: active ? "var(--morandi-sage)" : "var(--bg-card)",
                        color:      active ? "#fff" : "var(--text-muted)",
                        border:     active ? "none" : "1px solid var(--border)",
                        cursor: "pointer",
                      }}
                    >
                      {sub === "photo" ? <Camera size={13} strokeWidth={2} /> : <Video size={13} strokeWidth={2} />}
                      {sub === "photo" ? t.aiSubPhoto : t.aiSubVideo}
                    </button>
                  );
                })}
              </div>
              )}

              <AnimatePresence mode="wait">
                {/* ── Video sub-tab: YouTube URL only ── */}
                {aiSubTab === "video" && (
                  <motion.div
                    key="video-panel"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col gap-3"
                  >
                    <input
                      type="url"
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder={t.videoUrlPlaceholder}
                      className="w-full px-4 py-2.5 rounded-2xl text-sm outline-none"
                      style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)", color: "var(--text-main)" }}
                    />
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t.videoUrlLabel}</p>

                    <AnimatePresence>
                      {videoUrl.trim() && (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
                          <motion.button
                            onClick={onConvert}
                            disabled={isLoading}
                            whileHover={isLoading ? {} : { scale: 1.05 }}
                            whileTap={isLoading ? {} : { scale: 0.95 }}
                            className="mt-1 w-full py-3.5 text-base font-semibold tracking-wide rounded-2xl"
                            style={{ background: isLoading ? "var(--morandi-stone)" : "var(--morandi-pink)", color: "#fff", border: "none", cursor: isLoading ? "not-allowed" : "pointer" }}
                          >
                            <AnimatePresence mode="wait">
                              <motion.span key={isLoading ? "loading" : "idle"} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }} className="block">
                                {isLoading ? t.loadingVideoBtn : t.convertBtn}
                              </motion.span>
                            </AnimatePresence>
                          </motion.button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Photo/PDF sub-tab (existing logic, now wrapped) ── */}
              {aiSubTab === "photo" && <AnimatePresence mode="wait">
                {isCompressing ? (
                  /* ── Compressing state ── */
                  <motion.div
                    key="compressing"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col items-center justify-center gap-3"
                    style={{ minHeight: "220px" }}
                  >
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
                      style={{
                        width:       "2rem",
                        height:      "2rem",
                        borderRadius: "50%",
                        border:      "2.5px solid var(--morandi-pink)",
                        borderTopColor: "transparent",
                      }}
                    />
                    <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                      {t.compressing}
                    </p>
                  </motion.div>
                ) : uploadedImages.length > 0 && uploadedImages[0].mimeType === "application/pdf" ? (
                  /* ── PDF preview ── */
                  <motion.div
                    key="pdf-preview"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.2 }}
                    className="relative"
                  >
                    <div
                      className="w-full flex flex-col items-center justify-center gap-3 rounded-2xl py-10"
                      style={{ border: "1.5px solid var(--border)", background: "var(--bg)" }}
                    >
                      <FileText size={48} strokeWidth={1.3} style={{ color: "var(--morandi-sage)" }} />
                      <p className="text-sm font-medium" style={{ color: "var(--text-main)" }}>
                        {t.uploadPdfReady}
                      </p>
                    </div>
                    <button
                      onClick={() => { setUploadedImages([]); latestFilesRef.current = []; }}
                      className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold"
                      style={{ background: "rgba(0,0,0,0.45)", color: "#fff", border: "none", cursor: "pointer", lineHeight: 0 }}
                    >
                      ✕
                    </button>
                  </motion.div>
                ) : uploadedImages.length > 0 ? (
                  /* ── Image gallery ── */
                  <motion.div
                    key="gallery"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                  >
                    {/* Gallery header: count (checklist mode only) + clear all */}
                    <div className={`flex items-center mb-2 ${isGridMode || isCrochetMode ? "justify-end" : "justify-between"}`}>
                      {!isGridMode && !isCrochetMode && (
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {uploadedImages.length} / {MAX_IMAGES} {lang === "zh" ? "张图片" : "images"}
                        </span>
                      )}
                      <button
                        onClick={() => { setUploadedImages([]); latestFilesRef.current = []; }}
                        className="text-xs font-medium"
                        style={{ color: "var(--morandi-blush)", background: "none", border: "none", cursor: "pointer" }}
                      >
                        {t.clearAll}
                      </button>
                    </div>

                    {/* Thumbnail row */}
                    <div className="flex flex-wrap gap-2">
                      {uploadedImages.map((img, i) => (
                        <div
                          key={i}
                          draggable
                          onDragStart={() => { setDragIndex(i); setDragOverIndex(null); }}
                          onDragOver={(e) => { e.preventDefault(); if (dragOverIndex !== i) setDragOverIndex(i); }}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragIndex === null || dragIndex === i) { setDragIndex(null); setDragOverIndex(null); return; }
                            setUploadedImages((prev) => {
                              const next = [...prev];
                              const [moved] = next.splice(dragIndex, 1);
                              next.splice(i, 0, moved);
                              return next;
                            });
                            // Keep latestFilesRef in sync with the new display order
                            const reordered = [...latestFilesRef.current];
                            const [movedFile] = reordered.splice(dragIndex, 1);
                            reordered.splice(i, 0, movedFile);
                            latestFilesRef.current = reordered;
                            setDragIndex(null); setDragOverIndex(null);
                          }}
                          onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                          onClick={() => setLightboxIndex(i)}
                          className="relative flex-shrink-0 rounded-xl overflow-hidden"
                          style={{
                            width: "72px", height: "72px",
                            border: dragOverIndex === i ? "2px solid var(--morandi-pink)" : "1.5px solid var(--border)",
                            opacity: dragIndex === i ? 0.4 : 1,
                            cursor: dragIndex !== null ? "grabbing" : "grab",
                            transition: "opacity 0.15s, border-color 0.15s",
                          }}
                        >
                          <img
                            src={img.previewUrl}
                            alt={`pattern ${i + 1}`}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                          {/* Sequence badge — bottom-left */}
                          <span
                            className="absolute bottom-0.5 left-1 text-xs font-bold leading-none"
                            style={{ color: "#fff", textShadow: "0 1px 3px rgba(0,0,0,0.7)" }}
                          >
                            {i + 1}
                          </span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setUploadedImages((prev) => prev.filter((_, idx) => idx !== i)); latestFilesRef.current = latestFilesRef.current.filter((_, idx) => idx !== i); }}
                            className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold"
                            style={{ background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer", lineHeight: 0 }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      {/* "Add more" tile — hidden in grid/crochet mode (1 image max) */}
                      {!isGridMode && !isCrochetMode && uploadedImages.length < MAX_IMAGES && (
                        <label
                          htmlFor="file-upload"
                          className="flex-shrink-0 flex items-center justify-center rounded-xl cursor-pointer"
                          style={{ width: "72px", height: "72px", border: "1.5px dashed var(--morandi-sage)", background: "var(--bg)" }}
                        >
                          <Plus size={22} strokeWidth={1.8} style={{ color: "var(--morandi-sage)" }} />
                        </label>
                      )}
                    </div>
                  </motion.div>
                ) : (
                  /* ── Drop zone ── */
                  <motion.label
                    key="dropzone"
                    htmlFor="file-upload"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col items-center justify-center gap-4 w-full cursor-pointer transition-all duration-200"
                    style={{
                      minHeight:    "220px",
                      border:       "2px dashed var(--morandi-sage)",
                      borderRadius: "1.5rem",
                      background:   "var(--bg)",
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = "var(--morandi-pink)";
                      e.currentTarget.style.background  = "var(--bg-card)";
                    }}
                    onDragLeave={(e) => {
                      e.currentTarget.style.borderColor = "var(--morandi-sage)";
                      e.currentTarget.style.background  = "var(--bg)";
                    }}
                    onDrop={async (e) => {
                      e.preventDefault();
                      e.currentTarget.style.borderColor = "var(--morandi-sage)";
                      e.currentTarget.style.background  = "var(--bg)";
                      const files = Array.from(e.dataTransfer.files ?? []);
                      const limit = (isGridMode || isCrochetMode) ? 1 : MAX_IMAGES;
                      const startCount = uploadedImages.length;
                      const available = limit - startCount;
                      if (files.length > available) setErrorMsg(t.errorMaxImages);
                      for (let i = 0; i < Math.min(files.length, available); i++) {
                        await onFileUpload(files[i], startCount + i);
                      }
                    }}
                  >
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}
                    >
                      <UploadCloud size={48} strokeWidth={1.4} style={{ color: "var(--morandi-sage)" }} />
                    </motion.div>
                    <div className="text-center px-4">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={lang + "-upload"}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          transition={{ duration: 0.2 }}
                        >
                          {isGridMode ? (
                            <>
                              <p className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>
                                {lang === "zh" ? "上传格子图" : "Upload Chart"}
                              </p>
                              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                                {lang === "zh" ? "拍照或选择一张图片" : "Take a photo or choose an image"}
                              </p>
                              <span
                                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-full"
                                style={{ background: "var(--morandi-sage)", color: "#fff", minHeight: "44px" }}
                              >
                                <Camera size={16} strokeWidth={2} />
                                {lang === "zh" ? "选择图片或拍照" : "Select or Take Photo"}
                              </span>
                            </>
                          ) : isCrochetMode ? (
                            <>
                              <p className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>
                                {lang === "zh" ? "上传钩针图解" : "Upload Crochet Chart"}
                              </p>
                              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                                {lang === "zh" ? "拍照或选择一张图片" : "Take a photo or choose an image"}
                              </p>
                              <span
                                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-full"
                                style={{ background: "var(--morandi-sage)", color: "#fff", minHeight: "44px" }}
                              >
                                <Camera size={16} strokeWidth={2} />
                                {lang === "zh" ? "选择图片或拍照" : "Select or Take Photo"}
                              </span>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>{t.uploadTitle}</p>
                              <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>{t.uploadSub}</p>
                              <span
                                className="mt-4 inline-flex items-center gap-2 text-sm font-semibold px-6 py-3 rounded-full"
                                style={{ background: "var(--morandi-sage)", color: "#fff", minHeight: "44px" }}
                              >
                                <Camera size={16} strokeWidth={2} />
                                <FileText size={15} strokeWidth={2} />
                                {t.uploadClick}
                              </span>
                            </>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </motion.label>
                )}
              </AnimatePresence>}

              {/* Always-present file input — keeps #file-upload in the DOM so
                  both the drop zone label and the gallery "+" tile can trigger it */}
              <input
                id="file-upload"
                type="file"
                accept={(isGridMode || isCrochetMode) ? "image/*" : "image/*,application/pdf"}
                multiple={!isGridMode && !isCrochetMode}
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files ?? []);
                  const limit = (isGridMode || isCrochetMode) ? 1 : MAX_IMAGES;
                  const startCount = uploadedImages.length;
                  const available = limit - startCount;
                  if (files.length > available) setErrorMsg(t.errorMaxImages);
                  for (let i = 0; i < Math.min(files.length, available); i++) {
                    await onFileUpload(files[i], startCount + i);
                  }
                  e.target.value = "";
                }}
              />

              {/* Action button — only shown after image(s) are selected */}
              <AnimatePresence>
                {uploadedImages.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    transition={{ duration: 0.2 }}
                  >
                    {(isGridMode || isCrochetMode) && onCalibrate ? (
                      /* Grid / Crochet mode: open the calibration wizard */
                      <motion.button
                        onClick={onCalibrate}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        className="mt-5 w-full py-3.5 text-base font-semibold tracking-wide"
                        style={{
                          background:   "var(--morandi-green)",
                          color:        "#fff",
                          borderRadius: RADIUS,
                          boxShadow:    "0 4px 20px -6px rgba(143,175,150,0.55)",
                          cursor:       "pointer",
                          border:       "none",
                        }}
                      >
                        {isCrochetMode
                          ? (lang === "zh" ? "开始 AI 标定" : "Start Calibration")
                          : (lang === "zh" ? "开始行追踪"   : "Start Row Tracking")}
                      </motion.button>
                    ) : !isGridMode && !isCrochetMode ? (
                      /* Non-grid (checklist / text) mode: AI conversion */
                      <>
                        <motion.button
                          onClick={onConvert}
                          disabled={isLoading}
                          whileHover={isLoading ? {} : { scale: 1.05 }}
                          whileTap={isLoading ? {} : { scale: 0.95 }}
                          animate={isLoading ? { opacity: [1, 0.55, 1] } : { opacity: 1 }}
                          transition={
                            isLoading
                              ? { opacity: { repeat: Infinity, duration: 1.4, ease: "easeInOut" } }
                              : { type: "spring", stiffness: 380, damping: 16 }
                          }
                          className="mt-5 w-full py-3.5 text-base font-semibold tracking-wide"
                          style={{
                            background:   "var(--morandi-pink)",
                            color:        "#fff",
                            borderRadius: RADIUS,
                            boxShadow:    "0 4px 20px -6px rgba(231,200,197,0.7)",
                            cursor:       isLoading ? "not-allowed" : "pointer",
                            border:       "none",
                          }}
                        >
                          <AnimatePresence mode="wait">
                            <motion.span
                              key={isLoading ? "loading" : lang + "-img-btn"}
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.18 }}
                              className="block"
                            >
                              {isLoading ? t.loadingBtn : t.convertBtn}
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>

                        {/* Cancel button — visible while AI is running */}
                        <AnimatePresence>
                          {isLoading && (
                            <motion.button
                              key="cancel-ai"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 4 }}
                              transition={{ duration: 0.18 }}
                              onClick={onCancel}
                              className="mt-3 w-full py-2 text-sm font-medium"
                              style={{
                                background: "transparent",
                                border: "1.5px solid var(--border)",
                                borderRadius: RADIUS,
                                color: "var(--text-muted)",
                                cursor: "pointer",
                              }}
                            >
                              {lang === "zh" ? "取消" : "Cancel"}
                            </motion.button>
                          )}
                        </AnimatePresence>
                      </>
                    ) : null}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Error / rate-limit countdown (AI tab) ── */}
              <AnimatePresence>
                {rateLimitSecondsLeft !== null && rateLimitSecondsLeft > 0 ? (
                  <motion.p
                    key="countdown-ai"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-stone)" }}
                  >
                    ⏳ {lang === "zh"
                      ? `AI 正在休息，${rateLimitSecondsLeft} 秒后可重试…`
                      : `AI is resting — retry in ${rateLimitSecondsLeft}s…`}
                  </motion.p>
                ) : rateLimitSecondsLeft === 0 ? (
                  <motion.p
                    key="countdown-ai-done"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-green)" }}
                  >
                    ✅ {lang === "zh" ? "可以重试了！" : "Ready to retry!"}
                  </motion.p>
                ) : errorMsg ? (
                  <motion.p
                    key="error-ai"
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2 }}
                    className="mt-3 text-center text-xs font-medium"
                    style={{ color: "var(--morandi-blush)" }}
                  >
                    ⚠️ {errorMsg}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
    ) : (
    /* ── Collapsed pill ── */
    <button
      onClick={() => setIsInputExpanded(true)}
      className="no-print mb-4 flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold"
      style={{
        background: "var(--morandi-green)", color: "#fff", border: "none",
        cursor: "pointer", boxShadow: "0 2px 10px -4px rgba(120,155,115,0.4)",
      }}
    >
      <ArrowDownRight size={20} strokeWidth={2} />
      {lang === "zh" ? "导入新项目" : "New Project"}
    </button>
    )}
    </div>
  );
}
