// Server-side helpers shared by all AI conversion routes:
//   - conversion IDs that thread through logs and error responses
//   - structured single-line JSON logs (queryable in Vercel log drains)
//   - per-call timeouts so a hung Gemini request fails over to the next model
//     instead of eating the whole serverless function budget
//   - a per-request time budget so sequential fallback attempts never outlive
//     the route's maxDuration (which would die as an unlogged platform 504)

import type { GenerativeModel, Part } from "@google/generative-ai";

/** Default per-call timeout. A healthy Flash response lands well under this. */
export const AI_CALL_TIMEOUT_MS = 35_000;

export function newConversionId(): string {
  // Short id — easy for a user to read off an error message and report.
  return crypto.randomUUID().slice(0, 8);
}

export function logAI(
  conversionId: string,
  stage: string,
  data: Record<string, unknown> = {},
): void {
  console.log(
    JSON.stringify({ src: "ai", cid: conversionId, stage, ...data }),
  );
}

// ─── Error classification ─────────────────────────────────────────────────────
// The Gemini SDK doesn't expose structured error codes, so classification is
// string-based. Centralized here so a wording change in the SDK only needs
// fixing in one place.

export type GeminiErrorKind =
  | "timeout"
  | "rate_limit"
  | "not_found"
  | "payload_too_large"
  | "other";

export function classifyGeminiError(err: unknown): {
  kind: GeminiErrorKind;
  status: number | string;
  message: string;
} {
  const e = err as {
    name?: string;
    status?: number;
    response?: { status?: number; data?: unknown };
    message?: string;
    errorDetails?: unknown;
  };
  const status = e?.status ?? e?.response?.status ?? "unknown";
  const message = e?.message ?? String(err);
  const haystack = (
    message + JSON.stringify(e?.errorDetails ?? e?.response?.data ?? "")
  ).toLowerCase();

  let kind: GeminiErrorKind = "other";
  if (
    e?.name === "GoogleGenerativeAIAbortError" ||
    haystack.includes("abort") ||
    haystack.includes("timed out") ||
    haystack.includes("timeout")
  ) {
    kind = "timeout";
  } else if (status === 429 || haystack.includes("429")) {
    kind = "rate_limit";
  } else if (status === 404 || haystack.includes("404")) {
    kind = "not_found";
  } else if (
    status === 413 ||
    haystack.includes("payload size") ||
    haystack.includes("too large") ||
    haystack.includes("exceeds the limit") ||
    haystack.includes("request entity too large")
  ) {
    kind = "payload_too_large";
  }

  return { kind, status, message };
}

// ─── Time budget ──────────────────────────────────────────────────────────────

export interface TimeBudget {
  remainingMs(): number;
  /** Timeout to give the next call: the preferred value, capped by what's left. */
  callTimeout(preferredMs?: number): number;
  /** True when there isn't enough time left to be worth starting another call. */
  exhausted(minMs?: number): boolean;
}

export function createBudget(totalMs: number): TimeBudget {
  const deadline = Date.now() + totalMs;
  return {
    remainingMs: () => deadline - Date.now(),
    callTimeout: (preferredMs = AI_CALL_TIMEOUT_MS) =>
      Math.max(1, Math.min(preferredMs, deadline - Date.now())),
    exhausted: (minMs = 3_000) => deadline - Date.now() < minMs,
  };
}

// ─── Timed generateContent wrapper ────────────────────────────────────────────

/**
 * Runs model.generateContent with a hard timeout, logging the attempt's
 * duration and outcome. Returns the raw response text on success; rethrows
 * the original error (after logging its classification) on failure.
 */
export async function timedGenerate(
  model: GenerativeModel,
  contents: Array<string | Part> | string,
  opts: {
    cid: string;
    modelName: string;
    attempt?: number;
    timeoutMs: number;
  },
): Promise<string> {
  const { cid, modelName, attempt = 1, timeoutMs } = opts;
  const started = Date.now();
  logAI(cid, "model_call", { model: modelName, attempt, timeoutMs });
  try {
    const result = await model.generateContent(contents, { timeout: timeoutMs });
    const raw = result.response.text().trim();
    logAI(cid, "model_ok", {
      model: modelName,
      attempt,
      ms: Date.now() - started,
      chars: raw.length,
    });
    return raw;
  } catch (err) {
    const { kind, status, message } = classifyGeminiError(err);
    logAI(cid, "model_fail", {
      model: modelName,
      attempt,
      ms: Date.now() - started,
      kind,
      status,
      message: message.slice(0, 300),
    });
    throw err;
  }
}
