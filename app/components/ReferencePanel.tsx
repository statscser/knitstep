"use client";

import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import SourceHighlight from "./SourceHighlight";
import { type Lang, type Step } from "../lib/types";

export interface ReferencePanelProps {
  lang: Lang;
  show: boolean;
  onClose: () => void;
  files: { url: string; mimeType: string }[];
  currentFileIndex: number;
  setCurrentFileIndex: (i: number) => void;
  highlightedStepId: number | null;
  steps: Step[];
}

export default function ReferencePanel({
  lang,
  show,
  onClose,
  files,
  currentFileIndex,
  setCurrentFileIndex,
  highlightedStepId,
  steps,
}: ReferencePanelProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="reference-panel"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-50 flex flex-col"
          style={{ background: "rgba(30,24,20,0.88)", backdropFilter: "blur(6px)" }}
        >
          {/* Header bar */}
          <div
            className="flex items-center justify-between px-5 py-4 shrink-0"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}
          >
            <div className="flex items-center gap-3">
              <span style={{ color: "#fff", fontWeight: 700, fontSize: "14px", letterSpacing: "0.04em" }}>
                {lang === "zh" ? "原始图解" : "Original Pattern"}
              </span>
              {/* Page counter — only shown for multi-file projects */}
              {files.length > 1 && (
                <span style={{
                  background: "rgba(255,255,255,0.15)", color: "#fff",
                  fontSize: "12px", fontWeight: 600, padding: "2px 10px",
                  borderRadius: "999px", letterSpacing: "0.03em",
                }}>
                  {lang === "zh"
                    ? `第 ${currentFileIndex + 1} / ${files.length} 页`
                    : `${currentFileIndex + 1} / ${files.length}`}
                </span>
              )}
            </div>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.92 }}
              onClick={onClose}
              style={{
                width: "34px", height: "34px", borderRadius: "999px",
                background: "rgba(255,255,255,0.12)", border: "none",
                cursor: "pointer", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={17} strokeWidth={2.5} />
            </motion.button>
          </div>

          {/* File content */}
          {files.length > 0 ? (() => {
            const file = files[currentFileIndex];
            return file.mimeType === "application/pdf" ? (
              /* ── PDF fallback (normally bypassed — PDFs open via window.open) ── */
              <div className="flex flex-col flex-1 items-center justify-center gap-4">
                <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "13px" }}>
                  {lang === "zh" ? "PDF 将在新标签页中打开" : "PDF opens in a new tab."}
                </p>
                <motion.button
                  whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.93 }}
                  onClick={() => window.open(file.url, "_blank", "noopener,noreferrer")}
                  style={{
                    display: "flex", alignItems: "center", gap: "6px",
                    background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.4)",
                    borderRadius: "10px", padding: "8px 18px",
                    color: "#10b981", fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <ExternalLink size={14} strokeWidth={2.5} />
                  {lang === "zh" ? "打开 PDF" : "Open PDF"}
                </motion.button>
              </div>
            ) : (
              /* ── Image carousel ──
                 inline-block wrapper: shrinks to image w×h so % coords align exactly
                 with image pixels; display:block on <img> prevents the ~4px line-gap
                 that inline images add below the baseline */
              <div className="flex-1 overflow-y-auto px-4 py-5" style={{ textAlign: "left" }}>
                <div style={{ display: "inline-block", position: "relative", width: "100%", borderRadius: "1rem", boxShadow: "0 4px 24px -8px rgba(0,0,0,0.5)", overflow: "hidden" }}>
                  <AnimatePresence mode="wait">
                    <motion.img
                      key={file.url}
                      src={file.url}
                      alt={`Pattern page ${currentFileIndex + 1}`}
                      initial={{ opacity: 0, x: 30 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -30 }}
                      transition={{ duration: 0.18 }}
                      style={{ width: "100%", display: "block" }}
                    />
                  </AnimatePresence>

                  {/* Highlight overlay — logic lives in SourceHighlight.tsx */}
                  {(() => {
                    const hStep = highlightedStepId !== null
                      ? steps.find((s) => s.id === highlightedStepId)
                      : null;
                    return (
                      <SourceHighlight
                        sourceBox={hStep?.sourceBox}
                        isVisible={(hStep?.sourceFileIndex ?? 0) === currentFileIndex}
                      />
                    );
                  })()}
                </div>

                {/* Prev / Next navigation */}
                {files.length > 1 && (
                  <div
                    className="flex items-center justify-between"
                    style={{ marginTop: "16px" }}
                  >
                    <motion.button
                      whileHover={{ scale: currentFileIndex > 0 ? 1.08 : 1 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setCurrentFileIndex(Math.max(0, currentFileIndex - 1))}
                      disabled={currentFileIndex === 0}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: currentFileIndex > 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
                        border: "none", borderRadius: "999px", padding: "8px 18px",
                        color: currentFileIndex > 0 ? "#fff" : "rgba(255,255,255,0.25)",
                        cursor: currentFileIndex > 0 ? "pointer" : "default",
                        fontSize: "13px", fontWeight: 600,
                      }}
                    >
                      <ChevronLeft size={15} strokeWidth={2.5} />
                      {lang === "zh" ? "上一张" : "Prev"}
                    </motion.button>

                    {/* Dot indicators */}
                    <div className="flex gap-1.5">
                      {files.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentFileIndex(i)}
                          style={{
                            width: i === currentFileIndex ? "18px" : "7px",
                            height: "7px", borderRadius: "999px", border: "none", cursor: "pointer",
                            background: i === currentFileIndex ? "#fff" : "rgba(255,255,255,0.3)",
                            transition: "all 0.25s ease",
                            padding: 0,
                          }}
                        />
                      ))}
                    </div>

                    <motion.button
                      whileHover={{ scale: currentFileIndex < files.length - 1 ? 1.08 : 1 }}
                      whileTap={{ scale: 0.92 }}
                      onClick={() => setCurrentFileIndex(Math.min(files.length - 1, currentFileIndex + 1))}
                      disabled={currentFileIndex === files.length - 1}
                      style={{
                        display: "flex", alignItems: "center", gap: "6px",
                        background: currentFileIndex < files.length - 1 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
                        border: "none", borderRadius: "999px", padding: "8px 18px",
                        color: currentFileIndex < files.length - 1 ? "#fff" : "rgba(255,255,255,0.25)",
                        cursor: currentFileIndex < files.length - 1 ? "pointer" : "default",
                        fontSize: "13px", fontWeight: 600,
                      }}
                    >
                      {lang === "zh" ? "下一张" : "Next"}
                      <ChevronRight size={15} strokeWidth={2.5} />
                    </motion.button>
                  </div>
                )}
              </div>
            );
          })() : (
            /* ── No file attached ── */
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <FileText size={36} strokeWidth={1.2} style={{ color: "rgba(255,255,255,0.25)" }} />
              <p style={{ color: "rgba(255,255,255,0.4)", fontSize: "14px", textAlign: "center" }}>
                {lang === "zh" ? "该项目未附加原始图解文件" : "No original file attached to this project"}
              </p>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
