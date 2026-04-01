"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Circle, CheckCircle2, Printer, RotateCcw, Edit3, Check, Trash2, Plus, X, Search,
} from "lucide-react";
import { dict, renderStepText, getAvailableSizes, CARD_STYLE, RADIUS, type Lang, type Step } from "../lib/types";

// ─── Repeat-counter helpers ───────────────────────────────────────────────────

// Counter rule: only show a sub-row counter when the step describes REPEATED ROWS,
// never for stitch-level repetition within a single row.
const REPEAT_RE = /\brows?\s+\d+[-–]\d+\b|\d+[-–]\d+\s*行|(?<!第)\d{2,}\s*行|\d+\s+rows?\b/i;

function isRepeatableStep(step: Step): boolean {
  return (!!step.count && step.count > 1) || REPEAT_RE.test(step.text);
}

function parseMaxCount(step: Step): number | null {
  if (step.count && step.count > 1) return step.count;
  const t = step.text;

  // Chinese "X-Y行" range → Y - X + 1
  // BUT if preceded by an approximation word (约/大约) return null → uncapped counter
  let m = t.match(/(\d+)[-–](\d+)\s*行/);
  if (m) {
    const isApprox = /(?:约|大约|approximately|around|~)\s*\d+[-–]/.test(t);
    return isApprox ? null : parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
  }

  // English "rows X-Y" range → Y - X + 1
  m = t.match(/\brows?\s+(\d+)[-–](\d+)\b/i);
  if (m) return parseInt(m[2], 10) - parseInt(m[1], 10) + 1;

  // "N rows" in English (e.g. "For the next 10 rows")
  // Note: "N times" is intentionally removed — it refers to stitch-level repetition
  m = t.match(/\b(\d+)\s+rows?\b/i);
  if (m) return parseInt(m[1], 10);

  // Chinese "N行" (e.g. "接下来的20行") — exclude row labels like "第N行"
  const allRowNums = [...t.matchAll(/(?<!第)(\d+)\s*行/g)];
  if (allRowNums.length > 0) return parseInt(allRowNums[allRowNums.length - 1][1], 10);

  return null;
}

// ─── LoadingSkeleton ──────────────────────────────────────────────────────────

export function LoadingSkeleton() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.3 }}
      className="no-print w-full max-w-xl p-8"
      style={{
        background:   "var(--bg-card)",
        border:       "1.5px solid var(--border)",
        boxShadow:    "0 10px 40px -15px rgba(0,0,0,0.05)",
        borderRadius: "2rem",
      }}
    >
      <div className="flex flex-col items-center gap-5 py-6">

        {/* Animated progress dots */}
        <div className="flex items-end gap-1.5">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <motion.span
              key={i}
              animate={{ scaleY: [0.4, 1, 0.4], opacity: [0.35, 1, 0.35] }}
              transition={{
                repeat:   Infinity,
                duration: 1.1,
                delay:    i * 0.11,
                ease:     "easeInOut",
              }}
              style={{
                display:      "inline-block",
                width:        "6px",
                height:       i % 2 === 0 ? "18px" : "12px",
                borderRadius: "9999px",
                background:   i % 3 === 2
                  ? "var(--morandi-pink)"
                  : "var(--morandi-green)",
                transformOrigin: "bottom",
              }}
            />
          ))}
        </div>

        {/* Skeleton rows */}
        <div className="w-full flex flex-col gap-3 mt-1">
          {[100, 82, 92, 68].map((w, i) => (
            <motion.div
              key={i}
              animate={{ opacity: [0.3, 0.65, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.18, ease: "easeInOut" }}
              className="h-11 rounded-2xl"
              style={{ width: `${w}%`, background: "var(--border)" }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─── SizePicker ───────────────────────────────────────────────────────────────

function SizePicker({
  sizes,
  selected,
  lang,
  onChange,
}: {
  sizes: string[];
  selected: string;
  lang: Lang;
  onChange: (size: string) => void;
}) {
  if (sizes.length === 0) return null;
  const allLabel = lang === "zh" ? "全部" : "All";
  return (
    <div
      className="no-print flex items-center gap-2 mb-4 overflow-x-auto"
      style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as React.CSSProperties}
    >
      {(["all", ...sizes] as string[]).map((size) => {
        const active = selected === size;
        return (
          <motion.button
            key={size}
            onClick={() => onChange(size)}
            whileTap={{ scale: 0.92 }}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{
              background:   active ? "var(--morandi-pink)" : "var(--bg)",
              color:        active ? "#fff" : "var(--text-muted)",
              border:       active ? "1px solid var(--morandi-pink)" : "1px solid var(--border)",
              cursor:       "pointer",
              transition:   "background 0.2s, color 0.2s, border-color 0.2s",
              minHeight:    "32px",
              whiteSpace:   "nowrap",
            }}
          >
            {size === "all" ? allLabel : size}
          </motion.button>
        );
      })}
    </div>
  );
}

// ─── StepInsertDividerLi ─────────────────────────────────────────────────────

export function StepInsertDividerLi({ onAdd }: { onAdd: () => void }) {
  return (
    <motion.li
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{ opacity: 0, scaleY: 0 }}
      transition={{ duration: 0.18 }}
      className="no-print list-none flex items-center gap-2 cursor-pointer"
      style={{ transformOrigin: "center", padding: "2px 4px" }}
      onClick={onAdd}
    >
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
      <motion.span
        whileHover={{ scale: 1.2 }}
        className="flex items-center justify-center w-5 h-5 rounded-full"
        style={{
          background:  "var(--bg-card)",
          border:      "1.5px dashed var(--morandi-sage)",
          color:       "var(--morandi-sage)",
          flexShrink:  0,
        }}
      >
        <Plus size={10} strokeWidth={2.5} />
      </motion.span>
      <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
    </motion.li>
  );
}

// ─── StepItem ────────────────────────────────────────────────────────────────

export function StepItem({
  step,
  index,
  lang = "en",
  onToggle,
  onActivate,
  onLocate,
  onStartEdit,
  onSubCountChange,
  onTextEdit,
  isEditMode = false,
  onDelete,
  selectedSize = "all",
  highlighted = false,
  isActive = false,
}: {
  step: Step;
  index: number;
  lang?: "zh" | "en";
  onToggle: () => void;
  onActivate?: () => void;
  onLocate?: () => void;
  onStartEdit?: () => void;
  onSubCountChange: (delta: number) => void;
  onTextEdit: (newText: string) => void;
  isEditMode?: boolean;
  onDelete?: () => void;
  selectedSize?: string;
  highlighted?: boolean;
  isActive?: boolean;
}) {
  const [editing, setEditing]   = useState(false);
  const [editText, setEditText] = useState(step.text);
  const inputRef                = useRef<HTMLInputElement>(null);

  const repeatable = isRepeatableStep(step);
  const max        = repeatable ? parseMaxCount(step) : null;
  const subCurrent = step.subCount ?? 0;
  const atMax      = max !== null && subCurrent >= max;

  // Keep draft in sync when step is updated externally (e.g. new conversion)
  useEffect(() => {
    if (!editing) setEditText(step.text);
  }, [step.text, editing]);

  function startEdit() {
    if (step.checked || isEditMode) return;
    onStartEdit?.();           // dismiss the context menu in the parent
    setEditText(step.text);
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function commitEdit() {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== step.text) onTextEdit(trimmed);
    setEditing(false);
  }

  // Header rows: no checkbox, distinct background, non-interactive
  if (step.isHeader) {
    return (
      <motion.li
        id={`step-${step.id}`}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: index * 0.06 }}
        className="flex items-center gap-2 px-4 py-2 select-none"
        style={{
          background:   "var(--morandi-sage)",
          borderRadius: "1.25rem",
          boxShadow:    "0 2px 10px -4px rgba(163,177,138,0.35)",
        }}
      >
        <span className="text-lg">🧶</span>
        <span className="flex-1 text-sm font-bold leading-snug" style={{ color: "#fff" }}>
          {step.text}
        </span>
        <AnimatePresence>
          {isEditMode && (
            <motion.button
              key="hdr-delete-btn"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="no-print shrink-0 flex items-center justify-center w-7 h-7 rounded-full"
              style={{
                background: "rgba(255,255,255,0.18)",
                border:     "1px solid rgba(255,255,255,0.45)",
                color:      "#fff",
                cursor:     "pointer",
              }}
              aria-label="Delete step"
            >
              <Trash2 size={13} strokeWidth={2} />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.li>
    );
  }

  return (
    <motion.li
      id={`step-${step.id}`}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: step.checked ? 0.65 : 1, x: 0 }}
      transition={{
        opacity: { duration: 0.25, delay: index * 0.06 },
        x: { type: "spring", stiffness: 340, damping: 26, delay: index * 0.06 },
      }}
      whileHover={(editing || isEditMode) ? undefined : { y: -1 }}
      whileTap={(editing || isEditMode) ? undefined : { scale: 0.985 }}
      onClick={(editing || isEditMode) ? undefined : () => onActivate?.()}
      className={`print-step flex items-start gap-3 px-4 py-2.5 select-none ${isEditMode ? "cursor-default" : "cursor-pointer"}`}
      data-checked={step.checked}
      data-step-menu={step.id}
      style={{
        position:     "relative",
        background:   editing
          ? "rgba(239,246,255,0.7)"
          : step.checked ? "var(--bg)" : "var(--bg-card)",
        border: editing
          ? "1.5px solid #bfdbfe"
          : isActive && !step.checked
            ? "1.5px solid rgba(100,150,115,0.70)"
            : `1.5px solid ${step.checked ? "var(--border)" : "var(--morandi-stone)"}`,
        borderRadius: "1.25rem",
        boxShadow:    editing || step.checked
          ? "none"
          : isActive
            ? "0 0 0 3px rgba(100,150,115,0.15), 0 3px 12px -6px rgba(0,0,0,0.08)"
            : "0 3px 12px -6px rgba(0,0,0,0.08)",
        transition:   "background 0.2s, border-color 0.2s, box-shadow 0.2s",
        overflow:     "visible",
        zIndex:       isActive ? 20 : undefined,
      }}
    >
      {/* Highlight flash overlay */}
      <AnimatePresence>
        {highlighted && (
          <motion.div
            key="highlight-flash"
            initial={{ opacity: 0.45 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
            style={{
              position: "absolute", inset: 0,
              background: "var(--morandi-green)",
              borderRadius: "1.25rem",
              pointerEvents: "none",
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Context action menu ── */}
      <AnimatePresence>
        {isActive && !editing && !isEditMode && (
          <motion.div
            key="step-ctx-menu"
            initial={{ opacity: 0, scale: 0.88, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: -4 }}
            transition={{ type: "spring", stiffness: 420, damping: 26 }}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              position:     "absolute",
              top:          "calc(100% + 7px)",
              right:        "0",
              zIndex:       30,
              display:      "flex",
              alignItems:   "center",
              gap:          "4px",
              background:   "rgba(255,255,255,0.97)",
              backdropFilter: "blur(14px)",
              border:       "1px solid rgba(190,205,195,0.55)",
              borderRadius: "999px",
              padding:      "5px 8px",
              boxShadow:    "0 6px 24px -6px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.06)",
              pointerEvents:"auto",
            }}
          >
            {/* Edit */}
            <motion.button
              whileHover={{ scale: 1.12, background: "rgba(239,246,255,0.9)" }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); startEdit(); }}
              disabled={step.checked}
              title={step.checked ? undefined : (lang === "zh" ? "编辑步骤" : "Edit step")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "30px", height: "30px", borderRadius: "999px",
                background: "transparent", border: "none",
                color: step.checked ? "var(--border)" : "var(--morandi-sage)",
                cursor: step.checked ? "default" : "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              <Edit3 size={14} strokeWidth={2} />
            </motion.button>

            {/* Divider */}
            <div style={{ width: "1px", height: "18px", background: "rgba(180,195,185,0.5)", flexShrink: 0 }} />

            {/* Locate in pattern */}
            <motion.button
              whileHover={{ scale: 1.12, background: "rgba(235,248,238,0.9)" }}
              whileTap={{ scale: 0.9 }}
              onClick={(e) => { e.stopPropagation(); onLocate?.(); }}
              title={step.sourceBox
                ? (lang === "zh" ? "在图解中找到此步骤" : "Find in original pattern")
                : (lang === "zh" ? "查看原图" : "Open pattern")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: "30px", height: "30px", borderRadius: "999px",
                background: "transparent", border: "none",
                color: step.sourceBox ? "rgba(80,145,100,0.9)" : "var(--text-muted)",
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s",
              }}
            >
              <Search size={14} strokeWidth={2} />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Checkbox icon */}
      <motion.span
        animate={step.checked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.28 }}
        className="shrink-0 mt-[3px]"
        onClick={(e) => { e.stopPropagation(); if (!isEditMode) onToggle(); }}
      >
        {step.checked ? (
          <CheckCircle2 size={22} strokeWidth={1.8} style={{ color: "var(--morandi-green)" }} />
        ) : (
          <Circle size={22} strokeWidth={1.8} style={{ color: "var(--morandi-stone)" }} />
        )}
      </motion.span>

      {/* Text + counter wrapper: row on wide screens, column on mobile */}
      <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">

          {/* ── Edit input / display text ── */}
          {editing ? (
            <input
              ref={inputRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onBlur={commitEdit}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter")  { e.preventDefault(); commitEdit(); }
                if (e.key === "Escape") { setEditing(false); }
              }}
              className="w-full text-base font-medium"
              style={{
                background:   "transparent",
                border:       "1px solid #bfdbfe",
                borderRadius: "0.5rem",
                padding:      "1px 6px",
                outline:      "none",
                color:        "var(--text-main)",
                fontFamily:   "var(--font-body)",
                fontSize:     "1rem",
                lineHeight:   "1.625",
              }}
            />
          ) : (
            <span
              className="print-step-text text-base font-medium leading-relaxed"
              style={{
                color:          step.checked ? "var(--text-muted)" : "var(--text-main)",
                textDecoration: step.checked ? "line-through" : "none",
                transition:     "color 0.2s",
                display:        "block",
              }}
            >
              {renderStepText(step, selectedSize)}
            </span>
          )}

          {/* Original text (translation) */}
          {!editing && step.original && (
            <p
              className="print-step-text-muted mt-0.5 text-xs leading-snug"
              style={{
                color:          "var(--text-muted)",
                opacity:        step.checked ? 0.5 : 0.7,
                textDecoration: step.checked ? "line-through" : "none",
                transition:     "color 0.2s, opacity 0.2s",
              }}
            >
              {step.original}
            </p>
          )}

          {/* Count badge */}
          {!editing && step.count && step.count > 1 && (
            <span
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                background: "var(--morandi-pink)",
                color:      "#fff",
                opacity:    step.checked ? 0.5 : 0.9,
              }}
            >
              ×{step.count} rows
            </span>
          )}
        </div>

        {/* Sub-row counter — below text on mobile, right side on wider screens */}
        {repeatable && (
          <div
            className="no-print shrink-0 self-start sm:self-auto flex items-center gap-1.5 rounded-2xl px-2.5 py-1"
            style={{
              background: atMax ? "var(--morandi-green)" : "var(--bg-card)",
              border:     `2px solid ${atMax ? "var(--morandi-green)" : "var(--morandi-stone)"}`,
              boxShadow:  "0 2px 8px -3px rgba(0,0,0,0.10)",
              transition: "background 0.3s, border-color 0.3s",
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onSubCountChange(-1); }}
              disabled={subCurrent <= 0}
              className="w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold"
              style={{
                color:      subCurrent <= 0 ? "var(--border)" : "var(--text-muted)",
                background: subCurrent <= 0 ? "transparent" : "var(--bg)",
                border:     "none",
                cursor:     subCurrent <= 0 ? "default" : "pointer",
                boxShadow:  subCurrent <= 0 ? "none" : "0 1px 4px -1px rgba(0,0,0,0.12)",
                padding:    0,
                lineHeight: 0,
              }}
            >
              −
            </button>
            <span
              className="text-sm font-bold min-w-[3rem] text-center tabular-nums"
              style={{ color: atMax ? "#fff" : "var(--text-main)" }}
            >
              {subCurrent}{max !== null ? `/${max}` : ""}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onSubCountChange(+1); }}
              disabled={atMax}
              className="w-6 h-6 flex items-center justify-center rounded-full text-sm font-bold"
              style={{
                color:      atMax ? "rgba(255,255,255,0.45)" : "#fff",
                background: "var(--morandi-pink)",
                border:     "none",
                cursor:     atMax ? "default" : "pointer",
                boxShadow:  atMax ? "none" : "0 1px 4px -1px rgba(0,0,0,0.18)",
                padding:    0,
                lineHeight: 0,
              }}
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* Delete button — visible only in edit mode */}
      <AnimatePresence>
        {isEditMode && (
          <motion.button
            key="delete-btn"
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => { e.stopPropagation(); onDelete?.(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="no-print shrink-0 self-center flex items-center justify-center w-7 h-7 rounded-full"
            style={{
              background: "transparent",
              border:     "1px solid var(--morandi-blush)",
              color:      "var(--morandi-blush)",
              cursor:     "pointer",
            }}
            aria-label="Delete step"
          >
            <Trash2 size={13} strokeWidth={2} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

// ─── ChecklistView props ──────────────────────────────────────────────────────

export interface ChecklistViewProps {
  lang: Lang;
  t: typeof dict[Lang];
  steps: Step[];
  hasConverted: boolean;
  isLoading: boolean;
  selectedSize: string;
  isEditMode: boolean;
  tipVisible: boolean;
  checklistTopRef: React.RefObject<HTMLDivElement | null>;
  dragIndex: number | null;
  dragOverIndex: number | null;
  activeMenuStepId: number | null;
  currentProjectFiles: { url: string; mimeType: string }[];
  onToggleStep: (id: number) => void;
  onUpdateSubCount: (id: number, delta: number) => void;
  onTextEdit: (id: number, newText: string) => void;
  onAddStep: (insertAt: number) => void;
  onDeleteStep: (id: number) => void;
  onReset: () => void;
  onDismissTip: () => void;
  onScrollToTop: () => void;
  onScrollToFirstUnchecked: () => void;
  setSelectedSize: (s: string) => void;
  setIsEditMode: (v: boolean) => void;
  setTipVisible: (v: boolean) => void;
  setDragIndex: (i: number | null) => void;
  setDragOverIndex: (i: number | null) => void;
  setActiveMenuStepId: (id: number | null) => void;
  setShowReferencePanel: (v: boolean) => void;
  setHighlightedStepId: (id: number | null) => void;
  setCurrentFileIndex: (i: number) => void;
  onPrint: () => void;
  highlightedStepId: number | null;
}

// ─── ChecklistView ────────────────────────────────────────────────────────────

export default function ChecklistView({
  lang,
  t,
  steps,
  hasConverted,
  isLoading,
  selectedSize,
  isEditMode,
  tipVisible,
  checklistTopRef,
  dragIndex,
  dragOverIndex,
  activeMenuStepId,
  currentProjectFiles,
  onToggleStep,
  onUpdateSubCount,
  onTextEdit,
  onAddStep,
  onDeleteStep,
  onReset,
  onDismissTip,
  onScrollToTop,
  onScrollToFirstUnchecked,
  setSelectedSize,
  setIsEditMode,
  setTipVisible,
  setDragIndex,
  setDragOverIndex,
  setActiveMenuStepId,
  setShowReferencePanel,
  setHighlightedStepId,
  setCurrentFileIndex,
  onPrint,
  highlightedStepId,
}: ChecklistViewProps) {
  const checkableSteps = steps.filter((s) => !s.isHeader);
  const doneCount      = checkableSteps.filter((s) => s.checked).length;
  const totalCount     = checkableSteps.length;
  const allDone        = totalCount > 0 && doneCount === totalCount;

  return (
    <>
      {/* ── Loading skeleton ── */}
      <AnimatePresence>
        {isLoading && <LoadingSkeleton key="skeleton" />}
      </AnimatePresence>

      {/* ── Checklist top anchor (floating nav "list top" target) ── */}
      <div ref={checklistTopRef} />

      {/* ── Results Card ── */}
      <AnimatePresence>
        {hasConverted && !isLoading && (
          <motion.div
            key="results"
            layout="position"
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="print-results-card w-full max-w-xl p-8"
            style={{ ...CARD_STYLE, borderRadius: RADIUS }}
          >
            {/* ── Header: title row + progress bar, flex-col on mobile ── */}
            <div className="mb-5 flex flex-col gap-3">

              {/* Title + button group — always a single horizontal row */}
              <div className="flex items-center justify-between">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={lang + "-title"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="print-section-title text-sm font-semibold uppercase tracking-widest"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t.checklistTitle}
                  </motion.span>
                </AnimatePresence>

                {/* Button group + count badge (whole group hidden in print) */}
                <div className="no-print flex items-center gap-2">
                  {/* Print — icon always, label hidden on xs */}
                  <button
                    onClick={onPrint}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full"
                    style={{
                      background: "var(--bg)",
                      color:      "var(--text-muted)",
                      border:     "1px solid var(--border)",
                      cursor:     "pointer",
                    }}
                  >
                    <Printer size={13} strokeWidth={2} />
                    <span className="hidden sm:inline">{t.printBtn}</span>
                  </button>

                  {/* Edit / Done — toggle edit mode */}
                  <button
                    onClick={() => setIsEditMode(!isEditMode)}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full"
                    style={{
                      background: isEditMode ? "var(--bg-card)" : "var(--bg)",
                      color:      isEditMode ? "var(--morandi-pink)" : "var(--text-muted)",
                      border:     isEditMode ? "1px solid var(--morandi-pink)" : "1px solid var(--border)",
                      cursor:     "pointer",
                    }}
                  >
                    {isEditMode
                      ? <Check size={13} strokeWidth={2.5} />
                      : <Edit3 size={13} strokeWidth={2} />}
                    <span className="hidden sm:inline">
                      {isEditMode ? t.editModeDone : t.editMode}
                    </span>
                  </button>

                  {/* Reset — icon always, label hidden on xs (next to count badge) */}
                  <button
                    onClick={onReset}
                    className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full"
                    style={{
                      background: "var(--bg)",
                      color:      "var(--morandi-stone)",
                      border:     "1px solid var(--border)",
                      cursor:     "pointer",
                    }}
                  >
                    <RotateCcw size={13} strokeWidth={2} />
                    <span className="hidden sm:inline">{t.resetBtn}</span>
                  </button>

                  {totalCount > 0 && (
                    <span
                      className="print-count-badge text-sm font-medium px-3 py-1 rounded-full"
                      style={{
                        background: "var(--bg)",
                        color:      "var(--text-muted)",
                        border:     "1px solid var(--border)",
                      }}
                    >
                      {doneCount} / {totalCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar — full-width on all screens */}
              {totalCount > 0 && (
                <div
                  className="no-print w-full h-2 rounded-full overflow-hidden"
                  style={{ background: "var(--border)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--morandi-green)" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
              )}
            </div>

            {totalCount === 0 ? (
              <AnimatePresence mode="wait">
                <motion.p
                  key={lang + "-nomatch"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="text-sm text-center py-10"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.noMatch}
                  <br />
                  {t.noMatchSub}
                </motion.p>
              </AnimatePresence>
            ) : (
              <>
                {/* ── Size Picker — only shown when pattern has multi-size data ── */}
                <SizePicker
                  sizes={getAvailableSizes(steps)}
                  selected={selectedSize}
                  lang={lang}
                  onChange={setSelectedSize}
                />

                {/* ── Edit tip ── */}
                <AnimatePresence>
                  {tipVisible && (
                    <motion.div
                      key="edit-tip"
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25 }}
                      className="no-print flex items-center justify-between mb-4 px-3 py-2 rounded-xl text-xs font-medium"
                      style={{ background: "#eff6ff", color: "#60a5fa" }}
                    >
                      <span>✏️ {t.editTip}</span>
                      <button
                        onClick={onDismissTip}
                        style={{ background: "none", border: "none", cursor: "pointer",
                                 color: "#93c5fd", lineHeight: 0, padding: "2px" }}
                      >
                        <X size={13} strokeWidth={2} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>

                <ul className="flex flex-col gap-2">
                  <AnimatePresence>
                    {isEditMode && (
                      <StepInsertDividerLi key="ins-before-0" onAdd={() => onAddStep(0)} />
                    )}
                  </AnimatePresence>
                  {steps.flatMap((step, i) => [
                    <StepItem
                      key={step.id}
                      step={step}
                      index={i}
                      isEditMode={isEditMode}
                      selectedSize={selectedSize}
                      highlighted={highlightedStepId === step.id}
                      isActive={activeMenuStepId === step.id}
                      lang={lang}
                      onToggle={() => onToggleStep(step.id)}
                      onActivate={() => setActiveMenuStepId(activeMenuStepId === step.id ? null : step.id)}
                      onLocate={() => {
                        const idx     = step.sourceFileIndex ?? 0;
                        const safeIdx = idx < currentProjectFiles.length ? idx : 0;
                        const target  = currentProjectFiles[safeIdx];
                        setActiveMenuStepId(null);
                        if (target?.mimeType === "application/pdf") {
                          // Open the correct page in the browser's native PDF viewer.
                          // #page= is honoured by Chrome/Firefox/Edge desktop viewers.
                          window.open(`${target.url}#page=${safeIdx + 1}`, "_blank", "noopener,noreferrer");
                        } else {
                          setCurrentFileIndex(safeIdx);
                          setHighlightedStepId(step.id);
                          setShowReferencePanel(true);
                        }
                      }}
                      onStartEdit={() => setActiveMenuStepId(null)}
                      onSubCountChange={(delta) => onUpdateSubCount(step.id, delta)}
                      onTextEdit={(text) => onTextEdit(step.id, text)}
                      onDelete={() => onDeleteStep(step.id)}
                    />,
                    <AnimatePresence key={`ap-ins-${step.id}`}>
                      {isEditMode && (
                        <StepInsertDividerLi key={`ins-after-${step.id}`} onAdd={() => onAddStep(i + 1)} />
                      )}
                    </AnimatePresence>,
                  ])}
                </ul>

                <AnimatePresence>
                  {allDone && (
                    <motion.p
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="mt-7 text-center text-sm font-semibold"
                      style={{ color: "var(--morandi-green)" }}
                    >
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={lang + "-done"}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          {t.allDone}
                        </motion.span>
                      </AnimatePresence>
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* ── Print-only footer ── */}
                <div className="print-footer">
                  <span>{t.printFooter}</span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
