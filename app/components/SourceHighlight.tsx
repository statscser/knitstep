"use client";

import { AnimatePresence, motion } from "framer-motion";

interface Props {
  /** Normalized bounding box from AI: [ymin, xmin, ymax, xmax] in 0-1000 space. */
  sourceBox: [number, number, number, number] | undefined;
  /** True when this highlight should be shown (correct file index, step selected). */
  isVisible: boolean;
}

/**
 * Renders a spotlight highlight box over the source image to pinpoint a step.
 *
 * SILENT MODE (HIGHLIGHT_ENABLED = false):
 *   Returns null while AI bounding-box accuracy is being improved.
 *   All coordinate-mapping infrastructure is preserved here.
 *   Flip HIGHLIGHT_ENABLED to true to re-enable once precision is acceptable.
 */
const HIGHLIGHT_ENABLED = false;

export default function SourceHighlight({ sourceBox, isVisible }: Props) {
  if (!HIGHLIGHT_ENABLED || !isVisible || !sourceBox) return null;

  const [ymin, xmin, ymax, xmax] = sourceBox;
  // Pad the box so it covers the full step line even with slight AI imprecision.
  // top/right/bottom/left avoids CSS height-percentage issues in auto-height containers.
  const P = 15; // 1.5% of image dimension on each side

  return (
    <AnimatePresence>
      <motion.div
        key="source-highlight"
        initial={{ opacity: 0 }}
        animate={{
          opacity: 1,
          boxShadow: [
            "0 0 0 9999px rgba(0,0,0,0.25), 0 0 6px 2px rgba(16,185,129,0.6)",
            "0 0 0 9999px rgba(0,0,0,0.25), 0 0 14px 5px rgba(16,185,129,0.9)",
            "0 0 0 9999px rgba(0,0,0,0.25), 0 0 6px 2px rgba(16,185,129,0.6)",
          ],
        }}
        exit={{ opacity: 0 }}
        transition={{
          opacity: { duration: 0.25 },
          boxShadow: { duration: 1.8, repeat: Infinity, ease: "easeInOut" },
        }}
        style={{
          position:      "absolute",
          top:           `${Math.max(0, ymin - P) / 10}%`,
          left:          `${Math.max(0, xmin - P) / 10}%`,
          right:         `${Math.max(0, 1000 - xmax - P) / 10}%`,
          bottom:        `${Math.max(0, 1000 - ymax - P) / 10}%`,
          minWidth:      "20px",
          zIndex:        10,
          border:        "1px solid #10b981",
          borderRadius:  "4px",
          pointerEvents: "none",
        }}
      />
    </AnimatePresence>
  );
}
