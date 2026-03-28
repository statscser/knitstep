import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const MODELS_TO_TRY = [
  "gemini-3.1-flash-lite-preview",  // Development mode
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite",
] as const;


let inFlight = false;

// ─── Grid types (mirrored from lib/types to keep this route self-contained) ──
type GridCellObj = { s: string; c?: string; u?: boolean; span?: number };
interface GridRow  { rowNumber: number; type: "RS" | "WS"; cells: (GridCellObj | string)[]; }
interface GridData { totalRows: number; totalStitches: number; rows: GridRow[]; legend: Record<string, string>; colors?: Record<string, string>; confidence?: number; analysisReport?: string; }

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

const GRID_SYSTEM_PROMPT = `你是一个高精度的编织图解数字化专家。你的核心任务是将图片中的视觉符号**原封不动**地提取到 JSON 矩阵中。

### 🚨 严格执行准则：

1. **视觉忠实度 (Visual Fidelity) [最高优先级]**
   - 格子里的内容必须是图片中出现的**原始视觉符号**（如：○, \\, /, V, ·, X, □, ⋈）。
   - **严禁**将符号转换为文字说明（例如：严禁把 "○" 写成 "yarn over"，严禁把 "/" 写成 "knit"）。
   - s 字段只允许出现：① 单个或少量字符的视觉符号（如 "○"、"/"、"X"），② 空字符串 ""（代表下针空白格），③ "span-continuation"（麻花占位）。
   - **绝对禁止**在 s 字段中填写英文单词（如 "knit"、"purl"、"yarn over"）或中文词语。
   - 如果格子是纯色块（无特殊符号），s 字段填 ""，c 字段填颜色 Hex 码。

2. **矩阵结构 (Matrix Integrity)**
   - 先数清总行数和总针数，确定矩阵维度 totalRows × totalStitches。
   - 每行的 cells 数组长度必须严格等于 totalStitches（含 span-continuation 占位符）。
   - 行方向：图解最底行 = rowNumber 1，最顶行 = rowNumber totalRows（从下往上）。
   - 列方向：cells[0] = 最左格，cells[totalStitches-1] = 最右格。
   - type 字段：右侧行号奇数为 "RS"，偶数为 "WS"；无法判断则全部填 "RS"。

3. **颜色采样 (Color Sampling)**
   - 对每格采样其**中心像素**颜色，格式 "#RRGGBB"；无颜色差异（白底）则填 ""。
   - 反散点规则：编织图颜色分区明显，禁止输出随机跳跃颜色；若识别出散乱颜色，重新对齐坐标后再采样。

4. **跨格麻花 (Cable Spanning)**
   - 仅对横跨多个格子的单一长线条符号使用 span 属性。
   - 起始格：{"s": "麻花视觉符号", "span": N, "c": "颜色"}。
   - 被跨越格：{"s": "span-continuation"}（不含其他字段）。

5. **确信度 (Confidence)**
   - confidence: round((总格数 - 模糊格数) / 总格数 × 100)，范围 0-100。
   - 若符号识别不准或出现彩色乱码，主动降低分值并在 analysisReport 中注明原因（中文）。
   - 模糊格子标记 u: true。

### 输出 — 只返回 JSON，无 markdown，无解释:
{"confidence":<int>,"analysisReport":"<中文描述>","data":{"totalRows":<n>,"totalStitches":<n>,"colors":{"C1":"#RRGGBB"},"rows":[{"rowNumber":1,"type":"RS","cells":[{"s":"<sym>","c":"<#hex>","u":<bool>},...]},...],"legend":{"<sym>":"<说明>"}}}

### 示例 — 含麻花符号的图解 2行×6针，置信度 92:
{"confidence":92,"analysisReport":"麻花区域清晰，存在4针后交叉麻花符号。","data":{"totalRows":2,"totalStitches":6,"colors":{},"rows":[{"rowNumber":1,"type":"RS","cells":[{"s":"","c":""},{"s":"⋈","c":"","span":4},{"s":"span-continuation"},{"s":"span-continuation"},{"s":"span-continuation"},{"s":"","c":""}]},{"rowNumber":2,"type":"WS","cells":[{"s":"","c":""},{"s":"","c":""},{"s":"","c":""},{"s":"","c":""},{"s":"","c":""},{"s":"","c":""}]}],"legend":{"":"下针（正面）/ 上针（反面）","⋈":"4针后交叉麻花"}}}

### 示例 — Fair Isle 颜色图解 2行×4针，置信度 100:
{"confidence":100,"analysisReport":"颜色分区清晰，无歧义。","data":{"totalRows":2,"totalStitches":4,"colors":{"C1":"#2D5A27","C2":"#F5ECD7"},"rows":[{"rowNumber":1,"type":"RS","cells":[{"s":"","c":"#2D5A27"},{"s":"","c":"#F5ECD7"},{"s":"","c":"#2D5A27"},{"s":"","c":"#F5ECD7"}]},{"rowNumber":2,"type":"WS","cells":[{"s":"","c":"#F5ECD7"},{"s":"","c":"#F5ECD7"},{"s":"","c":"#F5ECD7"},{"s":"","c":"#F5ECD7"}]}],"legend":{"":"下针"}}}

CRITICAL: Return ONLY the JSON object. No markdown fences. No extra text.`;

async function runGeminiGrid(
  images: { base64: string; mimeType: string }[],
): Promise<GridData> {
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
        GRID_SYSTEM_PROMPT + retryNote,
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

        const parsed   = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));

        // Extract confidence / analysisReport from the top-level envelope
        const confidence = typeof parsed.confidence === "number"
          ? Math.round(Math.max(0, Math.min(100, parsed.confidence)))
          : undefined;
        const analysisReport = typeof parsed.analysisReport === "string"
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

        // Debug: log first two rows so color mis-mapping is visible in server logs
        console.log(`[GridAI] rows=${gridData.totalRows} sts=${gridData.totalStitches} confidence=${confidence}`);
        console.log(`[GridAI] row1 cells:`, JSON.stringify(gridData.rows[0]?.cells?.slice(0, 6)));
        if (gridData.rows[1]) console.log(`[GridAI] row2 cells:`, JSON.stringify(gridData.rows[1]?.cells?.slice(0, 6)));

        return gridData;

      } catch (err: any) {
        lastError       = err;
        const status    = err.status ?? err.response?.status ?? "unknown";
        const msgLower  = (err.message ?? "").toLowerCase();

        if (status === 413 || msgLower.includes("too large"))            throw new Error("FILE_TOO_LARGE");
        if (status === 429 || msgLower.includes("429")) { console.warn(`[GridAI] ${modelName} → 429`); break; }
        if (status === 404 || msgLower.includes("404")) { console.warn(`[GridAI] ${modelName} → 404`); break; }

        // Parse/shape error: retry this model once, then move to the next
        console.warn(`[GridAI] ${modelName} attempt ${attempt + 1} failed: ${err.message}`);
      }
    }
  }

  const msg        = lastError?.message ?? "All models failed";
  const wasRateLimit = (lastError?.status ?? lastError?.response?.status) === 429 || msg.includes("429");
  throw new Error(wasRateLimit ? "QUOTA_EXCEEDED" : "GRID_PARSE_FAILED");
}

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

       ## 视觉定位协议 (VISUAL GROUNDING PROTOCOL)
       1. 坐标精度 (Coordinate Precision):
          - 严格使用 0-1000 坐标系。将图片想象为一个 1000×1000 的网格。
          - 第一步：找到对应的精确文字行。
          - 第二步：ymin 必须对齐大写字母的顶部，ymax 必须对齐下伸字母（如 'g' 或 'y'）的底部。
          - 确保边框是对文字行的"紧密贴合"，避免多余边距。
       2. 锚点校准 (Anchor Calibration):
          - Y=0 是图片的绝对顶部边缘；Y=1000 是绝对底部。
          - 若文字位于 PDF 页面中部，请仔细估算其在整张图片中的相对位置。
       3. 多页逻辑 (Multi-page Logic):
          - sourceFileIndex 必须与提供图片的实际顺序严格对应（从 0 开始）。对于 3 页 PDF，第1页索引为 0，第2页为 1，以此类推。
       4. 跨行步骤 (Multi-line steps):
          - 若某个步骤跨越多行文字，只为第一行提供 sourceBox，以保证定位精度。
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

       ## VISUAL GROUNDING PROTOCOL
       1. Coordinate Precision:
          - Strictly use a 0-1000 coordinate system. Imagine a 1000×1000 grid over the image.
          - Step 1: Find the exact line of text.
          - Step 2: ymin must be the very top of the capital letters; ymax must be the bottom of the descenders (like 'g' or 'y').
          - Ensure the box is a "tight fit" for the text line with no extra margin.
       2. Anchor Calibration:
          - Y=0 is the absolute top edge of the image; Y=1000 is the absolute bottom.
          - If the text is in the middle of a PDF page, estimate its relative position in the full image carefully.
       3. Multi-page Logic:
          - sourceFileIndex must correspond exactly to the 0-based order of the images provided. For a 3-page PDF, index 0 is page 1, index 1 is page 2, etc.
       4. Multi-line steps:
          - If a step spans multiple lines, only provide the sourceBox for the first line to maintain precision.
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
    const { text, language, images, accessCode, isGridMode } = body as {
      text: string;
      language: "zh" | "en";
      images?: { base64: string; mimeType: string }[];
      accessCode?: string;
      isGridMode?: boolean;
    };

    const VALID_CODE = process.env.ACCESS_CODE ?? "KNITSTEPBYSTEP";
    if (accessCode !== VALID_CODE) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    if (isGridMode) {
      if (!images || images.length === 0) {
        return NextResponse.json({ error: "GRID_NO_IMAGE" }, { status: 400 });
      }
      const gridData = await runGeminiGrid(images);
      return NextResponse.json({ type: "grid", data: gridData });
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
