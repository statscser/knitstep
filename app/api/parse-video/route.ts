import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  logAI,
  newConversionId,
  timedGenerate,
} from "../../lib/server/aiTelemetry";

// Must cover both stages: transcription, then an internal fetch to /api/parse
// (which itself can now take up to ~180s).
export const maxDuration = 240;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL_NAME = "gemini-3-flash-preview";
// ── VIDEO_TO_TEXT_PROMPT ──────────────────────────────────────────────────────
// Role: crochet/knitting expert video transcriber.
// Goal: Listen to audio + OCR text overlays → output clean raw pattern text.
// This raw text is then piped into the existing text parsing pipeline.
const VIDEO_TO_TEXT_PROMPT = `You are a professional knitting and crochet pattern transcription expert.
Watch this video carefully and extract ALL pattern instructions as raw text.

[TASK]:
1. Listen to all spoken instructions and transcribe them in order.
2. Read any text overlays, on-screen captions, stitch counts, or pattern notes shown in the video.
3. Write each instruction on its own line, preserving exact row/round labels.
4. Do NOT summarize — capture every step mentioned, even if repeated.
5. Ignore non-pattern content (greetings, product links, sponsorships, commentary).

[OUTPUT FORMAT — CRITICAL]:
Return ONLY raw pattern text. No JSON. No markdown. No explanations.
Each instruction on its own line in standard knitting/crochet notation.
Include row/round labels exactly as spoken or shown.

Example output:
Cast on 40 sts
Row 1 (RS): K all
Row 2 (WS): P all
Repeat Rows 1-2 for 20 rows
BO all sts`;

export async function POST(request: NextRequest) {
  const cid = newConversionId();

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json(
      { error: "API_KEY_MISSING", conversionId: cid },
      { status: 500 },
    );
  }

  try {
    const { videoUrl, language } = await request.json();

    if (!videoUrl?.trim()) {
      return NextResponse.json(
        { error: "NO_VIDEO_INPUT", conversionId: cid },
        { status: 400 },
      );
    }

    logAI(cid, "request", { route: "parse-video" });
    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Pass YouTube URL directly — Gemini 2.5 Flash processes it natively.
    // The TypeScript type requires mimeType but the API accepts YouTube URLs
    // without it; casting to bypass the type constraint.
    // Timeout: transcription is stage 1 of 2 — capped well under maxDuration
    // so stage 2 (text parsing, itself now up to ~180s) still has room to run.
    const rawText = await timedGenerate(
      model,
      [
        { fileData: { fileUri: videoUrl.trim() } } as any,
        VIDEO_TO_TEXT_PROMPT,
      ],
      { cid, modelName: MODEL_NAME, timeoutMs: 60_000 },
    );

    if (!rawText) {
      logAI(cid, "transcript_empty", {});
      return NextResponse.json(
        { error: "NO_TEXT_EXTRACTED", conversionId: cid },
        { status: 422 },
      );
    }

    // ── Pipe raw text into the existing text parsing pipeline ─────────────────
    const host     = request.headers.get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const parseRes = await fetch(`${protocol}://${host}/api/parse`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text: rawText, language }),
    });
    const parseData = await parseRes.json();
    logAI(cid, "parse_stage_done", {
      status: parseRes.status,
      parseCid: parseData?.conversionId,
    });
    return NextResponse.json(
      { ...parseData, conversionId: cid },
      { status: parseRes.status },
    );

  } catch (err: any) {
    const msg    = err?.message ?? "UNKNOWN_ERROR";
    const status = msg === "QUOTA_EXCEEDED" ? 429 : 500;
    logAI(cid, "request_failed", { route: "parse-video", error: msg, status });
    return NextResponse.json({ error: msg, conversionId: cid }, { status });
  }
}
