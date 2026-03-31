import { GoogleGenerativeAI } from "@google/generative-ai";
import { PROMPT_GALLERY, DEFAULT_PROMPT_VERSION, type PromptVersion } from "./prompts";
import type { GridData } from "./types";

// ─── Gemini model fallback list ───────────────────────────────────────────────
const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
] as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateGridData(obj: any): obj is GridData {
  return (
    obj !== null &&
    typeof obj === "object" &&
    typeof obj.totalRows     === "number" && obj.totalRows     > 0 &&
    typeof obj.totalStitches === "number" && obj.totalStitches > 0 &&
    Array.isArray(obj.rows) && obj.rows.length > 0 &&
    typeof obj.legend === "object" && obj.legend !== null
  );
}

function getGridPrompt(version: string): string {
  const config = PROMPT_GALLERY[version as PromptVersion] ?? PROMPT_GALLERY[DEFAULT_PROMPT_VERSION];
  return config.systemPrompt;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type ImagePayload = { base64: string; mimeType: string };

/**
 * Calls Gemini with the given images and prompt version, returning a validated
 * and sanitized GridData object. Retries across multiple models with one
 * error-context retry per model.
 *
 * @throws "FILE_TOO_LARGE" | "QUOTA_EXCEEDED" | "GRID_PARSE_FAILED"
 */
export async function parseGridFromImages(
  images: ImagePayload[],
  version: string = DEFAULT_PROMPT_VERSION,
): Promise<GridData> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  let lastError: any = null;

  for (let i = 0; i < MODELS_TO_TRY.length; i++) {
    const modelName = MODELS_TO_TRY[i];
    const model     = genAI.getGenerativeModel({ model: modelName });

    // Up to 2 attempts per model: first clean, second with error context
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryNote = attempt > 0
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError?.message ?? "invalid JSON"}. Ensure your response is valid JSON matching the required schema exactly.`
        : "";

      const contents = [
        ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        getGridPrompt(version) + retryNote,
      ];

      console.log(`[GridAI] model=${modelName} attempt=${attempt + 1}`);
      try {
        const result = await model.generateContent(contents);
        const raw    = result.response.text().trim();
        console.log(`[GridAI] snippet: ${raw.slice(0, 300)}`);

        // Strip markdown fences if the model added them despite instructions
        const cleaned   = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const jsonStart = cleaned.indexOf("{");
        const jsonEnd   = cleaned.lastIndexOf("}");
        if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in response");

        const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));

        // Extract confidence / analysisReport from the top-level envelope
        const confidence: number | undefined = typeof parsed.confidence === "number"
          ? Math.round(Math.max(0, Math.min(100, parsed.confidence)))
          : undefined;
        const analysisReport: string | undefined = typeof parsed.analysisReport === "string"
          ? parsed.analysisReport
          : undefined;

        // Accept { confidence, data:{...} }, { type:"grid", data:{...} }, or bare GridData
        const gridData = parsed.data ?? parsed;

        if (!validateGridData(gridData)) {
          throw new Error(
            `GRID_INVALID_SHAPE — got keys: [${Object.keys(gridData ?? {}).join(", ")}]`,
          );
        }

        if (confidence     !== undefined) gridData.confidence     = confidence;
        if (analysisReport !== undefined) gridData.analysisReport = analysisReport;

        // ── Sanitize: fix totalRows/totalStitches mismatches so canvas is complete ──
        const actualRowCount = gridData.rows.length;
        if (actualRowCount !== gridData.totalRows) {
          console.warn(
            `[GridAI] totalRows mismatch: declared=${gridData.totalRows} actual=${actualRowCount} — correcting`,
          );
          gridData.totalRows = actualRowCount;
        }
        const N = gridData.totalStitches;
        for (const row of gridData.rows) {
          if (!Array.isArray(row.cells)) row.cells = [];
          while (row.cells.length < N) row.cells.push({ s: "", c: "" });
          if (row.cells.length > N)    row.cells = row.cells.slice(0, N);
        }

        // Debug: log first two rows so color mis-mapping is visible in server logs
        console.log(`[GridAI] rows=${gridData.totalRows} sts=${gridData.totalStitches} confidence=${confidence}`);
        console.log(`[GridAI] row1 cells:`, JSON.stringify(gridData.rows[0]?.cells?.slice(0, 6)));
        if (gridData.rows[1]) {
          console.log(`[GridAI] row2 cells:`, JSON.stringify(gridData.rows[1]?.cells?.slice(0, 6)));
        }

        return gridData as GridData;

      } catch (err: any) {
        lastError      = err;
        const status   = err.status ?? err.response?.status ?? "unknown";
        const msgLower = (err.message ?? "").toLowerCase();

        if (status === 413 || msgLower.includes("too large"))            throw new Error("FILE_TOO_LARGE");
        if (status === 429 || msgLower.includes("429")) { console.warn(`[GridAI] ${modelName} → 429`); break; }
        if (status === 404 || msgLower.includes("404")) { console.warn(`[GridAI] ${modelName} → 404`); break; }

        console.warn(`[GridAI] ${modelName} attempt ${attempt + 1} failed: ${err.message}`);
      }
    }
  }

  const msg          = lastError?.message ?? "All models failed";
  const wasRateLimit = (lastError?.status ?? lastError?.response?.status) === 429 || msg.includes("429");
  throw new Error(wasRateLimit ? "QUOTA_EXCEEDED" : "GRID_PARSE_FAILED");
}