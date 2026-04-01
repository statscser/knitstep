"use client";

import { useState, useRef, useMemo, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point { x: number; y: number }

/** Axis-aligned crop rectangle in normalized 0–1 image coordinates */
export interface CropRect { tl: Point; br: Point }

export interface CalibrationResult {
  rect: CropRect;
  rows: number;
  stitches: number;
}

interface GridCalibratorProps {
  imageSrc: string;
  lang?: "zh" | "en";
  onComplete: (result: CalibrationResult) => void;
  isLoading?: boolean;
  error?: string | null;
  onCancel?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C_GREEN  = "#8FAF96";
const C_MUTED  = "#9C8C7C";
const C_TEXT   = "#3D3530";
const C_BORDER = "#E0D4CA";

type DragMode = "tl" | "tr" | "bl" | "br" | "move" | null;

// ─── Component ────────────────────────────────────────────────────────────────

export default function GridCalibrator({
  imageSrc, lang = "zh", onComplete, isLoading = false, error, onCancel,
}: GridCalibratorProps) {
  const zh = lang === "zh";
  const containerRef = useRef<HTMLDivElement>(null);

  const [rowsStr,     setRowsStr]     = useState("20");
  const [stitchesStr, setStitchesStr] = useState("20");

  const rows     = Math.max(1, Math.min(200, parseInt(rowsStr,     10) || 1));
  const stitches = Math.max(1, Math.min(200, parseInt(stitchesStr, 10) || 1));

  const [rect, setRect] = useState<CropRect>({
    tl: { x: 0.1, y: 0.1 },
    br: { x: 0.9, y: 0.9 },
  });

  const [dragMode, setDragMode] = useState<DragMode>(null);

  // For "move" drag: snapshot of rect + pointer at drag start
  const moveStartRef = useRef<{
    mouseX: number; mouseY: number;
    tl: Point; br: Point;
  } | null>(null);

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  const toNorm = useCallback((clientX: number, clientY: number): Point => {
    const r = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (clientY - r.top)  / r.height)),
    };
  }, []);

  function clamp(v: number) { return Math.max(0, Math.min(1, v)); }

  // ── Shared drag update logic ───────────────────────────────────────────────
  function applyDrag(mode: DragMode, p: Point) {
    if (mode === "tl") {
      setRect(prev => ({
        tl: { x: Math.min(p.x, prev.br.x - 0.02), y: Math.min(p.y, prev.br.y - 0.02) },
        br: prev.br,
      }));
    } else if (mode === "tr") {
      setRect(prev => ({
        tl: { x: prev.tl.x, y: Math.min(p.y, prev.br.y - 0.02) },
        br: { x: Math.max(p.x, prev.tl.x + 0.02), y: prev.br.y },
      }));
    } else if (mode === "bl") {
      setRect(prev => ({
        tl: { x: Math.min(p.x, prev.br.x - 0.02), y: prev.tl.y },
        br: { x: prev.br.x, y: Math.max(p.y, prev.tl.y + 0.02) },
      }));
    } else if (mode === "br") {
      setRect(prev => ({
        tl: prev.tl,
        br: { x: Math.max(p.x, prev.tl.x + 0.02), y: Math.max(p.y, prev.tl.y + 0.02) },
      }));
    } else if (mode === "move" && moveStartRef.current) {
      const s  = moveStartRef.current;
      const dx = p.x - s.mouseX;
      const dy = p.y - s.mouseY;
      const w  = s.br.x - s.tl.x;
      const h  = s.br.y - s.tl.y;
      const tlX = clamp(s.tl.x + dx);
      const tlY = clamp(s.tl.y + dy);
      setRect({
        tl: { x: tlX,            y: tlY },
        br: { x: clamp(tlX + w), y: clamp(tlY + h) },
      });
    }
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────
  function onHandleMouseDown(mode: "tl" | "tr" | "bl" | "br") {
    return (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setDragMode(mode); };
  }

  function onMoveMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const norm = toNorm(e.clientX, e.clientY);
    moveStartRef.current = { mouseX: norm.x, mouseY: norm.y, tl: rect.tl, br: rect.br };
    setDragMode("move");
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!dragMode) return;
    applyDrag(dragMode, toNorm(e.clientX, e.clientY));
  }

  function onMouseUp() { setDragMode(null); moveStartRef.current = null; }

  // ── Touch handlers ─────────────────────────────────────────────────────────
  function onHandleTouchStart(mode: "tl" | "tr" | "bl" | "br") {
    return (e: React.TouchEvent) => { e.preventDefault(); e.stopPropagation(); setDragMode(mode); };
  }

  function onMoveTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    if (e.touches.length !== 1) return;
    const norm = toNorm(e.touches[0].clientX, e.touches[0].clientY);
    moveStartRef.current = { mouseX: norm.x, mouseY: norm.y, tl: rect.tl, br: rect.br };
    setDragMode("move");
  }

  function onTouchMove(e: React.TouchEvent) {
    if (!dragMode || e.touches.length !== 1) return;
    applyDrag(dragMode, toNorm(e.touches[0].clientX, e.touches[0].clientY));
  }

  function onTouchEnd() { setDragMode(null); moveStartRef.current = null; }

  // ── SVG grid lines (axis-aligned) ──────────────────────────────────────────
  const { gridPaths, outlinePath } = useMemo(() => {
    const { tl, br } = rect;
    const x1 = tl.x * 100, y1 = tl.y * 100;
    const x2 = br.x * 100, y2 = br.y * 100;
    const W  = x2 - x1, H = y2 - y1;

    const lines: string[] = [];
    for (let i = 0; i <= stitches; i++) {
      const x = x1 + W * (i / stitches);
      lines.push(`M ${x.toFixed(3)} ${y1.toFixed(3)} L ${x.toFixed(3)} ${y2.toFixed(3)}`);
    }
    for (let i = 0; i <= rows; i++) {
      const y = y1 + H * (i / rows);
      lines.push(`M ${x1.toFixed(3)} ${y.toFixed(3)} L ${x2.toFixed(3)} ${y.toFixed(3)}`);
    }

    return {
      gridPaths:   lines.join(" "),
      outlinePath: `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2} L ${x1} ${y2} Z`,
    };
  }, [rect, rows, stitches]);

  // ── Confirm ────────────────────────────────────────────────────────────────
  function handleConfirm() {
    onComplete({ rect, rows, stitches });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const isMoveDrag = dragMode === "move";

  return (
    <div className="w-full flex flex-col gap-4" style={{ fontFamily: "var(--font-body)" }}>

      {/* Preparation hint */}
      <div
        className="flex items-start gap-3 px-4 py-3 rounded-2xl text-sm"
        style={{ background: "rgba(143,175,150,0.10)", border: "1.5px solid rgba(143,175,150,0.35)", color: C_TEXT }}
      >
        <span style={{ fontSize: 18, lineHeight: 1.3 }}>🧶</span>
        <span style={{ lineHeight: 1.55 }}>
          <strong style={{ color: "#5A7A62" }}>
            {"框选图解区域，输入行数和针数，然后点击确认。"}
          </strong>
          {"拖动四角调整边框，让网格精准覆盖图解范围，再按行追踪你的编织进度。"}
        </span>
      </div>

      {/* Controls */}
      <div
        className="flex items-end justify-between gap-4 px-4 py-3 rounded-2xl flex-wrap"
        style={{ background: "var(--bg-card)", border: `1.5px solid ${C_BORDER}` }}
      >
        <div className="flex gap-5">
          {([[zh ? "行数" : "Rows", rowsStr, setRowsStr], [zh ? "针数" : "Stitches", stitchesStr, setStitchesStr]] as const).map(
            ([label, val, setter]) => (
              <div key={label} className="flex flex-col gap-1">
                <label className="text-xs font-bold uppercase tracking-wide" style={{ color: C_MUTED }}>
                  {label}
                </label>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={val}
                  onChange={e => setter(e.target.value)}
                  onBlur={e => {
                    const n = Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 1));
                    setter(String(n));
                  }}
                  style={{
                    width: 64, padding: "4px 8px", borderRadius: 10,
                    border: `1.5px solid ${C_BORDER}`, background: "var(--bg)",
                    color: C_TEXT, fontSize: 14, fontFamily: "var(--font-body)", outline: "none",
                  }}
                />
              </div>
            )
          )}
        </div>

        <div className="flex items-center gap-2">
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={isLoading}
              style={{
                padding: "8px 14px", borderRadius: 12, border: `1.5px solid ${C_BORDER}`,
                background: "var(--bg)", color: C_MUTED, fontSize: 13, fontWeight: 600,
                fontFamily: "var(--font-body)", cursor: isLoading ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {zh ? "取消" : "Cancel"}
            </button>
          )}
          <button
            onClick={handleConfirm}
            disabled={isLoading}
            style={{
              padding: "8px 20px", borderRadius: 12, border: "none",
              background: isLoading ? "#A8C5AE" : C_GREEN,
              color: "#fff", fontSize: 13, fontWeight: 700,
              fontFamily: "var(--font-body)", cursor: isLoading ? "not-allowed" : "pointer",
              letterSpacing: "0.02em",
              boxShadow: isLoading ? "none" : "0 2px 8px rgba(143,175,150,0.35)",
              transition: "background 0.15s", whiteSpace: "nowrap",
              display: "flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={e => { if (!isLoading) e.currentTarget.style.background = "#7A9E82"; }}
            onMouseLeave={e => { if (!isLoading) e.currentTarget.style.background = C_GREEN; }}
          >
            {isLoading && (
              <span style={{
                display: "inline-block", width: 12, height: 12,
                border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff",
                borderRadius: "50%", animation: "spin 0.7s linear infinite",
              }} />
            )}
            {isLoading ? (zh ? "确认中…" : "Confirming…") : (zh ? "确认并开始追踪" : "Confirm & Start Tracking")}
          </button>
        </div>
      </div>

      {/* Image + overlay */}
      <div
        ref={containerRef}
        className="relative w-full select-none rounded-2xl overflow-hidden"
        style={{
          border:      `1.5px solid ${C_BORDER}`,
          background:  "var(--bg-card)",
          cursor:      dragMode ? "crosshair" : "default",
          touchAction: "none",
          userSelect:  "none",
        }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={imageSrc}
          alt="Knitting chart to calibrate"
          className="w-full h-auto block"
          draggable={false}
          crossOrigin="anonymous"
        />

        {/* SVG overlay: transparent crop rectangle + grid lines */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Crop border — green outline, fully transparent fill */}
          <path d={outlinePath} fill="transparent" stroke={C_GREEN} strokeWidth="0.6" />
          {/* Grid lines */}
          <path d={gridPaths} fill="none" stroke="rgba(207, 130, 130, 0.75)" strokeWidth="0.2" />
        </svg>

        {/* Interior drag area (move) */}
        <div
          onMouseDown={onMoveMouseDown}
          onTouchStart={onMoveTouchStart}
          style={{
            position: "absolute",
            left:   `${rect.tl.x * 100}%`,
            top:    `${rect.tl.y * 100}%`,
            width:  `${(rect.br.x - rect.tl.x) * 100}%`,
            height: `${(rect.br.y - rect.tl.y) * 100}%`,
            cursor:  isMoveDrag ? "grabbing" : "grab",
            zIndex:  10,
          }}
        />

        {/* TL handle */}
        <Handle
          x={rect.tl.x} y={rect.tl.y}
          isActive={dragMode === "tl"}
          cursor="nwse-resize"
          label="Top-Left"
          onMouseDown={onHandleMouseDown("tl")}
          onTouchStart={onHandleTouchStart("tl")}
        />

        {/* TR handle */}
        <Handle
          x={rect.br.x} y={rect.tl.y}
          isActive={dragMode === "tr"}
          cursor="nesw-resize"
          label="Top-Right"
          onMouseDown={onHandleMouseDown("tr")}
          onTouchStart={onHandleTouchStart("tr")}
        />

        {/* BL handle */}
        <Handle
          x={rect.tl.x} y={rect.br.y}
          isActive={dragMode === "bl"}
          cursor="nesw-resize"
          label="Bottom-Left"
          onMouseDown={onHandleMouseDown("bl")}
          onTouchStart={onHandleTouchStart("bl")}
        />

        {/* BR handle */}
        <Handle
          x={rect.br.x} y={rect.br.y}
          isActive={dragMode === "br"}
          cursor="nwse-resize"
          label="Bottom-Right"
          onMouseDown={onHandleMouseDown("br")}
          onTouchStart={onHandleTouchStart("br")}
        />
      </div>

      {error ? (
        <p className="text-xs text-center px-2" style={{ color: "var(--morandi-blush)" }}>⚠️ {error}</p>
      ) : (
        <p className="text-xs text-center px-2" style={{ color: C_MUTED }}>
          {zh ? "拖动四角调整大小 · 拖动内部移动位置 · 输入行数和针数后确认" : "Drag any corner to resize · drag inside to move · set rows & stitches, then confirm."}
        </p>
      )}
    </div>
  );
}

// ─── Handle sub-component ─────────────────────────────────────────────────────

function Handle({ x, y, isActive, cursor, label, onMouseDown, onTouchStart }: {
  x: number; y: number; isActive: boolean; cursor: string; label: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
}) {
  return (
    <div
      title={label}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        position: "absolute",
        left: `${x * 100}%`, top: `${y * 100}%`,
        transform: "translate(-50%, -50%)",
        width: 44, height: 44,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor,
        zIndex: 20,
      }}
    >
      <div style={{
        width:  isActive ? 18 : 14,
        height: isActive ? 18 : 14,
        borderRadius: 4,
        border: `2.5px solid ${isActive ? "#fff" : "#8FAF96"}`,
        background: isActive ? "#8FAF96" : "rgba(255,255,255,0.9)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.30)",
        transition: "width 0.1s, height 0.1s",
      }} />
    </div>
  );
}
