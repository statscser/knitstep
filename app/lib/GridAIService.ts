import { GoogleGenerativeAI } from "@google/generative-ai";
import { PROMPT_GALLERY, DEFAULT_PROMPT_VERSION, type PromptVersion } from "./prompts";
import type { GridData } from "./types";
import { GEMINI_MODELS } from "./models";
import {
  classifyGeminiError,
  createBudget,
  logAI,
  newConversionId,
  timedGenerate,
} from "./server/aiTelemetry";

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
  cid: string = newConversionId(),
): Promise<GridData> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
  // Headroom under the route's 60s maxDuration; stops the 3-models × 2-attempts
  // waterfall from outliving the function and dying as an unlogged 504.
  const budget = createBudget(55_000);
  let lastError: any = null;

  outer:
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const modelName = GEMINI_MODELS[i];
    const model     = genAI.getGenerativeModel({ model: modelName });

    // Up to 2 attempts per model: first clean, second with error context
    for (let attempt = 0; attempt < 2; attempt++) {
      if (budget.exhausted()) {
        logAI(cid, "budget_exhausted", { model: modelName, attempt: attempt + 1 });
        break outer;
      }
      const retryNote = attempt > 0
        ? `\n\nPREVIOUS ATTEMPT FAILED: ${lastError?.message ?? "invalid JSON"}. Ensure your response is valid JSON matching the required schema exactly.`
        : "";

      const contents = [
        ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        getGridPrompt(version) + retryNote,
      ];

      try {
        const raw = await timedGenerate(model, contents, {
          cid,
          modelName,
          attempt: attempt + 1,
          timeoutMs: budget.callTimeout(),
        });

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
          logAI(cid, "grid_rows_mismatch", {
            declared: gridData.totalRows,
            actual: actualRowCount,
          });
          gridData.totalRows = actualRowCount;
        }
        const N = gridData.totalStitches;
        for (const row of gridData.rows) {
          if (!Array.isArray(row.cells)) row.cells = [];
          while (row.cells.length < N) row.cells.push({ s: "", c: "" });
          if (row.cells.length > N)    row.cells = row.cells.slice(0, N);
        }

        // Debug: log first two rows so color mis-mapping is visible in server logs
        logAI(cid, "grid_ok", {
          model: modelName,
          rows: gridData.totalRows,
          stitches: gridData.totalStitches,
          confidence,
          row1: JSON.stringify(gridData.rows[0]?.cells?.slice(0, 6)),
          row2: JSON.stringify(gridData.rows[1]?.cells?.slice(0, 6)),
        });

        return gridData as GridData;

      } catch (err: any) {
        lastError = err;
        const { kind, message } = classifyGeminiError(err);

        // Validation / JSON-parse failures aren't logged by timedGenerate.
        // SDK errors embed "GoogleGenerativeAI" in the message.
        if (kind === "other" && !message.includes("GoogleGenerativeAI")) {
          logAI(cid, "response_invalid", {
            model: modelName,
            attempt: attempt + 1,
            message: message.slice(0, 300),
          });
        }

        if (kind === "payload_too_large") throw new Error("FILE_TOO_LARGE");
        // Rate-limited or missing model: retrying the same model is pointless
        if (kind === "rate_limit" || kind === "not_found") break;
      }
    }
  }

  logAI(cid, "all_models_failed", { route: "grid" });
  const wasRateLimit = classifyGeminiError(lastError).kind === "rate_limit";
  throw new Error(wasRateLimit ? "QUOTA_EXCEEDED" : "GRID_PARSE_FAILED");
}