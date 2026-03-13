import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const MODELS_TO_TRY = [
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
] as const;

let inFlight = false;

type ParsedStep = {
  text: string;
  original?: string;
  isHeader?: boolean;
  sizeMap?: Record<string, string>;
  sourceBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0-1000
  sourceFileIndex?: number;
};

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
        if (
          item.sizeMap &&
          typeof item.sizeMap === "object" &&
          !Array.isArray(item.sizeMap)
        ) {
          step.sizeMap = item.sizeMap as Record<string, string>;
        }
        // Visual grounding coords — validate shape before accepting
        if (
          Array.isArray(item.sourceBox) &&
          item.sourceBox.length === 4 &&
          item.sourceBox.every((v: unknown) => typeof v === "number" && isFinite(v))
        ) {
          step.sourceBox = item.sourceBox as [number, number, number, number];
        }
        if (typeof item.sourceFileIndex === "number" && isFinite(item.sourceFileIndex)) {
          step.sourceFileIndex = Math.max(0, Math.floor(item.sourceFileIndex));
        }
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
  images?: { base64: string; mimeType: string }[],
): Promise<ParsedStep[]> {
  const hasImages = images && images.length > 0;
  const isMulti   = hasImages && images!.length > 1;

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
       自动跳过以下说明性内容，不要将其转为步骤：材料/用线 (Materials/Yarn)、工具/建议用针 (Tools/Needles)、密度 (Gauge/Tension)。
       例外：保留尺码声明行（如"适用尺码：S、M、L"或"Sizes: XS (S, M, L)"），用于智能尺码识别，但不将其输出为步骤。
       只保留与实际编织操作相关的内容。

       【核心准则】：
       1. 必须保留原始行号标签（例如 "Row 5:" 或 "R5" 翻译为 "第5行:"）。
       2. 翻译要专业，同时在括号中保留关键术语（例如：空针 (yo), 左上二并一 (k2tog), 引返 (short row), 加针 (M1)）。
       3. 严禁自行发明或修改针法逻辑，必须忠实于原稿。
       4. 如果原文明确写出了行数范围（如 Rows 1-4），请写为 "第1-4行: [重复动作]"。如果原文说 "for the next N rows"，请写为 "接下来的N行: [重复动作]"，不要展开为具体行数。
       5. 引返针法（短行/short rows）请按顺序逐步平铺，每一步作为独立的一行文字，不得嵌套。
       6. 章节标题（如"后片"、"袖子"、"领口"等逻辑分段）：单独作为一个步骤，设置 "isHeader": true，text 字段填写标题文字（不加任何前缀），不带行号。

       【智能尺码 — Smart Sizing】：
       部分图解使用括号标注多尺码，例如"起 80 (90, 100) 针"对应 S (M, L) 码。
       如果图解包含多尺码：
       1. 从页眉或说明中识别尺码顺序和标签（例如 "S (M, L)" 或 "36 (38, 40)"）。
       2. 对每个含括号尺码数字的步骤，添加 "sizeMap" 字段：键为尺码标签，值为该步骤仅替换为该尺码数字的完整文字。
          示例：text: "起 80 (90, 100) 针", sizeMap: {"S": "起 80 针", "M": "起 90 针", "L": "起 100 针"}
       3. 无尺码变化的步骤（标题行、无括号数字的步骤）省略 "sizeMap" 字段。

       【返回格式 — 极其重要】：
       只返回一个 JSON 对象，其中 steps 是一个【严格扁平的一维数组】，所有步骤和标题行处于同一层级，严禁嵌套。
       普通步骤字段："text"（字符串）、可选的 "original"（字符串）、可选的 "sizeMap"（对象）。
       标题行字段："text"（字符串）、"isHeader": true。
       绝对禁止：嵌套数组、sub_steps、children、rows 或任何递归结构。
       text 字段只放中文翻译，original 字段只放英文原稿，两个字段分开，不要混合。
       如果原文本身已经是中文，则不需要 original 字段，只返回 text 字段即可。
       ${hasImages ? `【视觉定位 — 必须执行】：
       对每个步骤，使用视觉定位标注其在输入图片中的精确位置。
       "sourceBox" 字段：归一化坐标数组 [ymin, xmin, ymax, xmax]，取值范围 0-1000。横向覆盖整列文字宽度（全宽图解的 xmin 接近 0，xmax 接近 1000）。
       "sourceFileIndex" 字段：该步骤来自第几张图片（从 0 开始计数）。
       如确实无法定位，可省略这两个字段（将被视为 undefined 处理）。
       【视觉定位精准度协议】：
       1. 紧凑边界框：sourceBox 必须紧紧包裹对应的文字行或图表图标，避免多余边距。
       2. 垂直对齐：ymin 严格对齐文字顶部，ymax 严格对齐文字底部（基线）。
       3. 防偏移校准：对于较长的图片，请仔细校准 0-1000 的纵向比例。若步骤在图片最底部，其 ymax 应接近 1000。
       4. 索引完整性：提供多张图片时，仔细确认 sourceFileIndex（从 0 开始）。
       正确示例：{"steps":[{"text":"后片","isHeader":true},{"text":"第1行: 下针到底","original":"Row 1: knit all","sourceBox":[120,80,200,920],"sourceFileIndex":0}]}` :
       `正确示例：{"steps":[{"text":"后片","isHeader":true},{"text":"第1行: 下针到底","original":"Row 1: knit all"},{"text":"袖子","isHeader":true},{"text":"第2行: 上针到底","original":"Row 2: purl all"}]}`}
       ${hasImages ? "" : `\n       图解文本如下：\n       ${text}`}`
      : `You are a professional knitting pattern parser.
       ${hasImages ? "Analyze the knitting pattern image(s) and extract all instructions" : "Parse the following knitting pattern text"} into clear, actionable checklist steps.

       [CONTENT FILTERING]:
       Skip non-instruction metadata: Materials/Yarn, Tools/Needles, Gauge/Tension sections.
       EXCEPTION: Keep any line that declares available sizes (e.g., "For sizes S, M, L" or "Size: XS (S, M, L)") — it is needed for Smart Sizing detection even though it is not a knitting step; use it to identify size labels, then omit it from the output steps.
       Only include content related to actual knitting operations.

       [RULES]:
       1. Extract ALL instructions in document order — including cast-on, bind-off, setup rows, short rows, increases, decreases, and section transitions.
       2. Keep existing row labels if present (e.g., "Row 5:", "R3:"). If none exist, write a concise step description.
       3. For a block like "for the next N rows: do X", keep it as ONE step using the original phrasing. Do NOT expand into individual row numbers.
       4. Do NOT skip or omit any instruction, even if it lacks a row label.
       5. Section headings (e.g., "Back", "Sleeve", "Neckline", "Body") that mark a logical new phase: output as a single step with "isHeader": true. Put the heading text in the "text" field with no prefix or decoration.
       6. ONLY use the ${hasImages ? "image(s)" : "pattern text below"}. Do NOT invent any steps.

       [SMART SIZING]:
       Many patterns list stitch counts for multiple sizes in parentheses, e.g., "Cast on 80 (90, 100) sts" for S (M, L).
       If the pattern contains multi-size variations:
       1. Identify the size order and labels from the pattern header (e.g., "S (M, L)" or "XS (S, M, L, XL)").
       2. For each step that contains parenthetical size numbers, add a "sizeMap" field: an object where each key is a size label and the value is the COMPLETE step text rewritten with ONLY that size's numbers substituted.
          Example: text: "Cast on 80 (90, 100) sts", sizeMap: {"S": "Cast on 80 sts", "M": "Cast on 90 sts", "L": "Cast on 100 sts"}
       3. For steps with no size variations (headers, steps without parenthetical numbers), omit the "sizeMap" field entirely.

       [OUTPUT FORMAT — CRITICAL]:
       Return a single JSON object where "steps" is a STRICTLY FLAT one-dimensional array. All steps and headers are at the same level — no nesting.
       Regular step fields: "text" (string), optional "original" (string), optional "sizeMap" (object).
       Header step fields: "text" (string), "isHeader": true.
       NEVER use nested arrays, sub_steps, children, rows, or any recursive structure.
       ${hasImages ? `[VISUAL GROUNDING — REQUIRED FOR IMAGE INPUT]:
       For every step you generate, use visual grounding to identify its exact location in the source image.
       "sourceBox": a normalized bounding box array [ymin, xmin, ymax, xmax] where all values are integers from 0 to 1000. Cover the full text column width (xmin near 0, xmax near 1000 for full-width patterns).
       "sourceFileIndex": 0-based integer indicating which of the provided images the step was found on.
       If you genuinely cannot locate a step, you may omit these fields (they will be treated as undefined).
       [VISUAL GROUNDING ACCURACY PROTOCOL]:
       1. Tight Bounding Boxes: sourceBox must tightly enclose the relevant row of text or chart icons. Avoid extra margins.
       2. Vertical Alignment: ymin must align strictly with the top of the text; ymax must align strictly with the baseline (bottom) of the text.
       3. Zero-Drift Calibration: For long images, calibrate the 0-1000 scale carefully. If a step is at the very bottom of the image, its ymax should be near 1000.
       4. Index Integrity: Double-check sourceFileIndex (starting from 0) when multiple images are provided.
       Correct example: {"steps":[{"text":"Back","isHeader":true},{"text":"Cast on 80 sts","sourceBox":[120,80,200,920],"sourceFileIndex":0},{"text":"Row 1: knit all","sourceBox":[210,80,290,920],"sourceFileIndex":0}]}` :
       `Correct example: {"steps":[{"text":"Back","isHeader":true},{"text":"Cast on 80 sts"},{"text":"Row 1: knit all"},{"text":"Sleeve","isHeader":true},{"text":"Pick up 40 sts"}]}`}
       ${hasImages ? "" : `\n       Pattern:\n       ${text}`}`);

  const contents = hasImages
    ? [
        ...images!.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })),
        prompt,
      ]
    : prompt;

  console.time("AI_CONVERSION");
  let lastError: any = null;

  for (let i = 0; i < MODELS_TO_TRY.length; i++) {
    const modelName = MODELS_TO_TRY[i];
    console.log(`[AI] Attempt ${i + 1}/${MODELS_TO_TRY.length} — model: ${modelName}`);

    const model = genAI.getGenerativeModel({ model: modelName });

    try {
      const result = await model.generateContent(contents);
      const raw = result.response.text().trim();

      console.log(`[AI] Raw response snippet (${modelName}): ${raw.slice(0, 100)}`);

      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

      console.timeEnd("AI_CONVERSION");
      return flattenSteps(parsed.steps ?? []);

    } catch (error: any) {
      lastError = error;
      const httpStatus = error.status ?? error.response?.status ?? "unknown";
      const errMessage = error.message ?? "";
      const errDetails = error.errorDetails ?? error.response?.data ?? null;
      const msgLower = errMessage.toLowerCase() + JSON.stringify(errDetails ?? "").toLowerCase();

      const isPayloadTooLarge =
        httpStatus === 413 ||
        msgLower.includes("payload size") ||
        msgLower.includes("too large") ||
        msgLower.includes("exceeds the limit") ||
        msgLower.includes("request entity too large");
      if (isPayloadTooLarge) {
        console.timeEnd("AI_CONVERSION");
        throw new Error("FILE_TOO_LARGE");
      }

      const is429 = httpStatus === 429 || errMessage.includes("429");
      const is404 = httpStatus === 404 || errMessage.includes("404");

      if (is429) {
        console.warn(`[AI] ${modelName} → 429 Rate Limit. Moving to next model.`);
        continue;
      }
      if (is404) {
        console.warn(`[AI] ${modelName} → 404 Not Found. Moving to next model.`);
        continue;
      }

      console.warn(`[AI] ${modelName} → unexpected error (${httpStatus}): ${errMessage}. Trying next model.`);
    }
  }

  console.timeEnd("AI_CONVERSION");
  const lastMsg = lastError?.message ?? "All models failed";
  const lastStatus = lastError?.status ?? lastError?.response?.status;
  const wasRateLimit = lastStatus === 429 || lastMsg.includes("429");
  throw new Error(wasRateLimit ? "QUOTA_EXCEEDED" : "UNKNOWN_ERROR");
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

    const steps = await runGemini(text, language, images);
    return NextResponse.json({ steps });
  } catch (err: any) {
    const msg = err?.message ?? "UNKNOWN_ERROR";
    const status = msg === "QUOTA_EXCEEDED" ? 429 : msg === "FILE_TOO_LARGE" ? 413 : 500;
    return NextResponse.json({ error: msg }, { status });
  } finally {
    inFlight = false;
  }
}
