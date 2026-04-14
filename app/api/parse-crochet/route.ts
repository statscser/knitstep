import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  CrochetLandmark,
  CrochetMode,
  CrochetStartCorner,
} from "../../lib/types";

const MODELS_TO_TRY = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
] as const;

// ─── Prompts ──────────────────────────────────────────────────────────────────

function buildFlatPrompt(startCorner: CrochetStartCorner): string {
  const side = startCorner === "bottom-left" ? "bottom-left" : "bottom-right";
  return `You are a crochet/knitting chart image analyzer.

This is a FLAT chart (片织 / back-and-forth). Row 1 begins at the ${side} corner and rows are read upward.

Task: Identify every row in the chart and its vertical extent in the image.

Rules:
- yMin / yMax are normalized coordinates: 0.0 = very top of image, 1.0 = very bottom
- Row 1 is the LOWEST row (nearest the bottom edge); highest row number is at the top
- If row numbers are printed on the sides of the chart, use them
- If no row numbers are visible, use ALL of the following signals to estimate row boundaries:
  1. COLOR CHANGES: different yarn colors on different rows are a strong signal — each distinct color band is its own row or group of rows
  2. STITCH TOPS: the straight horizontal line formed by the tops of double crochet (dc/长针) or half double crochet (hdc/中长针) symbols marks the top boundary of a row
  3. CHAIN LINES: a horizontal chain (ch/锁针) line typically separates rows
- Cover the full vertical range of the chart; do not leave gaps between rows

Return ONLY valid JSON — no markdown, no commentary:
{"totalRows":<integer>,"landmarks":[{"rowNumber":1,"yMin":0.85,"yMax":0.95},{"rowNumber":2,"yMin":0.74,"yMax":0.84},...]}`;
}

function buildCircularPrompt(cx: number, cy: number): string {
  return `You are a professional crochet chart analyst. Your goal is to trace the EXACT outer silhouette of every round for an interactive overlay.

The user has marked the center at (${cx.toFixed(2)}, ${cy.toFixed(2)}).

### HOW TO LOCATE EACH ROUND'S OUTER EDGE:
1. **Stitch tops (PRIMARY — most reliable signal):**
   Each dc (double crochet / 长针) or hdc (half double crochet / 中长针) symbol has a small horizontal bar or "T" at the very top. The outer boundary of a round is the line connecting those top bars, combined with any chain (ch/锁针) stitches at the same level. This top-bar line is where you must place your points — NOT the midpoint or base of the stitch.
   The outermost round's points should reach the absolute outer edge of the chart, including the topmost horizontal bar of the outermost stitch row.
2. **Color changes:** If different rounds use different yarn colors, each color region is a distinct round. The boundary sits at the top of the last row of that color.
3. **Printed round numbers:** Numbers (1, 2, 3 …) printed near the start of a round are mandatory anchors — if you see "5", your output must have at least 5 rounds.

### TRACING RULES:
4. **Base shape first, then bumps:** Every round is essentially a circle or a square. Start from that base shape, then add gentle inflection points ONLY where the stitches visibly bulge outward or indent (e.g., petal peaks, corner protusions, flower valleys). Do NOT place extra points on smooth straight or curved segments.
   - Near-circular round → 8 evenly spaced points around the circumference
   - Square/granny-square round → 8 points (4 corners + 4 edge midpoints)
   - Petal/flower round → one peak + one valley per petal repeat, typically 12-16 points total
5. **Inflection points only:** Points are bezier CONTROL POINTS for a smooth curve — they do NOT need to sit exactly on the stitch outline. Place them at the natural high/low points of the shape so the resulting smooth curve generously covers the whole round.
6. **No merging:** Each concentric ring of stitches is one unique Round.
7. **Clockwise order:** Points must trace the outer perimeter clockwise.
8. **Full coverage:** Continue until the absolute outer edge of the chart.

### OUTPUT REQUIREMENTS:
- Return ONLY valid JSON.
- "points": normalized [x, y] coordinates (0.0 to 1.0) tracing the outer boundary.
- "radius": maximum distance from center to the edge of this round.

JSON Structure:
{"totalRounds":<integer>,"landmarks":[{"rowNumber":1,"yMin":0,"yMax":0,"radius":0.08,"points":[{"x":...}]}]}`;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  let body: {
    imageBase64: string;
    mimeType: string;
    mode: CrochetMode;
    startPoint?: { x: number; y: number };
    startCorner?: CrochetStartCorner;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const {
    imageBase64,
    mimeType,
    mode,
    startPoint,
    startCorner = "bottom-left",
  } = body;

  if (!imageBase64) {
    return NextResponse.json({ error: "NO_IMAGE" }, { status: 400 });
  }

  const prompt =
    mode === "circular"
      ? buildCircularPrompt(startPoint?.x ?? 0.5, startPoint?.y ?? 0.5)
      : buildFlatPrompt(startCorner);

  let lastError: unknown = null;

  for (const modelName of MODELS_TO_TRY) {
    const model = genAI.getGenerativeModel({ model: modelName });
    try {
      console.log(`[parse-crochet] Trying model: ${modelName}`);
      const result = await model.generateContent([
        { inlineData: { mimeType: mimeType as string, data: imageBase64 } },
        prompt,
      ]);
      const raw = result.response.text().trim();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

      let landmarks: CrochetLandmark[] = Array.isArray(parsed.landmarks)
        ? parsed.landmarks.filter(
            (l: unknown): l is CrochetLandmark =>
              l !== null &&
              typeof l === "object" &&
              typeof (l as CrochetLandmark).rowNumber === "number",
          )
        : [];

      // ── Flat mode: normalise landmark ordering ────────────────────────────
      // The AI sometimes returns swapped yMin/yMax or assigns row numbers that
      // don't match the visual top-to-bottom order, causing the highlight band
      // to jump. Fix: sort by y-midpoint descending (row 1 = bottom = highest y)
      // then re-assign sequential row numbers so they always go bottom→top.
      if (mode === "flat" && landmarks.length > 0) {
        // 1. Repair any swapped yMin/yMax
        for (const lm of landmarks) {
          if (
            typeof lm.yMin === "number" &&
            typeof lm.yMax === "number" &&
            lm.yMin > lm.yMax
          ) {
            [lm.yMin, lm.yMax] = [lm.yMax, lm.yMin];
          }
        }
        // 2. Sort by y midpoint descending (bottom of image first)
        landmarks.sort((a, b) => {
          const mA = ((a.yMin ?? 0) + (a.yMax ?? 0)) / 2;
          const mB = ((b.yMin ?? 0) + (b.yMax ?? 0)) / 2;
          return mB - mA;
        });
        // 3. Re-number 1…N so row 1 is always the bottom-most band
        landmarks.forEach((lm, i) => { lm.rowNumber = i + 1; });
      }

      const totalRows: number =
        parsed.totalRows ?? parsed.totalRounds ?? landmarks.length;

      return NextResponse.json({ landmarks, totalRows });
    } catch (err: unknown) {
      lastError = err;
      const msg = (err as { message?: string })?.message ?? "";
      const status = (err as { status?: number })?.status;
      if (status === 429 || msg.includes("429")) continue;
      if (status === 404 || msg.includes("404")) continue;
      // For other errors, still try next model
    }
  }

  console.error("[parse-crochet] All models failed:", lastError);
  // Return empty landmarks — caller falls back to equal-division
  return NextResponse.json({ landmarks: [], totalRows: 0 }, { status: 200 });
}
