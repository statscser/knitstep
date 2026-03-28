"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2 } from "lucide-react";
import type { GridCell, GridData } from "../../lib/types";
import { PROMPT_GALLERY, type PromptVersion } from "../../lib/prompts";
import { ENABLE_PROMPT_LAB } from "../../config";

// Normalize legacy string cells and new object cells to a common shape
function normalizeCell(c: GridCell): { s: string; c?: string; u?: boolean; span?: number } {
  return typeof c === "string" ? { s: c } : c;
}

// Returns true if the hex color is perceptually light (use dark text on top)
function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

// ─── GridView ─────────────────────────────────────────────────────────────────

interface GridViewProps {
  projectName: string;
  data: GridData;
  onProgressUpdate: (row: number) => void;
  promptVersion?: PromptVersion;
}

// Canvas layout constants
const LEFT_MARGIN   = 30; // px reserved for row-number labels
const BOTTOM_MARGIN = 24; // px reserved for stitch-number labels

// Zoom limits
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

// Morandi palette — hardcoded so canvas ctx can use them directly
const C_LINE          = "#E0D4CA"; // var(--border)
const C_TEXT          = "#3D3530"; // var(--text-main)
const C_MUTED         = "#9C8C7C"; // slightly darker than --text-muted for legibility
const C_WS_FILL       = "rgba(192,175,166,0.13)"; // subtle tint on WS rows
const C_ACTIVE_FILL   = "rgba(143,175,150,0.28)"; // morandi-green tint for current row
const C_ACTIVE_BORDER = "#8FAF96"; // var(--morandi-green)
const C_DONE_OVERLAY  = "rgba(0,0,0,0.06)";       // dim completed rows

export default function GridView({ projectName, data, onProgressUpdate, promptVersion }: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const { rows, totalRows, totalStitches, legend } = data;

  // currentRow: 1-based row number tracking knitting progress
  const [currentRow, setCurrentRow] = useState(() =>
    Math.max(1, Math.min(totalRows, data.currentRow ?? 1))
  );
  const [transform, setTransform]   = useState({ scale: 1, ox: 0, oy: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Mirror transform in refs so gesture callbacks never capture stale state
  const scaleRef = useRef(1);
  const oxRef    = useRef(0);
  const oyRef    = useRef(0);

  // Touch gesture tracking ref
  const touchRef   = useRef<{ type: "pan" | "pinch"; lastX: number; lastY: number; lastDist: number } | null>(null);
  const touchMoved = useRef(false);

  // Mouse drag tracking refs
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  const mouseDragged = useRef(false);

  // ── Reset + auto-scroll when project changes ───────────────────────────────
  useEffect(() => {
    const newRow = Math.max(1, Math.min(totalRows, data.currentRow ?? 1));
    setCurrentRow(newRow);

    // Reset zoom/pan and banner
    scaleRef.current = 1;
    oxRef.current    = 0;
    oyRef.current    = 0;
    setTransform({ scale: 1, ox: 0, oy: 0 });
    setBannerDismissed(false);

    // Scroll the page so currentRow is centred in the viewport
    requestAnimationFrame(() => {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const cssW     = container.clientWidth;
      const cellSide = Math.max(22, Math.floor((cssW - LEFT_MARGIN) / totalStitches));
      const dataIdx  = rows.findIndex((r) => r.rowNumber === newRow);
      if (dataIdx < 0) return;
      const canvasRow = totalRows - 1 - dataIdx;
      const rowY      = canvasRow * cellSide; // top of row in canvas content-space (scale=1)
      const canvasTop = canvas.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top:      Math.max(0, canvasTop + rowY - window.innerHeight / 2 + cellSide / 2),
        behavior: "smooth",
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Always-current tap handler in a ref — the touch listener ([] deps) never
  // captures stale closures over totalStitches / totalRows / currentRow.
  const handleTapAtRef = useRef<(cx: number, cy: number) => void>(() => {});
  handleTapAtRef.current = (canvasX: number, canvasY: number) => {
    const container = containerRef.current;
    if (!container) return;
    // Inverse transform: canvas px → content px
    const contentX  = (canvasX - oxRef.current) / scaleRef.current;
    const contentY  = (canvasY - oyRef.current) / scaleRef.current;
    if (contentX < LEFT_MARGIN) return; // row-label area — ignore
    const cellSide  = Math.max(22, Math.floor((container.clientWidth - LEFT_MARGIN) / totalStitches));
    const canvasRow = Math.floor(contentY / cellSide);
    if (canvasRow < 0 || canvasRow >= totalRows) return;
    const dataIdx = totalRows - 1 - canvasRow;
    const rowNum  = rows[dataIdx]?.rowNumber;
    if (rowNum === undefined) return;
    setCurrentRow(rowNum);
    onProgressUpdate(rowNum);
  };

  // ── Core draw function ─────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const dpr      = window.devicePixelRatio || 1;
    const cssW     = container.clientWidth;
    // Natural cell size so the full grid fits at scale = 1
    const cellSide = Math.max(22, Math.floor((cssW - LEFT_MARGIN) / totalStitches));
    const gridW    = cellSide * totalStitches;
    const gridH    = cellSide * totalRows;
    const cssH     = gridH + BOTTOM_MARGIN;

    canvas.width        = Math.round(cssW * dpr);
    canvas.height       = Math.round(cssH * dpr);
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    // Clear the physical pixel buffer first (canvas.width assignment clears it, but be explicit)
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // Apply zoom / pan on top of DPR scale
    ctx.save();
    ctx.translate(transform.ox, transform.oy);
    ctx.scale(transform.scale, transform.scale);

    // ── Draw rows ────────────────────────────────────────────────────────────
    // Knitting charts read bottom-up: data index 0 (row 1) → canvas bottom
    rows.forEach((row, dataIdx) => {
      const canvasRow = totalRows - 1 - dataIdx;
      const y         = canvasRow * cellSide;

      // WS row background tint
      if (row.type === "WS") {
        ctx.fillStyle = C_WS_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      // Current row: green highlight background
      if (row.rowNumber === currentRow) {
        ctx.fillStyle = C_ACTIVE_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      // Row number label (right-aligned inside left margin)
      const labelSize  = Math.max(9, Math.round(cellSide * 0.38));
      ctx.font         = `600 ${labelSize}px system-ui, sans-serif`;
      ctx.fillStyle    = row.rowNumber === currentRow ? C_ACTIVE_BORDER : C_MUTED;
      ctx.textAlign    = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(row.rowNumber), LEFT_MARGIN - 5, y + cellSide / 2);

      // Cells
      row.cells.forEach((rawCell, colIdx) => {
        const cell = normalizeCell(rawCell);

        // Skip span-continuation placeholders — the preceding span cell already covers this area
        if (cell.s === "span-continuation") return;

        const span  = cell.span ?? 1;
        const x     = LEFT_MARGIN + colIdx * cellSide;
        const width = cellSide * span;

        // Color fill (Fair Isle / Jacquard / cable background)
        if (cell.c) {
          ctx.fillStyle = cell.c;
          ctx.fillRect(x, y, width, cellSide);
        }

        // Grid border — single rect spanning the full cable width
        ctx.strokeStyle = cell.c ? "rgba(0,0,0,0.18)" : C_LINE;
        ctx.lineWidth   = span > 1 ? 1.25 : 0.75;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, cellSide - 1);

        // Symbol — centered across the full span width, shrunk to fit if too wide
        if (cell.s) {
          let symSize = Math.max(11, Math.round(cellSide * (span > 1 ? 0.58 : 0.54)));
          ctx.font    = `${symSize}px system-ui, sans-serif`;
          // If the text overflows the cell, scale the font down proportionally
          const availW = width - 4;
          const textW  = ctx.measureText(cell.s).width;
          if (textW > availW && availW > 0) {
            symSize  = Math.max(8, Math.floor(symSize * (availW / textW)));
            ctx.font = `${symSize}px system-ui, sans-serif`;
          }
          ctx.fillStyle    = cell.c ? (isLightColor(cell.c) ? C_TEXT : "#fff") : C_TEXT;
          ctx.textAlign    = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(cell.s, x + width / 2, y + cellSide / 2 + 1);
        }

        // Uncertainty — small amber '?' in top-right corner
        if (cell.u) {
          const qSize = Math.max(8, Math.round(cellSide * 0.32));
          ctx.font         = `bold ${qSize}px system-ui, sans-serif`;
          ctx.fillStyle    = "rgba(210, 100, 20, 0.82)";
          ctx.textAlign    = "right";
          ctx.textBaseline = "top";
          ctx.fillText("?", x + width - 2, y + 2);
        }
      });

      // Completed-row shadow overlay (drawn over cell content to dim it)
      // Rows with a lower row number are "done" — they sit below currentRow.
      if (row.rowNumber < currentRow) {
        ctx.fillStyle = C_DONE_OVERLAY;
        ctx.fillRect(0, y, LEFT_MARGIN + gridW, cellSide);
      }
    });

    // Current row strong border (drawn last so it's always on top)
    const activeDataIdx = rows.findIndex((r) => r.rowNumber === currentRow);
    if (activeDataIdx >= 0) {
      const canvasRow = totalRows - 1 - activeDataIdx;
      const y         = canvasRow * cellSide;
      ctx.strokeStyle = C_ACTIVE_BORDER;
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(LEFT_MARGIN + 1.25, y + 1.25, gridW - 2.5, cellSide - 2.5);
    }

    // ── Stitch number labels (bottom) ─────────────────────────────────────
    const sLabelSize = Math.max(8, Math.round(cellSide * 0.34));
    ctx.font         = `${sLabelSize}px system-ui, sans-serif`;
    ctx.fillStyle    = C_MUTED;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    for (let col = 0; col < totalStitches; col++) {
      const x = LEFT_MARGIN + col * cellSide + cellSide / 2;
      ctx.fillText(String(col + 1), x, gridH + 5);
    }

    ctx.restore();
  }, [rows, totalRows, totalStitches, currentRow, transform]);

  // Redraw when data, currentRow, or transform changes
  useEffect(() => { draw(); }, [draw]);

  // Redraw on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // ── Touch + wheel listeners ────────────────────────────────────────────────
  // Attached imperatively so we can use { passive: false } and call preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function touchDist(t: TouchList) {
      const dx = t[1].clientX - t[0].clientX;
      const dy = t[1].clientY - t[0].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 1) {
        touchRef.current = { type: "pan", lastX: e.touches[0].clientX, lastY: e.touches[0].clientY, lastDist: 0 };
        touchMoved.current = false;
      } else if (e.touches.length === 2) {
        touchRef.current = {
          type:     "pinch",
          lastX:    (e.touches[0].clientX + e.touches[1].clientX) / 2,
          lastY:    (e.touches[0].clientY + e.touches[1].clientY) / 2,
          lastDist: touchDist(e.touches),
        };
        touchMoved.current = true;
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      if (!touchRef.current) return;

      if (touchRef.current.type === "pan" && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchRef.current.lastX;
        const dy = e.touches[0].clientY - touchRef.current.lastY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) touchMoved.current = true;
        oxRef.current += dx;
        oyRef.current += dy;
        setTransform({ scale: scaleRef.current, ox: oxRef.current, oy: oyRef.current });
        touchRef.current.lastX = e.touches[0].clientX;
        touchRef.current.lastY = e.touches[0].clientY;

      } else if (e.touches.length === 2 && touchRef.current.type === "pinch") {
        const newDist  = touchDist(e.touches);
        const midX     = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const midY     = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const rect     = canvas!.getBoundingClientRect();
        const cx       = midX - rect.left;
        const cy       = midY - rect.top;
        const ratio    = newDist / touchRef.current.lastDist;
        const prevScl  = scaleRef.current;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScl * ratio));
        const contentX = (cx - oxRef.current) / prevScl;
        const contentY = (cy - oyRef.current) / prevScl;
        let newOx      = cx - contentX * newScale + (midX - touchRef.current.lastX);
        let newOy      = cy - contentY * newScale + (midY - touchRef.current.lastY);
        scaleRef.current = newScale;
        oxRef.current    = newOx;
        oyRef.current    = newOy;
        setTransform({ scale: newScale, ox: newOx, oy: newOy });
        touchRef.current.lastDist = newDist;
        touchRef.current.lastX    = midX;
        touchRef.current.lastY    = midY;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!touchMoved.current && e.changedTouches.length === 1) {
        const rect = canvas!.getBoundingClientRect();
        handleTapAtRef.current(
          e.changedTouches[0].clientX - rect.left,
          e.changedTouches[0].clientY - rect.top,
        );
      }
      if (e.touches.length === 0) touchRef.current = null;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect     = canvas!.getBoundingClientRect();
      const cx       = e.clientX - rect.left;
      const cy       = e.clientY - rect.top;
      const factor   = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const prevScl  = scaleRef.current;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScl * factor));
      const contentX = (cx - oxRef.current) / prevScl;
      const contentY = (cy - oyRef.current) / prevScl;
      scaleRef.current = newScale;
      oxRef.current    = cx - contentX * newScale;
      oyRef.current    = cy - contentY * newScale;
      setTransform({ scale: newScale, ox: oxRef.current, oy: oyRef.current });
    }

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: false });
    canvas.addEventListener("touchend",   onTouchEnd,   { passive: true });
    canvas.addEventListener("wheel",      onWheel,      { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchend",   onTouchEnd);
      canvas.removeEventListener("wheel",      onWheel);
    };
  }, []); // no React deps — reads/writes go through stable refs; setTransform is stable

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    mouseDragged.current = false;
    setIsDragging(true);
  }
  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!lastMousePos.current) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) mouseDragged.current = true;
    oxRef.current += dx;
    oyRef.current += dy;
    setTransform({ scale: scaleRef.current, ox: oxRef.current, oy: oyRef.current });
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  }
  function handleMouseUp()    { lastMousePos.current = null; setIsDragging(false); }
  function handleMouseLeave() { lastMousePos.current = null; setIsDragging(false); }
  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mouseDragged.current) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    handleTapAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
  }

  // ── Reset view ─────────────────────────────────────────────────────────────
  function resetView() {
    scaleRef.current = 1; oxRef.current = 0; oyRef.current = 0;
    setTransform({ scale: 1, ox: 0, oy: 0 });
  }

  // ── Derived display values ─────────────────────────────────────────────────
  const isTransformed  = transform.scale !== 1 || transform.ox !== 0 || transform.oy !== 0;
  const pct            = Math.round((currentRow / totalRows) * 100);
  const activeRowData  = rows.find((r) => r.rowNumber === currentRow) ?? null;

  return (
    <div className="w-full max-w-xl flex flex-col gap-3">

      {/* Confidence banner — shown when AI confidence is below 85% and not dismissed */}
      {data.confidence !== undefined && data.confidence < 85 && !bannerDismissed && (
        <div
          className="flex items-start gap-2 px-4 py-2.5 rounded-2xl text-xs"
          style={{
            background: "rgba(245,200,50,0.12)",
            border:     "1.5px solid rgba(215,170,30,0.45)",
            color:      "#7A6000",
          }}
        >
          <span style={{ fontWeight: 700, flexShrink: 0 }}>
            ⚠ AI 置信度 {data.confidence}%
          </span>
          <span style={{ flex: 1, color: "#9A7A00" }}>
            {data.analysisReport
              ? `— ${data.analysisReport}`
              : "— 建议人工核对图解，橙色边框格子表示 AI 识别存疑。"}
          </span>
          <button
            onClick={() => setBannerDismissed(true)}
            aria-label="关闭提示"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#9A7A00", lineHeight: 0, padding: "1px", flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Progress header */}
      <div
        className="flex items-center justify-between px-4 py-2 rounded-2xl text-xs"
        style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)", color: C_MUTED }}
      >
        <span>
          <span style={{ fontWeight: 700, color: C_TEXT }}>Row {currentRow}</span>
          {" / "}{totalRows}
        </span>
        {/* Progress bar */}
        <div style={{ flex: 1, margin: "0 12px", height: 5, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
          <div
            style={{
              height:       "100%",
              width:        `${pct}%`,
              borderRadius: 99,
              background:   C_ACTIVE_BORDER,
              transition:   "width 0.25s ease",
            }}
          />
        </div>
        <span style={{ fontWeight: 600, color: C_ACTIVE_BORDER }}>{pct}%</span>
      </div>

      {/* Canvas wrapper — overflow:hidden clips zoomed content */}
      <div
        ref={containerRef}
        className="w-full rounded-2xl overflow-hidden"
        style={{ position: "relative", border: "1.5px solid var(--border)", background: "var(--bg-card)" }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          style={{ cursor: isDragging ? "grabbing" : "grab", display: "block", touchAction: "none" }}
          aria-label={`${projectName} knitting chart — tap a row to mark progress, pinch/scroll to zoom, drag to pan`}
        />

        {/* Lab badge — floating top-left, only in Lab mode */}
        {ENABLE_PROMPT_LAB && promptVersion && (
          <div
            style={{
              position: "absolute", top: 8, left: 8,
              padding: "2px 8px", borderRadius: 99,
              background: "rgba(143,175,150,0.88)",
              backdropFilter: "blur(4px)",
              color: "#fff", fontSize: 10, fontWeight: 700,
              letterSpacing: "0.04em", pointerEvents: "none",
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
            }}
          >
            🧪 {PROMPT_GALLERY[promptVersion]?.name ?? promptVersion}
          </div>
        )}

        {/* Reset-view button */}
        {isTransformed && (
          <button
            onClick={resetView}
            title="Reset view"
            aria-label="Reset view"
            style={{
              position: "absolute", top: 8, right: 8,
              width: 30, height: 30, borderRadius: "50%",
              background: "rgba(255,255,255,0.88)",
              border: `1px solid ${C_LINE}`,
              cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: C_MUTED,
              backdropFilter: "blur(4px)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.10)",
            }}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* Current-row info pill */}
      <div style={{ minHeight: "2.25rem" }}>
        {activeRowData ? (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm"
            style={{ background: "rgba(143,175,150,0.12)", border: `1.5px solid ${C_ACTIVE_BORDER}`, color: C_TEXT }}
          >
            <span style={{ fontWeight: 700 }}>Row {activeRowData.rowNumber}</span>
            <span
              className="px-1.5 py-0.5 rounded-md text-xs font-semibold"
              style={{ background: C_ACTIVE_BORDER, color: "#fff" }}
            >
              {activeRowData.type}
            </span>
            <span style={{ color: C_MUTED, fontSize: "0.75rem" }}>
              {activeRowData.cells.map(normalizeCell).map(c => c.s).filter(s => s && s !== "span-continuation").join("  ") || (data.colors ? "color block" : "knit / purl")}
            </span>
            {currentRow > 1 && (
              <button
                onClick={() => { setCurrentRow(1); onProgressUpdate(1); }}
                style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C_MUTED, lineHeight: 0, padding: "2px" }}
                aria-label="Reset to row 1"
                title="Reset to row 1"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          <p className="text-xs px-1" style={{ color: C_MUTED }}>
            Tap a row to mark progress · Pinch or scroll to zoom · Drag to pan
          </p>
        )}
      </div>

      {/* Legend */}
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)" }}
      >
        <p className="text-xs font-bold mb-2" style={{ color: C_MUTED, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          Legend
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {Object.entries(legend).map(([sym, meaning]) => (
            <span key={sym || "__plain"} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span
                className="inline-flex items-center justify-center rounded-md flex-shrink-0"
                style={{ width: 24, height: 24, border: `1px solid ${C_LINE}`, background: "var(--bg)", color: C_TEXT, fontSize: 14, fontFamily: "system-ui, sans-serif" }}
              >
                {sym || "□"}
              </span>
              <span>{meaning}</span>
            </span>
          ))}
          {data.colors && Object.keys(data.colors).length > 0 && (
            <>
              <div className="w-full" style={{ borderTop: `1px solid ${C_LINE}`, marginTop: 2, paddingTop: 2 }} />
              {Object.entries(data.colors).map(([id, hex]) => (
                <span key={id} className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <span
                    className="inline-flex rounded-md flex-shrink-0"
                    style={{ width: 24, height: 24, background: hex, border: "1px solid rgba(0,0,0,0.14)" }}
                  />
                  <span>{id} — {hex}</span>
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      {/* Confidence + analysis report panel — always visible when data is present */}
      {ENABLE_PROMPT_LAB && data.confidence !== undefined && (
        <div
          className="rounded-2xl px-4 py-3 flex flex-col gap-1.5"
          style={{
            background: "var(--bg-card)",
            border: `1.5px solid ${data.confidence >= 85 ? "var(--border)" : "rgba(215,170,30,0.45)"}`,
          }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: C_MUTED }}>
              AI 解析报告
            </span>
            <span
              className="text-sm font-bold tabular-nums"
              style={{ color: data.confidence >= 85 ? C_ACTIVE_BORDER : "#C97B3A" }}
            >
              {data.confidence}%
            </span>
          </div>
          {data.analysisReport && (
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {data.analysisReport}
            </p>
          )}
          {promptVersion && (
            <p className="text-xs" style={{ color: C_MUTED, opacity: 0.7 }}>
              提示词版本：{PROMPT_GALLERY[promptVersion]?.name ?? promptVersion}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
