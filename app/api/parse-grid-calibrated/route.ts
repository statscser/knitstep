import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GridData } from "../../lib/types";

// ─── Model fallback list ──────────────────────────────────────────────────────
const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
] as const;

// ─── Schema validation ────────────────────────────────────────────────────────
function validateGridData(obj: unknown): obj is GridData {
  if (!obj || typeof obj !== "object") return false;
  const g = obj as Record<string, unknown>;
  return (
    typeof g.totalRows     === "number" && g.totalRows     > 0 &&
    typeof g.totalStitches === "number" && g.totalStitches > 0 &&
    Array.isArray(g.rows)  && (g.rows as unknown[]).length > 0 &&
    typeof g.legend === "object" && g.legend !== null
  );
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
function buildPrompt(rows: number, stitches: number): string {
  return `You are a professional knitting chart digitization expert.

You are provided with ${rows} image strips in sequence. Each strip is a single horizontal row of a knitting chart containing exactly ${stitches} cells from left to right.

**Strip ordering**: Strip 1 in the sequence = Row 1 of the chart (BOTTOM-most row). Strip ${rows} = Row ${rows} (TOP-most row).

## RULES FOR EACH CELL

- **s**: The visual symbol exactly as it appears (e.g. "○", "/", "\\", "V", "X", "⋈"). Use "" for a plain/knit cell. NEVER use text words like "knit", "purl", "yo".
- **c**: Dominant hex color "#RRGGBB" of the cell's background. Use "" for white or uncolored cells.
- **u**: true only if the cell content is genuinely ambiguous; false otherwise.
- **Cable spans**: If a symbol visually spans N cells, use {"s":"<symbol>","span":N} for the first cell and {"s":"span-continuation"} for each of the remaining N-1 covered cells.

## CONSTRAINTS

- Each row MUST have EXACTLY ${stitches} cells (including any span-continuation placeholders).
- totalRows MUST equal ${rows}.
- Anti-confetti: report the dominant color per cell, not random pixel noise.

## OUTPUT

Return ONLY valid JSON — no markdown fences, no explanation:

{"confidence":<int 0-100>,"analysisReport":"<brief description in Chinese>","data":{"totalRows":${rows},"totalStitches":${stitches},"colors":{},"rows":[{"rowNumber":1,"type":"RS","cells":[{"s":"","c":"","u":false},...]},...], "legend":{"<sym>":"<meaning>"}}}

CRITICAL: Return ONLY the JSON object. No markdown. No extra text.`;
}

// ─── Route handler ────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let body: {
    rowImages: string[];          // base64 PNG, index 0 = Row 1 = bottom-most strip
    rows: number;
    stitches: number;
    accessCode?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const { rowImages, rows, stitches } = body;

  if (!Array.isArray(rowImages) || rowImages.length === 0) {
    return NextResponse.json({ error: "MISSING_ROW_IMAGES" }, { status: 400 });
  }
  if (!rows || !stitches) {
    return NextResponse.json({ error: "MISSING_DIMENSIONS" }, { status: 400 });
  }

  const prompt = buildPrompt(rows, stitches);
  const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  let lastError: Error | null = null;

  for (const modelName of MODELS_TO_TRY) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 0; attempt < 2; attempt++) {
      const retryNote = attempt > 0
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError?.message ?? "invalid JSON"}. Fix the output — valid JSON only, matching the schema exactly.`
        : "";

      // Each row strip is a separate inline image part, followed by the text prompt
      const contents = [
        ...rowImages.map(base64 => ({
          inlineData: { mimeType: "image/png" as const, data: base64 },
        })),
        prompt + retryNote,
      ];

      console.log(`[CalibratedGridAI] model=${modelName} attempt=${attempt + 1} rows=${rows} stitches=${stitches}`);
      try {
        const result = await model.generateContent(contents);
        const raw    = result.response.text().trim();
        console.log(`[CalibratedGridAI] snippet: ${raw.slice(0, 300)}`);

        const cleaned   = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const jsonStart = cleaned.indexOf("{");
        const jsonEnd   = cleaned.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in response");

        const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));

        const confidence: number | undefined =
          typeof parsed.confidence === "number"
            ? Math.round(Math.max(0, Math.min(100, parsed.confidence)))
            : undefined;
        const analysisReport: string | undefined =
          typeof parsed.analysisReport === "string" ? parsed.analysisReport : undefined;

        const gridData = parsed.data ?? parsed;

        if (!validateGridData(gridData)) {
          throw new Error(`GRID_INVALID_SHAPE — keys: [${Object.keys(gridData ?? {}).join(", ")}]`);
        }

        if (confidence     !== undefined) gridData.confidence     = confidence;
        if (analysisReport !== undefined) gridData.analysisReport = analysisReport;

        // Sanitize row/stitch counts
        if (gridData.rows.length !== gridData.totalRows) {
          console.warn(`[CalibratedGridAI] totalRows mismatch declared=${gridData.totalRows} actual=${gridData.rows.length}`);
          gridData.totalRows = gridData.rows.length;
        }
        const N = gridData.totalStitches;
        for (const row of gridData.rows) {
          if (!Array.isArray(row.cells)) row.cells = [];
          while (row.cells.length < N) row.cells.push({ s: "", c: "" });
          if (row.cells.length > N)    row.cells = row.cells.slice(0, N);
        }

        console.log(`[CalibratedGridAI] rows=${gridData.totalRows} sts=${gridData.totalStitches} confidence=${confidence}`);
        return NextResponse.json({ type: "grid", data: gridData });

      } catch (err: unknown) {
        lastError      = err instanceof Error ? err : new Error(String(err));
        const anyErr   = err as { status?: number; response?: { status?: number }; message?: string };
        const status   = anyErr.status ?? anyErr.response?.status;
        const msgLower = (anyErr.message ?? "").toLowerCase();

        if (status === 413 || msgLower.includes("too large"))
          return NextResponse.json({ error: "FILE_TOO_LARGE" }, { status: 413 });
        if (status === 429 || msgLower.includes("429")) {
          console.warn(`[CalibratedGridAI] ${modelName} → 429`);
          break;
        }
        if (status === 404 || msgLower.includes("404")) {
          console.warn(`[CalibratedGridAI] ${modelName} → 404`);
          break;
        }
        console.warn(`[CalibratedGridAI] ${modelName} attempt ${attempt + 1} failed: ${lastError.message}`);
      }
    }
  }

  const msg          = lastError?.message ?? "All models failed";
  const wasRateLimit = msg.includes("429");
  return NextResponse.json(
    { error: wasRateLimit ? "QUOTA_EXCEEDED" : "GRID_PARSE_FAILED" },
    { status: wasRateLimit ? 429 : 500 },
  );
}
