"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Maximize2 } from "lucide-react";
import type { GridData } from "../../lib/types";

// ─── GridView ─────────────────────────────────────────────────────────────────

interface GridViewProps {
  projectName: string;
  data: GridData;
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
const C_ACTIVE_FILL   = "rgba(143,175,150,0.28)"; // morandi-green tint
const C_ACTIVE_BORDER = "#8FAF96"; // var(--morandi-green)

export default function GridView({ projectName, data }: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);
  const [transform, setTransform]   = useState({ scale: 1, ox: 0, oy: 0 });
  const [isDragging, setIsDragging] = useState(false);

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

  const { rows, totalRows, totalStitches, legend } = data;

  // Reset view when the project changes
  useEffect(() => {
    scaleRef.current = 1;
    oxRef.current    = 0;
    oyRef.current    = 0;
    setTransform({ scale: 1, ox: 0, oy: 0 });
    setActiveRowIndex(null);
  }, [data]);

  // Always-current tap handler stored in a ref so the touch listener (attached
  // once with [] deps) never holds a stale closure over totalStitches / totalRows.
  const handleTapAtRef = useRef<(cx: number, cy: number) => void>(() => {});
  handleTapAtRef.current = (canvasX: number, canvasY: number) => {
    const container = containerRef.current;
    if (!container) return;
    // Inverse transform: canvas px → content px
    const contentX  = (canvasX - oxRef.current) / scaleRef.current;
    const contentY  = (canvasY - oyRef.current) / scaleRef.current;
    if (contentX < LEFT_MARGIN) return; // row-label area
    const cellSide  = Math.max(22, Math.floor((container.clientWidth - LEFT_MARGIN) / totalStitches));
    const canvasRow = Math.floor(contentY / cellSide);
    if (canvasRow < 0 || canvasRow >= totalRows) return;
    const dataIdx = totalRows - 1 - canvasRow;
    setActiveRowIndex(prev => prev === dataIdx ? null : dataIdx);
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

    // Resize canvas backing store to match current container width
    canvas.width        = Math.round(cssW * dpr);
    canvas.height       = Math.round(cssH * dpr);
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // Apply zoom / pan on top of the DPR scale
    ctx.save();
    ctx.translate(transform.ox, transform.oy);
    ctx.scale(transform.scale, transform.scale);

    // ── Draw rows ────────────────────────────────────────────────────────────
    // Knitting charts read bottom-up: data index 0 (row 1) → canvas bottom
    rows.forEach((row, dataIdx) => {
      const canvasRow = totalRows - 1 - dataIdx;
      const y         = canvasRow * cellSide;

      if (row.type === "WS") {
        ctx.fillStyle = C_WS_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }
      if (activeRowIndex === dataIdx) {
        ctx.fillStyle = C_ACTIVE_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      const labelSize  = Math.max(9, Math.round(cellSide * 0.38));
      ctx.font         = `600 ${labelSize}px system-ui, sans-serif`;
      ctx.fillStyle    = activeRowIndex === dataIdx ? C_ACTIVE_BORDER : C_MUTED;
      ctx.textAlign    = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(row.rowNumber), LEFT_MARGIN - 5, y + cellSide / 2);

      row.cells.forEach((symbol, colIdx) => {
        const x = LEFT_MARGIN + colIdx * cellSide;
        ctx.strokeStyle = C_LINE;
        ctx.lineWidth   = 0.75;
        ctx.strokeRect(x + 0.5, y + 0.5, cellSide - 1, cellSide - 1);
        if (symbol) {
          const symSize    = Math.max(11, Math.round(cellSide * 0.54));
          ctx.font         = `${symSize}px system-ui, sans-serif`;
          ctx.fillStyle    = C_TEXT;
          ctx.textAlign    = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(symbol, x + cellSide / 2, y + cellSide / 2 + 1);
        }
      });
    });

    // Active row strong border (drawn on top of everything)
    if (activeRowIndex !== null) {
      const canvasRow = totalRows - 1 - activeRowIndex;
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
  }, [rows, totalRows, totalStitches, activeRowIndex, transform]);

  // Redraw when data, active row, or transform changes
  useEffect(() => { draw(); }, [draw]);

  // Redraw on container resize (orientation changes, window resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // ── Touch + wheel listeners ────────────────────────────────────────────────
  // Attached imperatively (not via React props) so we can use { passive: false }
  // and call e.preventDefault() to block browser scroll/pinch-zoom.
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
        touchRef.current = {
          type: "pan",
          lastX: e.touches[0].clientX,
          lastY: e.touches[0].clientY,
          lastDist: 0,
        };
        touchMoved.current = false;
      } else if (e.touches.length === 2) {
        touchRef.current = {
          type:     "pinch",
          lastX:    (e.touches[0].clientX + e.touches[1].clientX) / 2,
          lastY:    (e.touches[0].clientY + e.touches[1].clientY) / 2,
          lastDist: touchDist(e.touches),
        };
        touchMoved.current = true; // pinch can never become a tap
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault(); // block page scroll / browser zoom
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
        const cx       = midX - rect.left; // midpoint in canvas CSS px
        const cy       = midY - rect.top;

        const ratio    = newDist / touchRef.current.lastDist;
        const prevScl  = scaleRef.current;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prevScl * ratio));

        // Zoom relative to midpoint: the content point under the midpoint stays fixed
        const contentX = (cx - oxRef.current) / prevScl;
        const contentY = (cy - oyRef.current) / prevScl;
        let newOx = cx - contentX * newScale;
        let newOy = cy - contentY * newScale;

        // Also apply midpoint translation (two-finger pan during pinch)
        newOx += midX - touchRef.current.lastX;
        newOy += midY - touchRef.current.lastY;

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
      // Treat a non-moved single-finger lift as a tap → row selection
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

  // ── Mouse handlers (drag to pan, click to select row) ─────────────────────
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

  function handleMouseUp() {
    lastMousePos.current = null;
    setIsDragging(false);
  }

  function handleMouseLeave() {
    lastMousePos.current = null;
    setIsDragging(false);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (mouseDragged.current) return; // suppress click after a drag
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    handleTapAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
  }

  // ── Reset view ─────────────────────────────────────────────────────────────
  function resetView() {
    scaleRef.current = 1;
    oxRef.current    = 0;
    oyRef.current    = 0;
    setTransform({ scale: 1, ox: 0, oy: 0 });
  }

  const isTransformed = transform.scale !== 1 || transform.ox !== 0 || transform.oy !== 0;
  const activeRow     = activeRowIndex !== null ? rows[activeRowIndex] : null;

  return (
    <div className="w-full max-w-xl flex flex-col gap-3">

      {/* Canvas wrapper — overflow:hidden clips zoomed-out / panned content */}
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
          style={{
            cursor:      isDragging ? "grabbing" : "grab",
            display:     "block",
            touchAction: "none", // let our handlers own all touch gestures
          }}
          aria-label={`${projectName} knitting chart — pinch or scroll to zoom, drag to pan, tap a row to highlight`}
        />

        {/* Reset-view button — only visible when the view has been transformed */}
        {isTransformed && (
          <button
            onClick={resetView}
            title="Reset view"
            aria-label="Reset view"
            style={{
              position:       "absolute",
              top:            8,
              right:          8,
              width:          30,
              height:         30,
              borderRadius:   "50%",
              background:     "rgba(255,255,255,0.88)",
              border:         `1px solid ${C_LINE}`,
              cursor:         "pointer",
              display:        "flex",
              alignItems:     "center",
              justifyContent: "center",
              color:          C_MUTED,
              backdropFilter: "blur(4px)",
              boxShadow:      "0 1px 4px rgba(0,0,0,0.10)",
            }}
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* Active-row info pill */}
      <div style={{ minHeight: "2.25rem" }}>
        {activeRow ? (
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm"
            style={{
              background: "rgba(143,175,150,0.12)",
              border: `1.5px solid ${C_ACTIVE_BORDER}`,
              color: C_TEXT,
            }}
          >
            <span style={{ fontWeight: 700 }}>Row {activeRow.rowNumber}</span>
            <span
              className="px-1.5 py-0.5 rounded-md text-xs font-semibold"
              style={{ background: C_ACTIVE_BORDER, color: "#fff" }}
            >
              {activeRow.type}
            </span>
            <span style={{ color: C_MUTED, fontSize: "0.75rem" }}>
              {activeRow.cells.filter(Boolean).join("  ") || "knit / purl"}
            </span>
            <button
              onClick={() => setActiveRowIndex(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: C_MUTED, lineHeight: 0, padding: "2px" }}
              aria-label="Deselect row"
            >
              ✕
            </button>
          </div>
        ) : (
          <p className="text-xs px-1" style={{ color: C_MUTED }}>
            Tap a row to highlight · Pinch or scroll to zoom · Drag to pan
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
                style={{
                  width: 24, height: 24,
                  border: `1px solid ${C_LINE}`,
                  background: "var(--bg)",
                  color: C_TEXT,
                  fontSize: 14,
                  fontFamily: "system-ui, sans-serif",
                }}
              >
                {sym || "□"}
              </span>
              <span>{meaning}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
