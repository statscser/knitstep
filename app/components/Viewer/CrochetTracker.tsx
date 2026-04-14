"use client";

import { useState, useEffect, useRef } from "react";
import type { CrochetData, CrochetLandmark } from "../../lib/types";
import type { Lang } from "../../lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY  = "knitstep_crochet";
const C_GREEN      = "#8FAF96";
const C_HIGHLIGHT  = "#8FAF96";   // Morandi sage-green — used for tracking overlay
const C_MUTED      = "#9C8C7C";
const C_TEXT       = "#3D3530";
const C_BORDER     = "#E0D4CA";

// ─── Props ────────────────────────────────────────────────────────────────────

interface CrochetTrackerProps {
  data: CrochetData;
  lang?: Lang;
  onReset: () => void;
  onRowChange?: (row: number) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return normalized {top, height} (0-100 %) for a given row number.
 *  Uses AI landmarks when available; falls back to equal division. */
function getRowBand(
  row: number,
  total: number,
  landmarks: CrochetLandmark[],
): { top: number; height: number } {
  const lm = landmarks.find((l) => l.rowNumber === row);
  // Guard: yMin/yMax must both be finite numbers and yMax must exceed yMin
  if (
    lm &&
    typeof lm.yMin === "number" && isFinite(lm.yMin) &&
    typeof lm.yMax === "number" && isFinite(lm.yMax) &&
    lm.yMax > lm.yMin
  ) {
    return { top: lm.yMin * 100, height: (lm.yMax - lm.yMin) * 100 };
  }
  // Fallback: equal rows, row 1 = bottom, row N = top
  const rowH = 100 / total;
  return { top: (total - row) * rowH, height: rowH };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CrochetTracker({
  data, lang = "zh", onReset, onRowChange,
}: CrochetTrackerProps) {
  const zh = lang === "zh";

  const [currentRow, setCurrentRow] = useState<number>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return typeof saved.currentRow === "number" ? saved.currentRow : (data.currentRow || 1);
    } catch { return data.currentRow || 1; }
  });

  const containerRef  = useRef<HTMLDivElement>(null);
  const imgRef        = useRef<HTMLImageElement>(null);
  // Container pixel size — needed for SVG ring calculations
  const [containerPx, setContainerPx] = useState({ w: 0, h: 0 });

  // Measure container immediately and keep in sync via ResizeObserver
  function measureContainer() {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
      setContainerPx({ w: rect.width, h: rect.height });
    }
  }

  // Observe container dimensions for circular-mode SVG
  useEffect(() => {
    if (data.mode !== "circular") return;
    const el = containerRef.current;
    if (!el) return;
    // Seed with current size in case ResizeObserver fires late
    measureContainer();
    const obs = new ResizeObserver(([entry]) => {
      setContainerPx({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [data.mode]);

  // Persist progress + notify parent
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, currentRow })); } catch {}
    onRowChange?.(currentRow);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRow]);

  function goTo(row: number) {
    setCurrentRow(Math.max(1, Math.min(data.totalRows, row)));
  }

  // ── Click to jump (flat mode) ─────────────────────────────────────────────
  function handleImageClick(e: React.MouseEvent<HTMLDivElement>) {
    if (data.mode !== "flat") return;
    if ((e.target as Element).closest("[data-nav-btn]")) return;
    const el = containerRef.current;
    if (!el) return;
    const rect  = el.getBoundingClientRect();
    const yNorm = (e.clientY - rect.top) / rect.height;

    if (data.landmarks.length > 0) {
      const hit = data.landmarks.find((l) => yNorm >= l.yMin && yNorm <= l.yMax);
      if (hit) { setCurrentRow(hit.rowNumber); return; }
    }
    // Fallback equal division
    const rowH = 1 / data.totalRows;
    setCurrentRow(Math.max(1, Math.min(data.totalRows, Math.ceil((1 - yNorm) / rowH))));
  }

  const pct = Math.round((currentRow / data.totalRows) * 100);
  const isCircular = data.mode === "circular";
  const label = isCircular ? (zh ? "圈" : "Rnd") : (zh ? "行" : "Row");

  // ── Flat overlay ──────────────────────────────────────────────────────────
  function renderFlatOverlay() {
    const band = getRowBand(currentRow, data.totalRows, data.landmarks);
    // Dim area = everything BELOW the current row (rows already completed)
    const dimTop    = band.top + band.height;
    const dimHeight = 100 - dimTop;

    // Expand the highlight band by 20 % on each side so it generously covers the row
    const pad         = Math.max(band.height * 0.2, 0.4);
    const hlTop       = Math.max(0, band.top - pad);
    const hlHeight    = Math.min(100 - hlTop, band.height + pad * 2);

    return (
      <>
        {/* Completed rows (below current) */}
        {dimHeight > 0.1 && (
          <div style={{
            position: "absolute", left: 0, right: 0,
            top: `${dimTop}%`, height: `${dimHeight}%`,
            background: "rgba(0,0,0,0.38)",
            pointerEvents: "none",
          }} />
        )}
        {/* Current row highlight band — wider for better row coverage */}
        <div style={{
          position: "absolute", left: 0, right: 0,
          top: `${hlTop}%`, height: `${Math.max(hlHeight, 0.8)}%`,
          background: `rgba(143,175,150,0.35)`,
          borderTop:    `2px solid rgba(143,175,150,0.80)`,
          borderBottom: `2px solid rgba(143,175,150,0.80)`,
          pointerEvents: "none",
        }} />
      </>
    );
  }

  // ── Circular SVG overlay ──────────────────────────────────────────────────

  /** Smooth closed SVG path from landmark points.
   *  @param expandScale  Scale each point outward from (cx,cy) by this factor
   *                      (1.0 = no change, 1.08 = 8% outward expansion).
   *  Uses quadratic bezier curves through midpoints for a rounded result. */
  function landmarkToPath(
    lm: import("../../lib/types").CrochetLandmark,
    cx = 0,
    cy = 0,
    expandScale = 1.0,
  ): string {
    const { w, h } = containerPx;
    const pts = lm.points;
    if (!pts || pts.length < 3) return "";
    const n = pts.length;

    // Apply outward expansion in pixel space
    const epx = (i: number) => (cx + (pts[i].x * w - cx) * expandScale).toFixed(1);
    const epy = (i: number) => (cy + (pts[i].y * h - cy) * expandScale).toFixed(1);
    const emx = (i: number, j: number) =>
      (cx + (((pts[i].x + pts[j].x) / 2) * w - cx) * expandScale).toFixed(1);
    const emy = (i: number, j: number) =>
      (cy + (((pts[i].y + pts[j].y) / 2) * h - cy) * expandScale).toFixed(1);

    let d = `M${emx(n - 1, 0)},${emy(n - 1, 0)}`;
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      d += ` Q${epx(i)},${epy(i)} ${emx(i, next)},${emy(i, next)}`;
    }
    return d + " Z";
  }

  function renderCircularOverlay() {
    const { w, h } = containerPx;
    if (w === 0 || h === 0) return null;

    const cx     = data.startPoint.x * w;
    const cy     = data.startPoint.y * h;
    const refDim = Math.min(w, h);

    const sorted = [...data.landmarks].sort((a, b) => a.rowNumber - b.rowNumber);

    // Outer radius (px) for a given round — used when points are unavailable
    function outerR(rn: number): number {
      const lm = sorted.find((l) => l.rowNumber === rn);
      if (lm?.radius != null) return lm.radius * refDim;
      return (rn / data.totalRows) * refDim * 0.45;
    }

    const currentLm = sorted.find((l) => l.rowNumber === currentRow);
    const prevLm    = currentRow > 1 ? sorted.find((l) => l.rowNumber === currentRow - 1) : undefined;

    // Determine if we can use polygon mode
    const usePolygon =
      (currentLm?.points?.length ?? 0) >= 3 &&
      (currentRow === 1 || (prevLm?.points?.length ?? 0) >= 3);

    const innerOfCurrent = currentRow > 1 ? outerR(currentRow - 1) : 0;
    // Expand outer radius 8% outward to cover stitch tops even when AI undershoots
    const outerOfCurrent = outerR(currentRow) * 1.08;
    const bandW = Math.max((outerOfCurrent - innerOfCurrent) * 1.4, 2);

    return (
      <svg
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        viewBox={`0 0 ${w} ${h}`}
      >
        {usePolygon ? (
          <>
            {/* Dim inner area using the previous round's boundary polygon */}
            {prevLm && prevLm.points && prevLm.points.length >= 3 && (
              <path d={landmarkToPath(prevLm, cx, cy, 1.0)} fill="rgba(0,0,0,0.38)" />
            )}
            {/* Highlight ring: outer path expanded ~8% outward so the band
                always covers the stitch tops even when the AI undershoots */}
            {currentLm && currentLm.points && currentLm.points.length >= 3 && (
              <path
                d={
                  landmarkToPath(currentLm, cx, cy, 1.08) +
                  (prevLm && prevLm.points && prevLm.points.length >= 3
                    ? " " + landmarkToPath(prevLm, cx, cy, 1.0)
                    : "")
                }
                fill={`rgba(143,175,150,0.42)`}
                fillRule="evenodd"
              />
            )}
            {/* Subtle outlines for future rounds */}
            {sorted.map((lm) => {
              if (lm.rowNumber <= currentRow) return null;
              const path = landmarkToPath(lm, cx, cy, 1.0);
              if (!path) return null;
              return (
                <path
                  key={lm.rowNumber}
                  d={path}
                  fill="none"
                  stroke={C_BORDER}
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              );
            })}
          </>
        ) : (
          <>
            {/* Circle fallback */}
            {innerOfCurrent > 0 && (
              <circle cx={cx} cy={cy} r={innerOfCurrent} fill="rgba(0,0,0,0.38)" />
            )}
            {outerOfCurrent > 0 && (
              <circle
                cx={cx} cy={cy}
                r={(innerOfCurrent + outerOfCurrent) / 2}
                fill="none"
                stroke={C_HIGHLIGHT}
                strokeWidth={bandW}
                strokeOpacity={0.45}
              />
            )}
            {sorted.map((lm) => {
              if (lm.rowNumber <= currentRow) return null;
              const r = outerR(lm.rowNumber);
              if (r <= 0) return null;
              return (
                <circle
                  key={lm.rowNumber}
                  cx={cx} cy={cy} r={r}
                  fill="none"
                  stroke={C_BORDER}
                  strokeWidth={1}
                  strokeOpacity={0.5}
                />
              );
            })}
          </>
        )}
      </svg>
    );
  }

  // ─── JSX ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full flex flex-col gap-4" style={{ fontFamily: "var(--font-body)" }}>

      {/* ── Progress bar ── */}
      <div
        className="flex items-center gap-3 px-4 py-2.5 rounded-2xl text-xs"
        style={{ background: "var(--bg-card)", border: `1.5px solid ${C_BORDER}`, color: C_MUTED }}
      >
        <span>
          <span style={{ fontWeight: 700, color: C_TEXT }}>
            {zh ? `第 ${currentRow} ${label}` : `${label} ${currentRow}`}
          </span>
          {" / "}{data.totalRows}
          <span style={{ marginLeft: 8, color: "var(--text-muted)", fontSize: 11 }}>
            {isCircular ? (zh ? "圈织" : "Circular") : (zh ? "片织" : "Flat")}
          </span>
        </span>
        <div style={{ flex: 1, background: C_BORDER, borderRadius: "999px", height: 6 }}>
          <div style={{
            width: `${pct}%`, background: C_GREEN,
            borderRadius: "999px", height: "100%", transition: "width 0.3s ease",
          }} />
        </div>
        <span style={{ fontWeight: 700 }}>{pct}%</span>
      </div>

      {/* ── Image with overlay ── */}
      <div
        ref={containerRef}
        onClick={handleImageClick}
        style={{
          position:     "relative",
          borderRadius: "1rem",
          overflow:     "hidden",
          cursor:       isCircular ? "default" : "pointer",
          border:       `1.5px solid ${C_BORDER}`,
          userSelect:   "none",
        }}
      >
        <img
          ref={imgRef}
          src={data.imageSrc}
          alt="crochet chart"
          draggable={false}
          onLoad={measureContainer}
          style={{ width: "100%", display: "block" }}
        />

        {isCircular ? renderCircularOverlay() : renderFlatOverlay()}

        {/* ── Floating row badge (top-right) ── */}
        <div
          data-nav-btn
          style={{
            position:     "absolute",
            top:          "0.6rem",
            right:        "0.6rem",
            background:   "rgba(255,255,255,0.92)",
            border:       `1.5px solid ${C_BORDER}`,
            borderRadius: "999px",
            padding:      "2px 10px",
            fontSize:     13,
            fontWeight:   700,
            color:        C_TEXT,
            lineHeight:   1.6,
          }}
        >
          {currentRow} / {data.totalRows}
        </div>

        {/* ── Floating ▲ / ▼ buttons (right-centre) ── */}
        <div
          data-nav-btn
          style={{
            position:       "absolute",
            right:          "0.6rem",
            top:            "50%",
            transform:      "translateY(-50%)",
            display:        "flex",
            flexDirection:  "column",
            gap:            "0.45rem",
          }}
        >
          {([
            { delta: +1, symbol: "▲", disabled: currentRow >= data.totalRows },
            { delta: -1, symbol: "▼", disabled: currentRow <= 1             },
          ]).map(({ delta, symbol, disabled }) => (
            <button
              key={symbol}
              data-nav-btn
              onClick={(e) => { e.stopPropagation(); goTo(currentRow + delta); }}
              disabled={disabled}
              style={{
                width:         44,
                height:        44,
                borderRadius:  "50%",
                background:    "rgba(255,255,255,0.92)",
                border:        `1.5px solid ${C_BORDER}`,
                cursor:        disabled ? "not-allowed" : "pointer",
                fontSize:      18,
                fontWeight:    700,
                color:         disabled ? C_BORDER : C_TEXT,
                boxShadow:     "0 2px 8px rgba(0,0,0,0.12)",
                display:       "flex",
                alignItems:    "center",
                justifyContent:"center",
                transition:    "opacity 0.2s",
                opacity:       disabled ? 0.4 : 1,
              }}
            >
              {symbol}
            </button>
          ))}
        </div>
      </div>

      {/* ── Recalibrate link ── */}
      <button
        onClick={onReset}
        className="text-xs font-medium text-center underline transition-opacity hover:opacity-70"
        style={{ background: "none", border: "none", cursor: "pointer", color: C_MUTED }}
      >
        {zh ? "重新标定" : "Recalibrate"}
      </button>
    </div>
  );
}
