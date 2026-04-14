"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Folder, X, Edit3, FileText, Trash2 } from "lucide-react";
import { db, type StoredFile } from "../lib/db";
import { dict, isStoredFile, type Lang, type Project } from "../lib/types";

// ─── ProjectGallery (formerly ProjectsModal) ─────────────────────────────────

// Morandi fallback palette for projects without an image cover
const CARD_PALETTES = [
  { bg: "#e8e0d8", icon: "#a89880" },
  { bg: "#dde3dc", icon: "#7a9478" },
  { bg: "#e2d9e0", icon: "#9c7f9a" },
  { bg: "#d9e0e3", icon: "#7a909c" },
  { bg: "#e3ddd4", icon: "#9c8c74" },
];

export interface ProjectGalleryProps {
  projects: Project[];
  lang: Lang;
  currentProjectId: string | null;
  onClose: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export default function ProjectGallery({
  projects,
  lang,
  currentProjectId,
  onClose,
  onLoad,
  onDelete,
  onRename,
}: ProjectGalleryProps) {
  const t = dict[lang];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<string, { url: string; isPdf: boolean }>>({});

  // Generate thumbnail URLs for each project — prefer images, fall back to PDF
  useEffect(() => {
    const blobUrls: string[] = [];
    const urls: Record<string, { url: string; isPdf: boolean }> = {};
    for (const proj of projects) {
      const files: (StoredFile | Blob | File)[] = [
        ...(proj.originalFiles ?? []),
        ...(proj.originalFile ? [proj.originalFile] : []),
      ] as (StoredFile | Blob | File)[];
      // Prefer image; fall back to first PDF
      const firstImage = files.find((f) =>
        isStoredFile(f) ? f.mimeType.startsWith("image/") : (f as Blob).type.startsWith("image/")
      );
      const firstPdf = !firstImage && files.find((f) =>
        isStoredFile(f) ? f.mimeType === "application/pdf" : (f as Blob).type === "application/pdf"
      );
      const picked = firstImage ?? firstPdf;
      if (!picked) continue;
      const isPdf = !firstImage;
      if (isStoredFile(picked)) {
        if (isPdf) {
          // Chrome/Edge block data: URLs in iframes — convert to blob URL
          const bytes = atob(picked.data);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          const blob = new Blob([arr], { type: picked.mimeType });
          const url = URL.createObjectURL(blob);
          blobUrls.push(url);
          urls[proj.id] = { url, isPdf: true };
        } else {
          urls[proj.id] = { url: `data:${picked.mimeType};base64,${picked.data}`, isPdf: false };
        }
      } else {
        const url = URL.createObjectURL(picked as Blob);
        blobUrls.push(url);
        urls[proj.id] = { url, isPdf };
      }
    }
    setPreviewUrls(urls);
    return () => blobUrls.forEach(URL.revokeObjectURL);
  }, [projects]);

  function startRename(id: string, currentName: string) {
    setEditingId(id);
    setEditingName(currentName);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
  }

  return (
    <motion.div
      key="projects-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.32)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 20 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
        className="w-full max-w-lg flex flex-col gap-4"
        style={{
          background:   "var(--bg-card)",
          border:       "1.5px solid var(--border)",
          boxShadow:    "0 20px 60px -15px rgba(0,0,0,0.25)",
          borderRadius: "2rem",
          padding:      "1.5rem",
          maxHeight:    "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between flex-shrink-0">
          <h2 className="flex items-center gap-2 text-base font-bold" style={{ color: "var(--text-main)" }}>
            <Folder size={16} strokeWidth={2} style={{ color: "var(--morandi-green)", flexShrink: 0 }} />
            {t.myProjects}
          </h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", lineHeight: 0, padding: "2px" }}
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Project grid */}
        <div className="overflow-y-auto" style={{ flex: 1 }}>
          {projects.length === 0 ? (
            <p className="text-center text-sm py-10" style={{ color: "var(--text-muted)" }}>
              🧶 {t.noProjects}
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", paddingTop: "6px" }}>
              {projects.map((project, idx) => {
                const isActive   = project.id === currentProjectId;
                const isTracker  = project.type === "tracker";
                const isCrochet  = project.type === "crochet";
                // Tracker: row progress; crochet: row/round progress; others: checklist steps
                const checkable  = project.steps.filter((s) => !s.isHeader);
                const done       = isCrochet  ? (project.crochetData?.currentRow ?? 1) - 1
                                 : isTracker  ? (project.trackerData?.currentRow  ?? 1) - 1
                                 : checkable.filter((s) => s.checked).length;
                const total      = isCrochet  ? (project.crochetData?.totalRows   ?? 0)
                                 : isTracker  ? (project.trackerData?.rows         ?? 1)
                                 : checkable.length;
                const pct       = total > 0 ? Math.round((done / total) * 100) : 0;
                const date      = new Date(project.lastUpdated).toLocaleDateString(
                  lang === "zh" ? "zh-CN" : "en-US",
                  { month: "short", day: "numeric" }
                );
                const palette   = CARD_PALETTES[idx % CARD_PALETTES.length];
                const cover     = previewUrls[project.id];

                return (
                  <motion.div
                    key={project.id}
                    whileHover={{ y: -3, boxShadow: "0 8px 24px -8px rgba(0,0,0,0.18)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    style={{
                      borderRadius: "1.25rem",
                      border: `1.5px solid ${isActive ? "var(--morandi-pink)" : "var(--border)"}`,
                      background: "var(--bg)",
                      overflow: "hidden",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                    }}
                    onClick={() => onLoad(project.id)}
                  >
                    {/* Cover */}
                    <div style={{
                      width: "100%", aspectRatio: "4/3",
                      background: cover ? "#e8e4de" : palette.bg,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      overflow: "hidden", flexShrink: 0, position: "relative",
                    }}>
                      {cover?.isPdf ? (
                        /* width: 300% scaled back by 0.333 = 100% of container width;
                           height: 400% scaled back = container width > container height → crops top portion */
                        <iframe
                          src={cover.url + "#toolbar=0&navpanes=0&scrollbar=0"}
                          title="pdf-preview"
                          style={{
                            width: "300%", height: "400%",
                            transform: "scale(0.333)", transformOrigin: "top left",
                            border: "none", pointerEvents: "none", position: "absolute",
                            top: 0, left: 0,
                          }}
                        />
                      ) : cover ? (
                        <img src={cover.url} alt={project.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <FileText size={32} strokeWidth={1.4} style={{ color: palette.icon }} />
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding: "10px 12px 10px", flex: 1, display: "flex", flexDirection: "column", gap: "4px" }}>
                      {/* Name row */}
                      <div className="flex items-center justify-between gap-1">
                        {editingId === project.id ? (
                          <input
                            ref={nameInputRef}
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={commitRename}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
                              if (e.key === "Escape") { setEditingId(null); }
                            }}
                            className="flex-1 text-sm font-bold"
                            style={{
                              background: "transparent", border: "1px solid var(--morandi-pink)",
                              borderRadius: "0.3rem", padding: "1px 4px", outline: "none",
                              color: "var(--text-main)",
                            }}
                          />
                        ) : (
                          <span
                            className="flex-1 text-sm font-bold truncate"
                            style={{ color: "var(--text-main)" }}
                            title={project.name}
                          >
                            {project.name}
                          </span>
                        )}
                        {/* Rename button */}
                        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => startRename(project.id, project.name)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "3px", lineHeight: 0 }}
                            title={lang === "zh" ? "重命名" : "Rename"}
                          >
                            <Edit3 size={14} strokeWidth={2} style={{ color: "var(--text-muted)" }} />
                          </button>
                        </div>
                      </div>

                      {/* Date & progress */}
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>{date}</p>

                      {/* Progress bar */}
                      {total > 0 && (
                        <div style={{ marginTop: "4px" }}>
                          <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
                            {isCrochet
                              ? project.crochetData?.mode === "circular"
                                ? (lang === "zh" ? `第 ${done + 1} 圈 / 共 ${total} 圈` : `Round ${done + 1} / ${total}`)
                                : (lang === "zh" ? `第 ${done + 1} 行 / 共 ${total} 行` : `Row ${done + 1} / ${total}`)
                              : isTracker
                              ? (lang === "zh" ? `第 ${done + 1} 行 / 共 ${total} 行` : `Row ${done + 1} / ${total}`)
                              : `${lang === "zh" ? "进度" : "Progress"} ${done}/${total}`}
                          </p>
                          <div style={{
                            width: "100%", height: "4px", borderRadius: "99px",
                            background: "var(--border)", overflow: "hidden",
                          }}>
                            <div style={{
                              width: `${pct}%`, height: "100%", borderRadius: "99px",
                              background: "var(--morandi-green)",
                              transition: "width 0.4s ease",
                            }} />
                          </div>
                        </div>
                      )}

                      {/* Active / type badge + delete */}
                      <div className="flex items-center justify-between" style={{ marginTop: "4px" }}>
                        {isActive ? (
                          <span style={{
                            fontSize: "10px", fontWeight: 700, letterSpacing: "0.03em",
                            color: "var(--morandi-pink)", background: "rgba(200,160,160,0.12)",
                            borderRadius: "99px", padding: "1px 7px",
                          }}>
                            {lang === "zh" ? "当前" : "Active"}
                          </span>
                        ) : isCrochet ? (
                          <span style={{
                            fontSize: "10px", fontWeight: 700, letterSpacing: "0.03em",
                            color: "var(--morandi-green)", background: "rgba(143,175,150,0.14)",
                            borderRadius: "99px", padding: "1px 7px",
                          }}>
                            {project.crochetData?.mode === "circular"
                              ? (lang === "zh" ? "圈织" : "Circular")
                              : (lang === "zh" ? "片织" : "Flat")}
                          </span>
                        ) : isTracker ? (
                          <span style={{
                            fontSize: "10px", fontWeight: 700, letterSpacing: "0.03em",
                            color: "var(--morandi-green)", background: "rgba(143,175,150,0.14)",
                            borderRadius: "99px", padding: "1px 7px",
                          }}>
                            {lang === "zh" ? "行追踪" : "Tracker"}
                          </span>
                        ) : <span />}
                        <div onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onDelete(project.id)}
                            style={{
                              background: "none", border: "1px solid var(--border)", cursor: "pointer",
                              padding: "3px 7px", lineHeight: 0, borderRadius: "0.5rem",
                              display: "flex", alignItems: "center", gap: "3px",
                            }}
                            aria-label="Delete"
                          >
                            <Trash2 size={11} strokeWidth={2} style={{ color: "var(--text-muted)" }} />
                            <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                              {lang === "zh" ? "删除" : "Delete"}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
