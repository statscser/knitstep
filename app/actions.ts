'use server'

import { GoogleGenerativeAI } from "@google/generative-ai"
import { GEMINI_MODELS } from "./lib/models"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

// ── checkAccessCode ───────────────────────────────────────────────────────────
// Validates a user-supplied code against the server-side env variable.
// Called by the client's handleUnlock — the code never lives in the client bundle.
export async function checkAccessCode(code: string): Promise<boolean> {
  const VALID_CODE = process.env.ACCESS_CODE ?? "KNITSTEPBYSTEP";
  return code === VALID_CODE;
}

type FlatStep = { text: string; original?: string; sizeMap?: Record<string, string> };

// ── flattenSteps ──────────────────────────────────────────────────────────────
// Recursively collapses any nested arrays or sub-step objects that Gemini may
// produce for complex patterns (short-rows, increases, section headers, etc.)
// into a single flat array of {text, original?, sizeMap?} primitives.
function flattenSteps(items: any[]): FlatStep[] {
  const result: FlatStep[] = [];

  for (const item of items) {
    if (Array.isArray(item)) {
      result.push(...flattenSteps(item));
    } else if (item && typeof item === 'object') {
      if (typeof item.text === 'string' && item.text.trim()) {
        const step: FlatStep = { text: item.text.trim() };
        if (item.original != null) step.original = String(item.original);
        if (
          item.sizeMap &&
          typeof item.sizeMap === 'object' &&
          !Array.isArray(item.sizeMap)
        ) {
          step.sizeMap = item.sizeMap as Record<string, string>;
        }
        result.push(step);
      }
      const subKeys = ['steps', 'sub_steps', 'subSteps', 'substeps', 'children', 'instructions', 'rows'];
      for (const key of subKeys) {
        if (Array.isArray(item[key]) && item[key].length > 0) {
          result.push(...flattenSteps(item[key]));
        }
      }
    }
  }

  return result;
}

export async function parsePatternAction(
  text: string,
  language: 'zh' | 'en',
  _retryCount = 0, // kept for API compatibility; fallback now handled via model loop
  imageBase64?: string,
  imageMimeType?: string,
) {
  if (!process.env.GEMINI_API_KEY) throw new Error('API_KEY_MISSING');

  console.time("AI_CONVERSION");

  const prompt = language === 'zh'
    ? `你是一位专业的编织翻译专家。请${imageBase64 ? '分析这张编织图解图片，提取所有步骤并' : '将以下英文图解'}转换为中文清单。

       【核心准则】：
       1. 必须保留原始行号标签（例如 "Row 5:"或者"R5" 翻译为 "第5行:"）。
       2. 翻译要专业，同时在括号中保留关键术语（例如：空针 (yo), 左上二并一 (k2tog), 引返 (short row), 加针 (M1)）。
       3. 严禁自行发明或修改针法逻辑，必须忠实于原稿。
       4. 如果原文明确写出了行数范围（如 Rows 1-4），请写为 "第1-4行: [重复动作]"。如果原文说 "for the next N rows"，请写为 "接下来的N行: [重复动作]"，不要转换为具体行数范围格式。
       5. 引返针法（短行/short rows）请按顺序逐步平铺，每一步作为独立的一行文字，不得嵌套。
       6. 章节标题（如"领口"、"袖子"）单独作为一个步骤，文字前加 "▶ " 前缀，不带行号。

       【智能尺码 — Smart Sizing】：
       部分图解使用括号标注多尺码，例如"起 80 (90, 100) 针"对应 S (M, L) 码。
       如果图解包含多尺码：
       1. 从页眉或说明中识别尺码顺序和标签（例如 "S (M, L)" 或 "36 (38, 40)"）。
       2. 对每个含括号尺码数字的步骤，添加 "sizeMap" 字段：键为尺码标签，值为该步骤仅替换为该尺码数字的完整文字。
          示例：text: "起 80 (90, 100) 针", sizeMap: {"S": "起 80 针", "M": "起 90 针", "L": "起 100 针"}
       3. 无尺码变化的步骤（标题行、无括号数字的步骤）省略 "sizeMap" 字段。

       【返回格式 — 极其重要】：
       只返回一个 JSON 对象，其中 steps 是一个【严格扁平的一维数组】。
       每个元素只允许包含 "text"（字符串）、可选的 "original"（字符串）和可选的 "sizeMap"（对象）。
       绝对禁止：嵌套数组、sub_steps、children、rows 或任何递归结构。
       正确示例：{"steps":[{"text":"第1行: 下针到底","original":"Row 1: knit all"},{"text":"第2行: 上针到底","original":"Row 2: purl all"}]}
       text 字段只放中文翻译，original 字段只放英文原稿，两个字段分开，不要混合。
       如果原文本身已经是中文，则不需要 original 字段，只返回 text 字段即可。
       ${imageBase64 ? `【视觉定位 — 必须执行】：
       对每个步骤，添加 "sourceBox" 字段（归一化坐标数组 [ymin, xmin, ymax, xmax]，严格使用 0-1000 坐标系）和 "sourceFileIndex": 0。
       视觉定位协议：1. 找到精确文字行；2. ymin 对齐大写字母顶部，ymax 对齐下伸字母底部；3. 边框紧密贴合，无多余边距；4. 若步骤跨越多行，只为第一行提供 sourceBox。
       正确示例：{"steps":[{"text":"第1行: 下针到底","original":"Row 1: knit all","sourceBox":[120,80,200,920],"sourceFileIndex":0}]}` : ''}
       ${imageBase64 ? '' : `\n       图解文本如下：\n       ${text}`}`
    : `You are a professional knitting pattern parser.
       ${imageBase64 ? 'Analyze this knitting pattern image and extract all instructions' : 'Parse the following knitting pattern text'} into clear, actionable checklist steps.

       [RULES]:
       1. Extract ALL instructions in document order — including cast-on, bind-off, setup rows, short rows, increases, decreases, and section transitions.
       2. Keep existing row labels if present (e.g., "Row 5:", "R3:"). If none exist, write a concise step description.
       3. For a block like "for the next N rows: do X", keep it as ONE step using the original phrasing. Do NOT expand into individual row numbers.
       4. Do NOT skip or omit any instruction, even if it lacks a row label.
       5. Section headings (e.g., "Sleeve", "Neckline") become a single step with text prefixed "▶ ", no row number.
       6. ONLY use the ${imageBase64 ? 'image' : 'pattern text below'}. Do NOT invent any steps.

       [SMART SIZING]:
       Many patterns list stitch counts for multiple sizes in parentheses, e.g., "Cast on 80 (90, 100) sts" for S (M, L).
       If the pattern contains multi-size variations:
       1. Identify the size order and labels from the pattern header (e.g., "S (M, L)" or "XS (S, M, L, XL)").
       2. For each step that contains parenthetical size numbers, add a "sizeMap" field: an object where each key is a size label and the value is the COMPLETE step text rewritten with ONLY that size's numbers substituted.
          Example: text: "Cast on 80 (90, 100) sts", sizeMap: {"S": "Cast on 80 sts", "M": "Cast on 90 sts", "L": "Cast on 100 sts"}
       3. For steps with no size variations (headers, steps without parenthetical numbers), omit the "sizeMap" field entirely.

       [OUTPUT FORMAT — CRITICAL]:
       Return a single JSON object where "steps" is a STRICTLY FLAT one-dimensional array.
       Each element may only contain "text" (string), optionally "original" (string), and optionally "sizeMap" (object).
       NEVER use nested arrays, sub_steps, children, rows, or any recursive structure.
       ${imageBase64 ? `[VISUAL GROUNDING — REQUIRED]:
       For every step, add "sourceBox": [ymin, xmin, ymax, xmax] (strictly 0-1000 coords) and "sourceFileIndex": 0.
       Protocol: 1. Find the exact text line. 2. ymin = top of capitals, ymax = bottom of descenders (g/y). 3. Tight fit, no extra margin. 4. If a step spans multiple lines, only box the first line.
       Correct example: {"steps":[{"text":"Cast on 80 sts","sourceBox":[120,80,200,920],"sourceFileIndex":0},{"text":"Row 1: knit all","sourceBox":[210,80,290,920],"sourceFileIndex":0}]}` : `Correct example: {"steps":[{"text":"Cast on 80 sts"},{"text":"Row 1: knit all"}]}`}
       ${imageBase64 ? '' : `\n       Pattern:\n       ${text}`}`;

  const contents = imageBase64
    ? [{ inlineData: { mimeType: imageMimeType!, data: imageBase64 } }, prompt]
    : prompt;

  let lastError: any = null;

  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const modelName = GEMINI_MODELS[i];
    console.log(`[AI] Attempt ${i + 1}/${GEMINI_MODELS.length} — model: ${modelName}`);

    const model = genAI.getGenerativeModel({ model: modelName });

    try {
      const result = await model.generateContent(contents);
      const raw = result.response.text().trim();

      console.log(`[AI] Raw response snippet (${modelName}): ${raw.slice(0, 100)}`);

      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

      const steps = flattenSteps(parsed.steps ?? []);

      console.timeEnd("AI_CONVERSION");

      return { stepsJson: JSON.stringify(steps) };

    } catch (error: any) {
      lastError = error;
      const httpStatus = error.status ?? error.response?.status ?? 'unknown';
      const errMessage = error.message ?? '';
      const errDetails = error.errorDetails ?? error.response?.data ?? null;
      const msgLower = errMessage.toLowerCase() + JSON.stringify(errDetails ?? '').toLowerCase();

      // Payload too large — no point trying other models
      const isPayloadTooLarge =
        httpStatus === 413 ||
        msgLower.includes('payload size') ||
        msgLower.includes('too large') ||
        msgLower.includes('exceeds the limit') ||
        msgLower.includes('request entity too large');
      if (isPayloadTooLarge) {
        console.timeEnd("AI_CONVERSION");
        throw new Error("FILE_TOO_LARGE");
      }

      const is429 = httpStatus === 429 || errMessage.includes('429');
      const is404 = httpStatus === 404 || errMessage.includes('404');

      if (is429) {
        console.warn(`[AI] ${modelName} → 429 Rate Limit. Moving to next model.`);
        continue;
      }
      if (is404) {
        console.warn(`[AI] ${modelName} → 404 Not Found. Moving to next model.`);
        continue;
      }

      // Unknown error — log and try next model anyway
      console.warn(`[AI] ${modelName} → unexpected error (${httpStatus}): ${errMessage}. Trying next model.`);
    }
  }

  // All models exhausted
  console.timeEnd("AI_CONVERSION");

  const lastMsg = lastError?.message ?? 'All models failed';
  const lastStatus = lastError?.status ?? lastError?.response?.status;
  const wasRateLimit = lastStatus === 429 || lastMsg.includes('429');

  throw new Error(wasRateLimit ? `AI_LIMIT_REACHED: ${lastMsg}` : `AI_MODEL_ERROR: ${lastMsg}`);
}
