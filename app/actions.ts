'use server'

import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const MODEL_NAME = "gemini-2.5-flash"

// Deduplication guard — prevents simultaneous calls in the same server process
let inFlight = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type FlatStep = { text: string; original?: string; sizeMap?: Record<string, string> };

// ── flattenSteps ──────────────────────────────────────────────────────────────
// Recursively collapses any nested arrays or sub-step objects that Gemini may
// produce for complex patterns (short-rows, increases, section headers, etc.)
// into a single flat array of {text, original?, sizeMap?} primitives.
function flattenSteps(items: any[]): FlatStep[] {
  const result: FlatStep[] = [];

  for (const item of items) {
    if (Array.isArray(item)) {
      // Unexpected top-level array nesting — recurse
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
      // Recurse into any sub-step collections (all known key variants)
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
  retryCount = 0,
  imageBase64?: string,
  imageMimeType?: string,
) {
  if (!process.env.GEMINI_API_KEY) throw new Error('API_KEY_MISSING');

  // Only block duplicate top-level calls, not retries
  if (retryCount === 0) {
    if (inFlight) throw new Error("UNKNOWN_ERROR");
    inFlight = true;
  }

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

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
       Correct example: {"steps":[{"text":"Cast on 80 sts"},{"text":"Row 1: knit all"}]}
       ${imageBase64 ? '' : `\n       Pattern:\n       ${text}`}`;

  const contents = imageBase64
    ? [{ inlineData: { mimeType: imageMimeType!, data: imageBase64 } }, prompt]
    : prompt;

  try {
    const result = await model.generateContent(contents);
    const raw = result.response.text().trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

    // Flatten any nesting the model may have produced despite instructions
    const steps = flattenSteps(parsed.steps ?? []);

    inFlight = false;

    // Return as a JSON string — bypasses Next.js Server Action array-nesting
    // serialization limits ("Maximum array nesting exceeded", digest 942247392).
    return { stepsJson: JSON.stringify(steps) };

  } catch (error: any) {
    const httpStatus = error.status ?? error.response?.status ?? 'unknown';
    const errMessage = error.message ?? '';
    const errDetails = error.errorDetails ?? error.response?.data ?? null;

    const msgLower = errMessage.toLowerCase() + JSON.stringify(errDetails ?? '').toLowerCase();

    // Detect daily quota (retrying is pointless — resets tomorrow)
    const violations = (errDetails ?? []).flatMap((d: any) => d.violations ?? []);
    const isDailyQuota = violations.some((v: any) =>
      (v.quotaId ?? '').toLowerCase().includes('perday')
    );

    // Use API-suggested retry delay if provided
    const retryInfo = (errDetails ?? []).find((d: any) =>
      (d['@type'] ?? '').includes('RetryInfo')
    );
    const apiDelaySec = retryInfo?.retryDelay ? parseInt(retryInfo.retryDelay) : null;

    // Detect file/payload too large (Gemini returns 400 for oversized inline data)
    const isPayloadTooLarge =
      httpStatus === 413 ||
      msgLower.includes('payload size') ||
      msgLower.includes('too large') ||
      msgLower.includes('exceeds the limit') ||
      msgLower.includes('request entity too large');
    if (isPayloadTooLarge) {
      inFlight = false;
      throw new Error("FILE_TOO_LARGE");
    }

    const is429 = httpStatus === 429 || errMessage.includes('429');
    if (is429 && !isDailyQuota && retryCount < 3) {
      const wait = apiDelaySec != null ? apiDelaySec * 1000 : Math.pow(2, retryCount + 1) * 1000;
      await sleep(wait);
      return parsePatternAction(text, language, retryCount + 1, imageBase64, imageMimeType);
    }

    inFlight = false;
    throw new Error(is429 ? "QUOTA_EXCEEDED" : "UNKNOWN_ERROR");
  }
}
