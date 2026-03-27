"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { GridData } from "../../lib/types";

// ─── GridView ─────────────────────────────────────────────────────────────────

interface GridViewProps {
  projectName: string;
  data: GridData;
}

// Canvas layout constants
const LEFT_MARGIN   = 30; // px reserved for row-number labels
const BOTTOM_MARGIN = 24; // px reserved for stitch-number labels

// Morandi palette — hardcoded so canvas ctx can use them directly
const C_LINE          = "#E0D4CA"; // var(--border)
const C_TEXT          = "#3D3530"; // var(--text-main)
const C_MUTED         = "#9C8C7C"; // slightly darker than --text-muted for legibility
const C_WS_FILL       = "rgba(192,175,166,0.13)"; // subtle tint on WS rows
const C_ACTIVE_FILL   = "rgba(143,175,150,0.28)"; // morandi-green tint
const C_ACTIVE_BORDER = "#8FAF96"; // var(--morandi-green)

export default function GridView({ projectName, data }: GridViewProps) {
  const containerRef              = useRef<HTMLDivElement>(null);
  const canvasRef                 = useRef<HTMLCanvasElement>(null);
  const [activeRowIndex, setActiveRowIndex] = useState<number | null>(null);

  const { rows, totalRows, totalStitches, legend } = data;

  // ── Core draw function ────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;

    const dpr           = window.devicePixelRatio || 1;
    const containerW    = container.clientWidth;
    const cellSide      = Math.max(22, Math.floor((containerW - LEFT_MARGIN) / totalStitches));
    const gridW         = cellSide * totalStitches;
    const gridH         = cellSide * totalRows;
    const cssW          = LEFT_MARGIN + gridW;
    const cssH          = gridH + BOTTOM_MARGIN;

    // Resize canvas backing store
    canvas.width        = Math.round(cssW * dpr);
    canvas.height       = Math.round(cssH * dpr);
    canvas.style.width  = `${cssW}px`;
    canvas.style.height = `${cssH}px`;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    // ── Draw rows ────────────────────────────────────────────────────────────
    // Knitting charts read bottom-up: data row index 0 (rowNumber 1) → canvas bottom
    rows.forEach((row, dataIdx) => {
      const canvasRow = totalRows - 1 - dataIdx; // 0 = topmost canvas row
      const y         = canvasRow * cellSide;

      // WS row background tint
      if (row.type === "WS") {
        ctx.fillStyle = C_WS_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      // Active row highlight fill
      if (activeRowIndex === dataIdx) {
        ctx.fillStyle = C_ACTIVE_FILL;
        ctx.fillRect(LEFT_MARGIN, y, gridW, cellSide);
      }

      // Row number label (right-aligned inside left margin)
      const labelSize = Math.max(9, Math.round(cellSide * 0.38));
      ctx.font         = `600 ${labelSize}px system-ui, sans-serif`;
      ctx.fillStyle    = activeRowIndex === dataIdx ? C_ACTIVE_BORDER : C_MUTED;
      ctx.textAlign    = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(String(row.rowNumber), LEFT_MARGIN - 5, y + cellSide / 2);

      // ── Cells ──────────────────────────────────────────────────────────────
      row.cells.forEach((symbol, colIdx) => {
        const x = LEFT_MARGIN + colIdx * cellSide;

        // Cell border
        ctx.strokeStyle = C_LINE;
        ctx.lineWidth   = 0.75;
        ctx.strokeRect(x + 0.5, y + 0.5, cellSide - 1, cellSide - 1);

        // Symbol text (empty string = plain knit/purl, no drawing needed)
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

    // Active row strong border (drawn on top)
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
  }, [rows, totalRows, totalStitches, activeRowIndex]);

  // Redraw when data or active row changes
  useEffect(() => { draw(); }, [draw]);

  // Redraw on container resize (orientation changes, window resize)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  // ── Click handler — select/deselect a row ────────────────────────────────
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas    = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect     = canvas.getBoundingClientRect();
    const offsetX  = e.clientX - rect.left;
    const offsetY  = e.clientY - rect.top;
    if (offsetX < LEFT_MARGIN) return; // click on row label — ignore

    const cellSide  = Math.max(22, Math.floor((container.clientWidth - LEFT_MARGIN) / totalStitches));
    const canvasRow = Math.floor(offsetY / cellSide);
    if (canvasRow < 0 || canvasRow >= totalRows) return;

    const dataIdx = totalRows - 1 - canvasRow;
    setActiveRowIndex(prev => prev === dataIdx ? null : dataIdx);
  }

  const activeRow = activeRowIndex !== null ? rows[activeRowIndex] : null;

  return (
    <div className="w-full max-w-xl flex flex-col gap-3">

      {/* Canvas wrapper — overflow-x-auto handles very small screens */}
      <div
        ref={containerRef}
        className="w-full overflow-x-auto rounded-2xl"
        style={{ border: "1.5px solid var(--border)", background: "var(--bg-card)" }}
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          style={{ cursor: "pointer", display: "block" }}
          aria-label={`${projectName} knitting chart — click a row to highlight it`}
        />
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
            Tap a row to highlight your current position.
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
