"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
// Minimum readable cell size in CSS px
const MIN_CELL      = 14;
// Approximate height budget for UI outside the canvas (header, progress bar, etc.)
const UI_HEIGHT_BUDGET = 200;

// Morandi palette — hardcoded so canvas ctx can use them directly
const C_LINE          = "#E0D4CA";
const C_TEXT          = "#3D3530";
const C_MUTED         = "#9C8C7C";
const C_WS_FILL       = "rgba(192,175,166,0.13)";
const C_ACTIVE_FILL   = "rgba(143,175,150,0.28)";
const C_ACTIVE_BORDER = "#8FAF96";
const C_DONE_OVERLAY  = "rgba(0,0,0,0.06)";

export default function GridView({ projectName, data, onProgressUpdate, promptVersion }: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);

  const { rows, totalRows, totalStitches, legend } = data;

  const [currentRow, setCurrentRow]       = useState(() =>
    Math.max(1, Math.min(totalRows, data.currentRow ?? 1))
  );
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Touch tap detection — passive, browser owns all scroll
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMoved    = useRef(false);

  // ── Reset when project changes ─────────────────────────────────────────────
  useEffect(() => {
    const newRow = Math.max(1, Math.min(totalRows, data.currentRow ?? 1));
    setCurrentRow(newRow);
    setBannerDismissed(false);

    requestAnimationFrame(() => {
      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const cssW      = container.clientWidth;
      const cellByW   = Math.floor((cssW - LEFT_MARGIN) / totalStitches);
      const cellByH   = Math.floor((window.innerHeight - UI_HEIGHT_BUDGET - BOTTOM_MARGIN) / totalRows);
      const cellSide  = Math.max(MIN_CELL, Math.min(cellByW, cellByH));
      const dataIdx   = rows.findIndex((r) => r.rowNumber === newRow);
      if (dataIdx < 0) return;
      const canvasRow = totalRows - 1 - dataIdx;
      const rowY      = canvasRow * cellSide;
      const canvasTop = canvas.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({
        top:      Math.max(0, canvasTop + rowY - window.innerHeight / 2 + cellSide / 2),
        behavior: "smooth",
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Stable ref so touch listeners (empty deps) can always call the latest handler
  const handleTapAtRef = useRef<(cx: number, cy: number) => void>(() => {});
  handleTapAtRef.current = (canvasX: number, canvasY: number) => {
    const container = containerRef.current;
    if (!container) return;
    if (canvasX < LEFT_MARGIN) return;
    const cssW     = container.clientWidth;
    const cellByW  = Math.floor((cssW - LEFT_MARGIN) / totalStitches);
    const cellByH  = Math.floor((window.innerHeight - UI_HEIGHT_BUDGET - BOTTOM_MARGIN) / totalRows);
    const cellSide = Math.max(MIN_CELL, Math.min(cellByW, cellByH));
    const canvasRow = Math.floor(canvasY / cellSide);
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

    const dpr = window.devicePixelRatio || 1;
    const cssW = container.clientWidth;

    // Choose the largest cell that fits both the container width and viewport height.
    // This makes the grid fill the screen on wider devices without needing to scroll.
    // If the grid is too tall/wide at MIN_CELL, the overflow container handles scrolling.
    const cellByWidth  = Math.floor((cssW - LEFT_MARGIN) / totalStitches);
    const cellByHeight = Math.floor((window.innerHeight - UI_HEIGHT_BUDGET - BOTTOM_MARGIN) / totalRows);
    const cellSide     = Math.max(MIN_CELL, Math.min(cellByWidth, cellByHeight));

    const gridW   = cellSide * totalStitches;
    const gridH   = cellSide * totalRows;
    // Canvas covers its actual content — may exceed container width for dense grids
    const canvasW = LEFT_MARGIN + gridW;
    const cssH    = gridH + BOTTOM_MARGIN;

    canvas.width        = Math.round(canvasW * dpr);
    canvas.height       = Math.round(cssH * dpr);
    canvas.style.width  = `${canvasW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // ── Draw rows (bottom-up: data index 0 = row 1 = canvas bottom) ──────────
    rows.forEach((row, dataIdx) => {
      const canvasRow = totalRows - 1 - dataIdx;
      const y         = canvasRow * cellSide;

      if (row.type === "WS") {
        ctx.fillStyle = C_WS_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }
      if (row.rowNumber === currentRow) {
        ctx.fillStyle = C_ACTIVE_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      // Row number label
      const labelSize  = Math.max(9, Math.round(cellSide * 0.38));
      ctx.font         = `600 ${labelSize}px system-ui, sans-serif`;
      ctx.fillStyle    = row.rowNumber === currentRow ? C_ACTIVE_BORDER : C_MUTED;
      ctx.textAlign    = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(row.rowNumber), LEFT_MARGIN - 5, y + cellSide / 2);

      // Cells
      row.cells.forEach((rawCell, colIdx) => {
        const cell = normalizeCell(rawCell);
        if (cell.s === "span-continuation") return;

        const span  = cell.span ?? 1;
        const x     = LEFT_MARGIN + colIdx * cellSide;
        const width = cellSide * span;

        if (cell.c) {
          ctx.fillStyle = cell.c;
          ctx.fillRect(x, y, width, cellSide);
        }

        ctx.strokeStyle = cell.c ? "rgba(0,0,0,0.18)" : C_LINE;
        ctx.lineWidth   = span > 1 ? 1.25 : 0.75;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, cellSide - 1);

        if (cell.s) {
          let symSize = Math.max(9, Math.round(cellSide * (span > 1 ? 0.58 : 0.54)));
          ctx.font    = `${symSize}px system-ui, sans-serif`;
          const availW = width - 4;
          const textW  = ctx.measureText(cell.s).width;
          if (textW > availW && availW > 0) {
            symSize  = Math.max(7, Math.floor(symSize * (availW / textW)));
            ctx.font = `${symSize}px system-ui, sans-serif`;
          }
          ctx.fillStyle    = cell.c ? (isLightColor(cell.c) ? C_TEXT : "#fff") : C_TEXT;
          ctx.textAlign    = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(cell.s, x + width / 2, y + cellSide / 2 + 1);
        }

        if (cell.u) {
          const qSize = Math.max(7, Math.round(cellSide * 0.32));
          ctx.font         = `bold ${qSize}px system-ui, sans-serif`;
          ctx.fillStyle    = "rgba(210, 100, 20, 0.82)";
          ctx.textAlign    = "right";
          ctx.textBaseline = "top";
          ctx.fillText("?", x + width - 2, y + 2);
        }
      });

      if (row.rowNumber < currentRow) {
        ctx.fillStyle = C_DONE_OVERLAY;
        ctx.fillRect(0, y, LEFT_MARGIN + gridW, cellSide);
      }
    });

    // Active row border (drawn last — always on top)
    const activeDataIdx = rows.findIndex((r) => r.rowNumber === currentRow);
    if (activeDataIdx >= 0) {
      const canvasRow = totalRows - 1 - activeDataIdx;
      const y         = canvasRow * cellSide;
      ctx.strokeStyle = C_ACTIVE_BORDER;
      ctx.lineWidth   = 2.5;
      ctx.strokeRect(LEFT_MARGIN + 1.25, y + 1.25, gridW - 2.5, cellSide - 2.5);
    }

    // Stitch number labels (bottom axis)
    const sLabelSize = Math.max(8, Math.round(cellSide * 0.34));
    ctx.font         = `${sLabelSize}px system-ui, sans-serif`;
    ctx.fillStyle    = C_MUTED;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    for (let col = 0; col < totalStitches; col++) {
      const x = LEFT_MARGIN + col * cellSide + cellSide / 2;
      ctx.fillText(String(col + 1), x, gridH + 5);
    }
  }, [rows, totalRows, totalStitches, currentRow]);

  useEffect(() => { draw(); }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // Redraw when viewport is resized (cellByHeight depends on window.innerHeight)
  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  // ── Passive touch tap detection — browser handles all scroll ─────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    if (!canvas) return;

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      touchMoved.current    = false;
    }
    function onTouchMove(e: TouchEvent) {
      if (!touchStartRef.current || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - touchStartRef.current.x;
      const dy = e.touches[0].clientY - touchStartRef.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchMoved.current = true;
    }
    function onTouchEnd(e: TouchEvent) {
      if (!touchMoved.current && e.changedTouches.length === 1 && touchStartRef.current) {
        const rect = canvas.getBoundingClientRect();
        handleTapAtRef.current(
          e.changedTouches[0].clientX - rect.left,
          e.changedTouches[0].clientY - rect.top,
        );
      }
      touchStartRef.current = null;
    }

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove",  onTouchMove,  { passive: true });
    canvas.addEventListener("touchend",   onTouchEnd,   { passive: true });
    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove",  onTouchMove);
      canvas.removeEventListener("touchend",   onTouchEnd);
    };
  }, []);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    handleTapAtRef.current(e.clientX - rect.left, e.clientY - rect.top);
  }

  const pct           = Math.round((currentRow / totalRows) * 100);
  const activeRowData = rows.find((r) => r.rowNumber === currentRow) ?? null;

  return (
    <div className="w-full flex flex-col items-center gap-3">

      {/* Low-confidence banner */}
      {data.confidence !== undefined && data.confidence < 85 && !bannerDismissed && (
        <div
          className="w-full max-w-xl flex items-start gap-2 px-4 py-2.5 rounded-2xl text-xs"
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
        className="w-full max-w-xl flex items-center gap-3 px-4 py-2 rounded-2xl text-xs"
        style={{ background: "var(--bg-card)", border: "1.5px solid var(--border)", color: C_MUTED }}
      >
        <span style={{ flexShrink: 0 }}>
          <span style={{ fontWeight: 700, color: C_TEXT }}>Row {currentRow}</span>
          {" / "}{totalRows}
        </span>
        <div style={{ flex: 1, height: 5, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: 99,
            background: C_ACTIVE_BORDER, transition: "width 0.25s ease",
          }} />
        </div>
        <span style={{ fontWeight: 600, color: C_ACTIVE_BORDER, flexShrink: 0 }}>{pct}%</span>
      </div>

      {/* Canvas scroll wrapper — overflow:auto so dense/tall grids can be scrolled */}
      <div
        ref={containerRef}
        className="rounded-2xl"
        style={{
          position:    "relative",
          border:      "1.5px solid var(--border)",
          background:  "var(--bg-card)",
          overflow:    "auto",
          touchAction: "auto",
          // Shrink to the canvas's natural width, but never exceed the column
          width:    "fit-content",
          maxWidth: "100%",
          margin:   "0 auto",
        }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          style={{ cursor: "pointer", display: "block" }}
          aria-label={`${projectName} knitting chart — tap a row to mark progress`}
        />

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
      </div>

      {/* Current-row info pill */}
      <div className="w-full max-w-xl" style={{ minHeight: "2.25rem" }}>
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
            Tap a row on the chart to mark your progress.
          </p>
        )}
      </div>

      {/* Legend */}
      <div
        className="w-full max-w-xl rounded-2xl px-4 py-3"
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

      {/* AI analysis panel — lab mode only */}
      {ENABLE_PROMPT_LAB && data.confidence !== undefined && (
        <div
          className="w-full max-w-xl rounded-2xl px-4 py-3 flex flex-col gap-1.5"
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
