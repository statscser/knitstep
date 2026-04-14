"use client";

import { useState, useRef, useCallback } from "react";
import type { CrochetMode, CrochetStartCorner, CrochetLandmark } from "../../lib/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CrochetCalibrationResult {
  mode: CrochetMode;
  startPoint: { x: number; y: number };
  startCorner?: CrochetStartCorner;
  landmarks: CrochetLandmark[];
  totalRows: number;
}

interface Props {
  imageSrc: string;
  imageBase64: string;
  imageMimeType: string;
  lang?: "zh" | "en";
  initialMode?: CrochetMode;
  onComplete: (result: CrochetCalibrationResult) => void;
  onCancel?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const C_PINK   = "#D9A8A0";
const C_GREEN  = "#8FAF96";
const C_MUTED  = "#9C8C7C";
const C_TEXT   = "#3D3530";
const C_BORDER = "#E0D4CA";
const RADIUS   = "1.5rem";

// ─── Component ────────────────────────────────────────────────────────────────

export default function CrochetCalibrator({
  imageSrc, imageBase64, imageMimeType, lang = "zh", initialMode, onComplete, onCancel,
}: Props) {
  const zh = lang === "zh";
  const imgRef    = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const [mode, setMode]               = useState<CrochetMode | null>(initialMode ?? null);
  const [startPoint, setStartPoint]   = useState<{ x: number; y: number } | null>(null);
  const [startCorner, setStartCorner] = useState<CrochetStartCorner | null>(null);
  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState<string | null>(null);

  // ── Click on image to place/move the crosshair (both modes) ─────────────
  const handleImageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!mode) return;
      const el = imgRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setStartPoint({
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top)  / rect.height)),
      });
      setError(null);
    },
    [mode],
  );

  // ── Flat: corner buttons set the reading direction + default pin position ─
  function selectCorner(corner: CrochetStartCorner) {
    setStartCorner(corner);
    // Default pin to the actual corner of the image (user can click to adjust)
    setStartPoint(corner === "bottom-left" ? { x: 0.04, y: 0.94 } : { x: 0.96, y: 0.94 });
    setError(null);
  }

  function handleModeChange(next: CrochetMode) {
    setMode(next);
    setStartPoint(null);
    setStartCorner(null);
    setError(null);
  }

  // ── Start AI analysis ─────────────────────────────────────────────────────
  async function handleAnalyze() {
    if (!mode || !startPoint) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/parse-crochet", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        signal:  ctrl.signal,
        body: JSON.stringify({
          imageBase64,
          mimeType:    imageMimeType,
          mode,
          startPoint,
          startCorner: startCorner ?? undefined,
        }),
      });

      const data = await res.json();
      const landmarks: CrochetLandmark[] = Array.isArray(data.landmarks) ? data.landmarks : [];
      const totalRows: number = typeof data.totalRows === "number" && data.totalRows > 0
        ? data.totalRows
        : landmarks.length;

      onComplete({ mode, startPoint, startCorner: startCorner ?? undefined, landmarks, totalRows });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return; // cancelled — stay on calibrator
      setError(zh ? "识别失败，请重试" : "Recognition failed. Please try again.");
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }

  function handleCancelAnalysis() {
    abortRef.current?.abort();
    setIsLoading(false);
  }

  const canAnalyze = mode !== null && startPoint !== null && !isLoading;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="w-full flex flex-col gap-5"
      style={{
        background:   "var(--bg-card)",
        border:       `1.5px solid ${C_BORDER}`,
        borderRadius: RADIUS,
        padding:      "1.5rem",
        fontFamily:   "var(--font-body)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold" style={{ color: C_TEXT }}>
          {zh ? "钩针图解标定" : "Crochet Chart Calibration"}
        </p>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ background: "none", border: "none", cursor: "pointer", color: C_MUTED, fontSize: 13 }}
          >
            {zh ? "取消" : "Cancel"}
          </button>
        )}
      </div>

      {/* ── Step 1: mode ───────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: C_MUTED }}>
          {zh ? "第一步：选择编织方式" : "Step 1: Select knitting style"}
        </p>
        <div className="flex gap-2">
          {([
            { value: "circular" as const, label: zh ? "圈织" : "Circular", sub: zh ? "由中心向外" : "Center outward" },
            { value: "flat"     as const, label: zh ? "片织" : "Flat",     sub: zh ? "往返编织"   : "Back and forth"  },
          ]).map(({ value, label, sub }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                onClick={() => handleModeChange(value)}
                className="flex-1 flex flex-col items-center py-3 rounded-2xl transition-all duration-200"
                style={{
                  background: active ? C_GREEN : "var(--bg)",
                  border:     `1.5px solid ${active ? C_GREEN : C_BORDER}`,
                  cursor:     "pointer",
                }}
              >
                <span className="text-sm font-bold" style={{ color: active ? "#fff" : C_TEXT }}>{label}</span>
                <span className="text-xs mt-0.5" style={{ color: active ? "rgba(255,255,255,0.75)" : C_MUTED }}>{sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Step 2: start point ────────────────────────────────────────────── */}
      {mode && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: C_MUTED }}>
            {mode === "circular"
              ? (zh ? "第二步：点击图片中心位置" : "Step 2: Click the chart's center")
              : (zh ? "第二步：选择起始角，然后可点击图片微调位置" : "Step 2: Select start corner — click image to fine-tune pin")}
          </p>

          {/* Image — no objectFit/letterboxing so pin coordinates map 1-to-1.
              No maxHeight: user must see the whole chart to calibrate accurately. */}
          <div
            ref={imgRef}
            onClick={handleImageClick}
            style={{
              position:     "relative",
              borderRadius: "1rem",
              overflow:     "hidden",
              cursor:       "crosshair",
              border:       `1.5px solid ${C_BORDER}`,
              userSelect:   "none",
            }}
          >
            <img
              src={imageSrc}
              alt="chart"
              draggable={false}
              style={{ width: "100%", display: "block" }}
            />

            {/* Crosshair / pin */}
            {startPoint && (
              <div
                style={{
                  position:      "absolute",
                  left:          `${startPoint.x * 100}%`,
                  top:           `${startPoint.y * 100}%`,
                  transform:     "translate(-50%, -50%)",
                  pointerEvents: "none",
                  zIndex:        10,
                }}
              >
                <div style={{ position: "relative", width: 28, height: 28 }}>
                  {/* Horizontal arm */}
                  <div style={{
                    position: "absolute", top: "50%", left: 0, right: 0,
                    height: 2, background: C_PINK, transform: "translateY(-50%)",
                    boxShadow: "0 0 3px rgba(0,0,0,0.4)",
                  }} />
                  {/* Vertical arm */}
                  <div style={{
                    position: "absolute", left: "50%", top: 0, bottom: 0,
                    width: 2, background: C_PINK, transform: "translateX(-50%)",
                    boxShadow: "0 0 3px rgba(0,0,0,0.4)",
                  }} />
                  {/* Centre dot */}
                  <div style={{
                    position: "absolute", top: "50%", left: "50%",
                    transform: "translate(-50%, -50%)",
                    width: 8, height: 8, borderRadius: "50%",
                    background: C_PINK, border: "1.5px solid #fff",
                    boxShadow: "0 0 4px rgba(0,0,0,0.35)",
                  }} />
                </div>
              </div>
            )}
          </div>

          {/* Flat corner buttons */}
          {mode === "flat" && (
            <div className="flex gap-2 mt-2">
              {([
                { value: "bottom-left"  as const, label: zh ? "左下起始" : "Bottom-Left"  },
                { value: "bottom-right" as const, label: zh ? "右下起始" : "Bottom-Right" },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => selectCorner(value)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200"
                  style={{
                    background: startCorner === value ? C_PINK : "var(--bg)",
                    border:     `1.5px solid ${startCorner === value ? C_PINK : C_BORDER}`,
                    color:      startCorner === value ? "#fff" : C_TEXT,
                    cursor:     "pointer",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-center" style={{ color: "#c0695a" }}>⚠️ {error}</p>
      )}

      {/* Analyze / Cancel button */}
      {isLoading ? (
        <div className="flex flex-col items-center gap-2">
          <button
            disabled
            style={{
              background:    C_PINK,
              border:        `1.5px solid ${C_PINK}`,
              borderRadius:  RADIUS,
              color:         "#fff",
              padding:       "0.9rem",
              fontSize:      "0.9375rem",
              fontWeight:    700,
              cursor:        "not-allowed",
              opacity:       0.65,
              width:         "100%",
              letterSpacing: "0.03em",
            }}
          >
            {zh ? "✨ AI 识别中，请稍候…" : "✨ AI analyzing, please wait…"}
          </button>
          <button
            onClick={handleCancelAnalysis}
            style={{
              background:   "none",
              border:       "none",
              color:        C_MUTED,
              fontSize:     12,
              fontWeight:   600,
              cursor:       "pointer",
              padding:      "2px 8px",
              textDecoration: "underline",
            }}
          >
            {zh ? "取消" : "Cancel"}
          </button>
        </div>
      ) : (
        <button
          onClick={handleAnalyze}
          disabled={!canAnalyze}
          style={{
            background:    canAnalyze ? C_PINK : "var(--bg)",
            border:        `1.5px solid ${canAnalyze ? C_PINK : C_BORDER}`,
            borderRadius:  RADIUS,
            color:         canAnalyze ? "#fff" : C_MUTED,
            padding:       "0.9rem",
            fontSize:      "0.9375rem",
            fontWeight:    700,
            cursor:        canAnalyze ? "pointer" : "not-allowed",
            transition:    "all 0.2s",
            letterSpacing: "0.03em",
          }}
        >
          {zh ? "开始 AI 识别 ✨" : "Start AI Analysis ✨"}
        </button>
      )}
    </div>
  );
}
