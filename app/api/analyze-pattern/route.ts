import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

function buildPrompt(rows: number, stitches: number): string {
  return `You are a knitting chart analyzer. This chart has approximately ${rows} rows × ${stitches} stitches.

Your job is ONLY to identify:
1. The symbol legend (if a key/legend is visible in the image — symbols and their meanings)
2. Colors (if this is a colorwork chart — dominant yarn colors as hex codes)
3. A brief description of the chart

Do NOT analyze individual cells. Do NOT describe each row. Do NOT output any grid data.

Return ONLY valid JSON — no markdown, no explanation:
{"legend":{"<symbol>":"<meaning>"},"colors":{"<colorName>":"#rrggbb"},"analysisReport":"<1-2 sentence description in Chinese>"}

If no legend is visible, use {}. If no colorwork, use {}. CRITICAL: Return ONLY the JSON object.`;
}

export async function POST(req: NextRequest) {
  let body: { imageBase64: string; rows: number; stitches: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const { imageBase64, rows, stitches } = body;
  if (!imageBase64) return NextResponse.json({ error: "MISSING_IMAGE" }, { status: 400 });

  const prompt = buildPrompt(rows ?? 1, stitches ?? 1);
  const genAI  = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

  for (const modelName of MODELS_TO_TRY) {
    const model = genAI.getGenerativeModel({ model: modelName });
    try {
      console.log(`[AnalyzePattern] model=${modelName}`);
      const result = await model.generateContent([
        { inlineData: { mimeType: "image/png" as const, data: imageBase64 } },
        prompt,
      ]);
      const raw     = result.response.text().trim();
      const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const start   = cleaned.indexOf("{");
      const end     = cleaned.lastIndexOf("}");
      if (start === -1 || end === -1) continue;

      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return NextResponse.json({
        legend:         typeof parsed.legend  === "object" && parsed.legend  !== null ? parsed.legend  : {},
        colors:         typeof parsed.colors  === "object" && parsed.colors  !== null ? parsed.colors  : {},
        analysisReport: typeof parsed.analysisReport === "string" ? parsed.analysisReport : "",
      });
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "";
      if (msg.includes("429") || msg.includes("404")) break;
      continue;
    }
  }

  // Silent fallback — caller ignores errors gracefully
  return NextResponse.json({ legend: {}, colors: {}, analysisReport: "" });
}
