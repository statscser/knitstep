"use client";

import { useState, useEffect, useRef } from "react";
import type { CropRect } from "./GridCalibrator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RowTrackerState {
  imageSrc: string;
  rect: CropRect;
  rows: number;
  stitches: number;
}

interface RowTrackerProps extends RowTrackerState {
  onReset: () => void;
}

interface PatternMeta {
  legend: Record<string, string>;
  colors: Record<string, string>;
  analysisReport: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "knitstep_tracker";
const C_GREEN     = "#8FAF96";
const C_MUTED     = "#9C8C7C";
const C_TEXT      = "#3D3530";
const C_BORDER    = "#E0D4CA";

// ─── Component ────────────────────────────────────────────────────────────────

export default function RowTracker({ imageSrc, rect, rows, stitches, onReset }: RowTrackerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Row 1 is always the starting row (bottom of chart)
  const [currentRow, setCurrentRow] = useState<number>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return typeof saved.currentRow === "number" ? saved.currentRow : 1;
    } catch { return 1; }
  });

  const [patternMeta, setPatternMeta] = useState<PatternMeta | null>(null);

  // ── Persist all tracker state on change ────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ imageSrc, rect, rows, stitches, currentRow }));
    } catch {}
  }, [imageSrc, rect, rows, stitches, currentRow]);

  // ── Silent AI analysis on mount ────────────────────────────────────────────
  useEffect(() => {
    async function analyze() {
      const img = new Image();
      img.src = imageSrc;
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; });

      const nW = img.naturalWidth, nH = img.naturalHeight;
      const x  = rect.tl.x * nW, y = rect.tl.y * nH;
      const w  = (rect.br.x - rect.tl.x) * nW;
      const h  = (rect.br.y - rect.tl.y) * nH;

      const cv  = document.createElement("canvas");
      cv.width  = Math.round(w);
      cv.height = Math.round(h);
      cv.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, cv.width, cv.height);
      const imageBase64 = cv.toDataURL("image/png").split(",")[1];

      const res = await fetch("/api/analyze-pattern", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ imageBase64, rows, stitches }),
      });
      if (!res.ok) return;

      const data   = await res.json();
      const legend = typeof data.legend === "object" && data.legend ? data.legend : {};
      const colors = typeof data.colors === "object" && data.colors ? data.colors : {};
      const report = typeof data.analysisReport === "string" ? data.analysisReport : "";

      if (Object.keys(legend).length > 0 || Object.keys(colors).length > 0 || report) {
        setPatternMeta({ legend, colors, analysisReport: report });
      }
    }
    analyze().catch(() => {}); // truly silent — never shows an error
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  // ── Overlay geometry (all values as % of image container height/width) ─────
  const rectH = rect.br.y - rect.tl.y;
  const rowH  = rectH / rows;

  // Current row highlight: row 1 = bottom, row N = top
  const barTop    = (rect.br.y - currentRow * rowH) * 100;
  const barHeight = rowH * 100;
  const barLeft   = rect.tl.x * 100;
  const barWidth  = (rect.br.x - rect.tl.x) * 100;

  // Dimmed region: completed rows below currentRow (rows 1 … currentRow−1)
  const dimTop    = (rect.br.y - (currentRow - 1) * rowH) * 100;
  const dimHeight = (currentRow - 1) * rowH * 100;

  // Vertical midpoint of the current row (for floating button alignment)
  const rowMidY = barTop + barHeight / 2;

  // ── Click to jump to row ───────────────────────────────────────────────────
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const el = containerRef.current;
    if (!el) return;
    // Ignore clicks that originate from the floating buttons
    if ((e.target as Element).closest("[data-nav-btn]")) return;
    const { top, height } = el.getBoundingClientRect();
    const yNorm = (e.clientY - top) / height;
    if (yNorm < rect.tl.y || yNorm > rect.br.y) return;
    const frac = (rect.br.y - yNorm) / rectH; // 0 = bottom, 1 = top
    setCurrentRow(Math.max(1, Math.min(rows, Math.ceil(frac * rows))));
  }

  const pct = Math.round((currentRow / rows) * 100);

  return (
    <div className="w-full flex flex-col gap-4" style={{ fontFamily: "var(--font-body)" }}>

      {/* ── AI Pattern Reference card (appears silently when ready) ── */}
      {patternMeta && (
        <div
          className="rounded-2xl px-4 py-3 flex flex-col gap-3"
          style={{ background: "var(--bg-card)", border: `1.5px solid ${C_BORDER}` }}
        >
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: C_MUTED, letterSpacing: "0.05em" }}>
            Pattern Reference
          </p>

          {/* Symbol legend */}
          {Object.keys(patternMeta.legend).length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: C_MUTED }}>Symbols</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {Object.entries(patternMeta.legend).map(([sym, meaning]) => (
                  <span key={sym || "__plain"} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span
                      className="inline-flex items-center justify-center rounded-md flex-shrink-0"
                      style={{ width: 24, height: 24, border: `1px solid ${C_BORDER}`, background: "var(--bg)", color: C_TEXT, fontSize: 14, fontFamily: "system-ui, sans-serif" }}
                    >
                      {sym || "□"}
                    </span>
                    <span>{meaning}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Colors */}
          {Object.keys(patternMeta.colors).length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2" style={{ color: C_MUTED }}>Colors</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {Object.entries(patternMeta.colors).map(([name, hex]) => (
                  <span key={name} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    <span
                      className="inline-flex rounded-md flex-shrink-0"
                      style={{ width: 24, height: 24, background: hex, border: "1px solid rgba(0,0,0,0.14)" }}
                    />
                    <span>{name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Analysis note */}
          {patternMeta.analysisReport && (
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {patternMeta.analysisReport}
            </p>
          )}
        </div>
      )}

      {/* ── Progress bar ── */}
      <div
        className="flex items-center gap-3 px-4 py-2 rounded-2xl text-xs"
        style={{ background: "var(--bg-card)", border: `1.5px solid ${C_BORDER}`, color: C_MUTED }}
      >
        <span>
          <span style={{ fontWeight: 700, color: C_TEXT }}>Row {currentRow}</span>
          {" / "}{rows}
        </span>
        <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 99,
            background: C_GREEN, transition: "width 0.2s ease",
          }} />
        </div>
        <span style={{ fontWeight: 600, color: C_GREEN }}>{pct}%</span>
      </div>

      {/* ── Calibrated image with overlays ── */}
      <div
        ref={containerRef}
        className="relative w-full select-none rounded-2xl overflow-hidden"
        style={{ border: `1.5px solid ${C_BORDER}`, background: "var(--bg-card)", cursor: "crosshair" }}
        onClick={handleClick}
      >
        <img
          src={imageSrc}
          alt="Knitting chart"
          className="w-full h-auto block"
          draggable={false}
        />

        {/* Dimmed overlay for completed rows (rows 1 … currentRow−1) */}
        {currentRow > 1 && (
          <div style={{
            position:   "absolute",
            left:       `${barLeft}%`,
            top:        `${dimTop}%`,
            width:      `${barWidth}%`,
            height:     `${dimHeight}%`,
            background: "rgba(0,0,0,0.22)",
            pointerEvents: "none",
            transition: "height 0.15s ease, top 0.15s ease",
          }} />
        )}

        {/* Current row: clear window with green border */}
        <div style={{
          position:   "absolute",
          left:       `${barLeft}%`,
          top:        `${barTop}%`,
          width:      `${barWidth}%`,
          height:     `${barHeight}%`,
          border:     `2px solid ${C_GREEN}`,
          borderRadius: 2,
          boxSizing:  "border-box",
          pointerEvents: "none",
          transition: "top 0.15s ease",
        }} />

        {/* Row number pill anchored to the left edge of the current row */}
        <div style={{
          position:   "absolute",
          left:       `calc(${barLeft}% + 4px)`,
          top:        `${barTop}%`,
          height:     `${barHeight}%`,
          display:    "flex",
          alignItems: "center",
          pointerEvents: "none",
          transition: "top 0.15s ease",
        }}>
          <span style={{
            background: C_GREEN, color: "#fff",
            fontSize: 10, fontWeight: 700,
            padding: "1px 5px", borderRadius: 4, lineHeight: "14px",
          }}>
            {currentRow}
          </span>
        </div>

        {/* ── Floating Next button — aligned to current row midpoint ── */}
        <button
          data-nav-btn
          onClick={(e) => { e.stopPropagation(); setCurrentRow(r => Math.min(rows, r + 1)); }}
          disabled={currentRow >= rows}
          aria-label="Next row"
          style={{
            position:  "absolute",
            right:     8,
            top:       `${rowMidY}%`,
            transform: "translateY(-50%)",
            zIndex:    30,
            transition: "top 0.15s ease",
            width: 36, height: 36, borderRadius: 10,
            background: currentRow >= rows ? "rgba(143,175,150,0.35)" : "rgba(143,175,150,0.92)",
            border: "none",
            color: "#fff",
            fontSize: 16, fontWeight: 700, lineHeight: 1,
            cursor: currentRow >= rows ? "not-allowed" : "pointer",
            backdropFilter: "blur(6px)",
            boxShadow: currentRow >= rows ? "none" : "0 2px 10px rgba(100,145,110,0.40)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ↑
        </button>
      </div>

      {/* ── Re-calibrate ── */}
      <div className="flex justify-start">
        <button
          onClick={onReset}
          style={{
            padding: "6px 14px", borderRadius: 12, border: `1.5px solid ${C_BORDER}`,
            background: "var(--bg)", color: C_MUTED, fontSize: 12, fontWeight: 600,
            fontFamily: "var(--font-body)", cursor: "pointer",
          }}
        >
          Re-calibrate
        </button>
      </div>

      <p className="text-xs text-center px-2" style={{ color: C_MUTED }}>
        Click the chart to jump to any row · Tap ↑ to advance to the next row.
      </p>
    </div>
  );
}
