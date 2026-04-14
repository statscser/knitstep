import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  CrochetLandmark,
  CrochetMode,
  CrochetStartCorner,
} from "../../lib/types";

const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite-preview",
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
- If no row numbers are visible, estimate row boundaries from the repeating stitch pattern
- Cover the full vertical range of the chart; do not leave gaps between rows

Return ONLY valid JSON — no markdown, no commentary:
{"totalRows":<integer>,"landmarks":[{"rowNumber":1,"yMin":0.85,"yMax":0.95},{"rowNumber":2,"yMin":0.74,"yMax":0.84},...]}`;
}

function buildCircularPrompt(cx: number, cy: number): string {
  return `You are a professional crochet chart analyst. Your goal is to trace the EXACT outer silhouette of every round for an interactive overlay.

The user has marked the center at (${cx.toFixed(2)}, ${cy.toFixed(2)}).

### CRITICAL RULES TO FIX ALIGNMENT:
1. **High-Density Tracing (50-60 points):** To ensure a smooth and accurate fit, you MUST provide between 50 and 60 points for each round. This density is required to capture corners and curves without looking "jagged" or "way off".
2. **Prioritize Pixels over Symmetry:** Do NOT force a mathematically perfect circle or square. Instead, trace the ACTUAL outer perimeter of the stitches as they appear in the image. If the image is slightly tilted or asymmetric, your coordinates must follow that tilt.
3. **Mandatory Round Numbers:** Use the printed numbers (1, 2, 3, 4, 5...) in the chart as mandatory anchors. Each round must encompass its corresponding number and all stitches in that layer.
4. **No Merging:** Each concentric ring of stitches is one unique Round. Do not skip or combine them.
5. **Clockwise Continuity:** All points must be in strict clockwise order to ensure the overlay renders correctly without intersecting itself.

### OUTPUT REQUIREMENTS:
- Return ONLY valid JSON.
- "points": An array of 50-60 normalized [x, y] coordinates (0.0 to 1.0) tracing the absolute outer boundary of the stitches.
- "radius": The maximum distance from the center to the edge of this round.
- "smooth lines" that based on points and radius try to draw a smooth lines (usually circle or square or simple but smooth lines) to draw the edges of the round to cover the whole round stitchs.

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

      const landmarks: CrochetLandmark[] = Array.isArray(parsed.landmarks)
        ? parsed.landmarks.filter(
            (l: unknown): l is CrochetLandmark =>
              l !== null &&
              typeof l === "object" &&
              typeof (l as CrochetLandmark).rowNumber === "number",
          )
        : [];
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
