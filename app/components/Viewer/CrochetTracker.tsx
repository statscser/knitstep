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
   *
   *  Uses **interpolating** quadratic bezier segments: each expanded landmark
   *  point lies exactly on the curve (not merely used as a bezier control handle),
   *  so petal tips and other extremes are always fully covered.
   *
   *  @param expandScale  Radial scale factor from (cx,cy).  1.0 = no change.
   *  @param expandPx     Additional fixed outward expansion in pixels (applied
   *                      proportionally along the radial direction, capped so
   *                      small inner rounds aren't blown out of proportion).
   */
  function landmarkToPath(
    lm: CrochetLandmark,
    cx = 0,
    cy = 0,
    expandScale = 1.0,
    expandPx    = 0,
  ): string {
    const { w, h } = containerPx;
    const pts = lm.points;
    if (!pts || pts.length < 3) return "";
    const n = pts.length;

    // Move a pixel-space point radially outward from (cx, cy)
    const expand = (px: number, py: number) => {
      const dx = px - cx, dy = py - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Cap the px-based bonus at 20 % so tiny inner rounds stay proportional
      const s = expandScale + Math.min(expandPx / dist, 0.20);
      return { x: cx + dx * s, y: cy + dy * s };
    };

    // Expanded control points
    const ep   = Array.from({ length: n }, (_, i) => expand(pts[i].x * w, pts[i].y * h));
    // Midpoints between adjacent expanded points — these are the bezier start/end nodes
    const mids = ep.map((p, i) => ({
      x: (p.x + ep[(i + 1) % n].x) / 2,
      y: (p.y + ep[(i + 1) % n].y) / 2,
    }));

    // Derive each bezier CONTROL POINT so the curve passes exactly THROUGH ep[i].
    // From Q(0.5) = P0/4 + C/2 + P2/4 = ep[i]  →  C = 2·ep[i] − P0/2 − P2/2
    const ctrl = ep.map((p, i) => {
      const p0 = mids[(i - 1 + n) % n];
      const p2 = mids[i];
      return { x: 2 * p.x - p0.x / 2 - p2.x / 2, y: 2 * p.y - p0.y / 2 - p2.y / 2 };
    });

    const f = (v: number) => v.toFixed(1);
    let d = `M${f(mids[n - 1].x)},${f(mids[n - 1].y)}`;
    for (let i = 0; i < n; i++) {
      d += ` Q${f(ctrl[i].x)},${f(ctrl[i].y)} ${f(mids[i].x)},${f(mids[i].y)}`;
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
    // Expand outer radius 14% outward; covers stitch tops even when AI undershoots
    const outerOfCurrent = outerR(currentRow) * 1.14;
    const bandW = Math.max((outerOfCurrent - innerOfCurrent) * 1.4, 2);

    return (
      <svg
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        viewBox={`0 0 ${w} ${h}`}
      >
        {usePolygon ? (
          <>
            {/* Dim inner area — exact boundary of the previous round */}
            {prevLm && prevLm.points && prevLm.points.length >= 3 && (
              <path d={landmarkToPath(prevLm, cx, cy, 1.0, 0)} fill="rgba(0,0,0,0.38)" />
            )}
            {/* Highlight ring:
                  outer = current round expanded 10 % + 8 px → covers stitch tops/petal peaks
                  inner cutout = previous round contracted to 0.96 → band is a bit wider inward too
                Path passes THROUGH each landmark point (interpolating bezier), so petal
                tips and corner peaks are always enclosed. */}
            {currentLm && currentLm.points && currentLm.points.length >= 3 && (
              <path
                d={
                  landmarkToPath(currentLm, cx, cy, 1.10, 8) +
                  (prevLm && prevLm.points && prevLm.points.length >= 3
                    ? " " + landmarkToPath(prevLm, cx, cy, 0.96, 0)
                    : "")
                }
                fill={`rgba(143,175,150,0.42)`}
                fillRule="evenodd"
              />
            )}
            {/* Subtle outlines for future rounds */}
            {sorted.map((lm) => {
              if (lm.rowNumber <= currentRow) return null;
              const path = landmarkToPath(lm, cx, cy, 1.0, 0);
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

  // For flat mode: position nav buttons at the current row band midpoint
  const flatBand = !isCircular ? getRowBand(currentRow, data.totalRows, data.landmarks) : null;
  // Clamp so buttons stay inside the image (centre of 44 px button = ~4 %)
  const navTopPct = flatBand
    ? Math.max(5, Math.min(95, flatBand.top + flatBand.height / 2))
    : 50;

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

      {/* ── Outer container: positioning anchor, no clip ── */}
      <div
        ref={containerRef}
        onClick={handleImageClick}
        style={{
          position:   "relative",
          cursor:     isCircular ? "default" : "pointer",
          userSelect: "none",
        }}
      >
        {/* ── Inner container: clips image + overlays to rounded corners ── */}
        <div style={{
          position:     "relative",
          borderRadius: "1rem",
          overflow:     "hidden",
          border:       `1.5px solid ${C_BORDER}`,
        }}>
          <img
            ref={imgRef}
            src={data.imageSrc}
            alt="crochet chart"
            draggable={false}
            onLoad={measureContainer}
            style={{ width: "100%", display: "block" }}
          />

          {isCircular ? renderCircularOverlay() : renderFlatOverlay()}

          {/* ── Floating row badge (top-right, stays inside clip) ── */}
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
        </div>

        {/* ── Floating nav buttons — outside clip so they can follow row band ── */}
        {isCircular ? (
          /* Circular mode: keep original ▲ / ▼ pair */
          <div
            data-nav-btn
            style={{
              position:      "absolute",
              right:         "0.6rem",
              top:           `${navTopPct}%`,
              transform:     "translateY(-50%)",
              transition:    "top 0.15s ease",
              display:       "flex",
              flexDirection: "column",
              gap:           "0.45rem",
              zIndex:        10,
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
                  width:          44,
                  height:         44,
                  borderRadius:   "50%",
                  background:     "rgba(255,255,255,0.92)",
                  border:         `1.5px solid ${C_BORDER}`,
                  cursor:         disabled ? "not-allowed" : "pointer",
                  fontSize:       18,
                  fontWeight:     700,
                  color:          disabled ? C_BORDER : C_TEXT,
                  boxShadow:      "0 2px 8px rgba(0,0,0,0.12)",
                  display:        "flex",
                  alignItems:     "center",
                  justifyContent: "center",
                  transition:     "opacity 0.2s",
                  opacity:        disabled ? 0.4 : 1,
                }}
              >
                {symbol}
              </button>
            ))}
          </div>
        ) : (
          /* Flat mode: single green row-number + ↑ button (matches RowTracker style) */
          <button
            data-nav-btn
            onClick={(e) => { e.stopPropagation(); goTo(currentRow + 1); }}
            disabled={currentRow >= data.totalRows}
            aria-label="Next row"
            style={{
              position:       "absolute",
              right:          "-0.2rem",
              top:            `${navTopPct}%`,
              transform:      "translateY(-50%)",
              transition:     "top 0.15s ease",
              zIndex:         10,
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              justifyContent: "center",
              gap:            1,
              width:          38,
              padding:        "5px 0",
              borderRadius:   10,
              background:     currentRow >= data.totalRows ? "rgba(143,175,150,0.35)" : "rgba(143,175,150,0.92)",
              border:         "none",
              color:          "#fff",
              cursor:         currentRow >= data.totalRows ? "not-allowed" : "pointer",
              backdropFilter: "blur(6px)",
              boxShadow:      currentRow >= data.totalRows ? "none" : "0 2px 10px rgba(100,145,110,0.40)",
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.03em", lineHeight: 1 }}>
              R{currentRow}
            </span>
            <span style={{ fontSize: 15, lineHeight: 1 }}>↑</span>
          </button>
        )}
      </div>

      {/* ── Recalibrate button ── */}
      <div className="flex justify-center">
        <button
          onClick={onReset}
          style={{
            padding:      "8px 22px",
            borderRadius: 12,
            border:       `1.5px solid ${C_GREEN}`,
            background:   "rgba(143,175,150,0.08)",
            color:        C_GREEN,
            fontSize:     12,
            fontWeight:   600,
            cursor:       "pointer",
            transition:   "all 0.18s",
            fontFamily:   "var(--font-body)",
          }}
        >
          {zh ? "重新标定" : "Recalibrate"}
        </button>
      </div>
    </div>
  );
}
