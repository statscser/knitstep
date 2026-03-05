import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL_NAME = "gemini-2.5-flash";
const VALID_CODE = process.env.ACCESS_CODE ?? "KNITSTEPBYSTEP";

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
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "API_KEY_MISSING" }, { status: 500 });
  }

  try {
    const { videoUrl, language, accessCode } = await request.json();

    if (accessCode !== VALID_CODE) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (!videoUrl?.trim()) {
      return NextResponse.json({ error: "NO_VIDEO_INPUT" }, { status: 400 });
    }

    const model = genAI.getGenerativeModel({ model: MODEL_NAME });

    // Pass YouTube URL directly — Gemini 2.5 Flash processes it natively.
    // The TypeScript type requires mimeType but the API accepts YouTube URLs
    // without it; casting to bypass the type constraint.
    const result = await model.generateContent([
      { fileData: { fileUri: videoUrl.trim() } } as any,
      VIDEO_TO_TEXT_PROMPT,
    ]);
    const rawText = result.response.text().trim();

    if (!rawText) {
      return NextResponse.json({ error: "NO_TEXT_EXTRACTED" }, { status: 422 });
    }

    // ── Pipe raw text into the existing text parsing pipeline ─────────────────
    const host     = request.headers.get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    const parseRes = await fetch(`${protocol}://${host}/api/parse`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ text: rawText, language, accessCode: VALID_CODE }),
    });
    const parseData = await parseRes.json();
    return NextResponse.json(parseData, { status: parseRes.status });

  } catch (err: any) {
    const msg    = err?.message ?? "UNKNOWN_ERROR";
    const status = msg === "QUOTA_EXCEEDED" ? 429 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
