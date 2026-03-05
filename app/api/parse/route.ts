import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const MODEL_NAME = "gemini-2.5-flash";

let inFlight = false;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ParsedStep = { text: string; original?: string; isHeader?: boolean };

function flattenSteps(items: any[]): ParsedStep[] {
  const result: ParsedStep[] = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...flattenSteps(item));
    } else if (item && typeof item === "object") {
      if (typeof item.text === "string" && item.text.trim()) {
        const step: ParsedStep = { text: item.text.trim() };
        if (item.original != null) step.original = String(item.original);
        if (item.isHeader === true) step.isHeader = true;
        result.push(step);
      }
      const subKeys = ["steps", "sub_steps", "subSteps", "substeps", "children", "instructions", "rows"];
      for (const key of subKeys) {
        if (Array.isArray(item[key]) && item[key].length > 0) {
          result.push(...flattenSteps(item[key]));
        }
      }
    }
  }
  return result;
}

async function runGemini(
  text: string,
  language: "zh" | "en",
  retryCount: number,
  images?: { base64: string; mimeType: string }[],
): Promise<ParsedStep[]> {
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const hasImages = images && images.length > 0;
  const isMulti   = hasImages && images!.length > 1;

  // Prepended only when multiple images are supplied
  const multiHeader = isMulti
    ? (language === "zh"
        ? "注意：以下提供了多张图片，它们是同一编织图解的连续部分。请按顺序分析所有图片，合并信息，生成一份连贯的、不重复的完整步骤清单。\n\n"
        : "Note: You are provided with multiple images that represent sequential parts of a single knitting/crochet pattern. Please analyze them in order, merge the information, and produce one continuous, logical checklist without duplicating steps that might overlap between images.\n\n")
    : "";

  const prompt =
    multiHeader +
    (language === "zh"
      ? `你是一位专业的编织翻译专家。请${hasImages ? "分析这张编织图解图片，提取所有步骤并" : "将以下英文图解"}转换为中文步骤清单。

       【内容过滤】：
       自动跳过以下说明性内容，不要将其转为步骤：尺寸 (Size)、材料/用线 (Materials/Yarn)、工具/建议用针 (Tools/Needles)、密度 (Gauge/Tension)。
       只保留与实际编织操作相关的内容。

       【核心准则】：
       1. 必须保留原始行号标签（例如 "Row 5:" 或 "R5" 翻译为 "第5行:"）。
       2. 翻译要专业，同时在括号中保留关键术语（例如：空针 (yo), 左上二并一 (k2tog), 引返 (short row), 加针 (M1)）。
       3. 严禁自行发明或修改针法逻辑，必须忠实于原稿。
       4. 如果原文明确写出了行数范围（如 Rows 1-4），请写为 "第1-4行: [重复动作]"。如果原文说 "for the next N rows"，请写为 "接下来的N行: [重复动作]"，不要展开为具体行数。
       5. 引返针法（短行/short rows）请按顺序逐步平铺，每一步作为独立的一行文字，不得嵌套。
       6. 章节标题（如"后片"、"袖子"、"领口"等逻辑分段）：单独作为一个步骤，设置 "isHeader": true，text 字段填写标题文字（不加任何前缀），不带行号。

       【返回格式 — 极其重要】：
       只返回一个 JSON 对象，其中 steps 是一个【严格扁平的一维数组】，所有步骤和标题行处于同一层级，严禁嵌套。
       普通步骤字段："text"（字符串）、可选的 "original"（字符串）。
       标题行字段："text"（字符串）、"isHeader": true。
       绝对禁止：嵌套数组、sub_steps、children、rows 或任何递归结构。
       text 字段只放中文翻译，original 字段只放英文原稿，两个字段分开，不要混合。
       如果原文本身已经是中文，则不需要 original 字段，只返回 text 字段即可。
       正确示例：{"steps":[{"text":"后片","isHeader":true},{"text":"第1行: 下针到底","original":"Row 1: knit all"},{"text":"袖子","isHeader":true},{"text":"第2行: 上针到底","original":"Row 2: purl all"}]}
       ${hasImages ? "" : `\n       图解文本如下：\n       ${text}`}`
      : `You are a professional knitting pattern parser.
       ${hasImages ? "Analyze the knitting pattern image(s) and extract all instructions" : "Parse the following knitting pattern text"} into clear, actionable checklist steps.

       [CONTENT FILTERING]:
       Skip all non-instruction content: Size, Materials/Yarn, Tools/Needles, Gauge/Tension sections.
       Only include content related to actual knitting operations.

       [RULES]:
       1. Extract ALL instructions in document order — including cast-on, bind-off, setup rows, short rows, increases, decreases, and section transitions.
       2. Keep existing row labels if present (e.g., "Row 5:", "R3:"). If none exist, write a concise step description.
       3. For a block like "for the next N rows: do X", keep it as ONE step using the original phrasing. Do NOT expand into individual row numbers.
       4. Do NOT skip or omit any instruction, even if it lacks a row label.
       5. Section headings (e.g., "Back", "Sleeve", "Neckline", "Body") that mark a logical new phase: output as a single step with "isHeader": true. Put the heading text in the "text" field with no prefix or decoration.
       6. ONLY use the ${hasImages ? "image(s)" : "pattern text below"}. Do NOT invent any steps.

       [OUTPUT FORMAT — CRITICAL]:
       Return a single JSON object where "steps" is a STRICTLY FLAT one-dimensional array. All steps and headers are at the same level — no nesting.
       Regular step fields: "text" (string), optional "original" (string).
       Header step fields: "text" (string), "isHeader": true.
       NEVER use nested arrays, sub_steps, children, rows, or any recursive structure.
       Correct example: {"steps":[{"text":"Back","isHeader":true},{"text":"Cast on 80 sts"},{"text":"Row 1: knit all"},{"text":"Sleeve","isHeader":true},{"text":"Pick up 40 sts"}]}
       ${hasImages ? "" : `\n       Pattern:\n       ${text}`}`);

  const contents = hasImages
    ? [
        ...images!.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        prompt,
      ]
    : prompt;

  try {
    const result = await model.generateContent(contents);
    const raw = result.response.text().trim();
    const jsonStart = raw.indexOf("{");
    const jsonEnd = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return flattenSteps(parsed.steps ?? []);
  } catch (error: any) {
    const httpStatus = error.status ?? error.response?.status ?? "unknown";
    const errMessage = error.message ?? "";
    const errDetails = error.errorDetails ?? error.response?.data ?? null;
    const msgLower = errMessage.toLowerCase() + JSON.stringify(errDetails ?? "").toLowerCase();

    const violations = (errDetails ?? []).flatMap((d: any) => d.violations ?? []);
    const isDailyQuota = violations.some((v: any) =>
      (v.quotaId ?? "").toLowerCase().includes("perday"),
    );

    const retryInfo = (errDetails ?? []).find((d: any) =>
      (d["@type"] ?? "").includes("RetryInfo"),
    );
    const apiDelaySec = retryInfo?.retryDelay ? parseInt(retryInfo.retryDelay) : null;

    const isPayloadTooLarge =
      httpStatus === 413 ||
      msgLower.includes("payload size") ||
      msgLower.includes("too large") ||
      msgLower.includes("exceeds the limit") ||
      msgLower.includes("request entity too large");
    if (isPayloadTooLarge) throw new Error("FILE_TOO_LARGE");

    const is429 = httpStatus === 429 || errMessage.includes("429");
    if (is429 && !isDailyQuota && retryCount < 3) {
      const wait = apiDelaySec != null ? apiDelaySec * 1000 : Math.pow(2, retryCount + 1) * 1000;
      await sleep(wait);
      return runGemini(text, language, retryCount + 1, images);
    }

    throw new Error(is429 ? "QUOTA_EXCEEDED" : "UNKNOWN_ERROR");
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "API_KEY_MISSING" }, { status: 500 });
  }

  if (inFlight) {
    return NextResponse.json({ error: "UNKNOWN_ERROR" }, { status: 429 });
  }
  inFlight = true;

  try {
    const body = await request.json();
    const { text, language, images, accessCode } = body as {
      text: string;
      language: "zh" | "en";
      images?: { base64: string; mimeType: string }[];
      accessCode?: string;
    };

    const VALID_CODE = process.env.ACCESS_CODE ?? "KNITSTEPBYSTEP";
    if (accessCode !== VALID_CODE) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    const steps = await runGemini(text, language, 0, images);
    return NextResponse.json({ steps });
  } catch (err: any) {
    const msg = err?.message ?? "UNKNOWN_ERROR";
    const status = msg === "QUOTA_EXCEEDED" ? 429 : msg === "FILE_TOO_LARGE" ? 413 : 500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    inFlight = false;
  }
}
