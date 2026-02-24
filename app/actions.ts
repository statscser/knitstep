'use server'

import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const MODEL_NAME = "gemini-2.5-flash"

// Deduplication guard — prevents simultaneous calls in the same server process
let inFlight = false;

// 辅助函数：等待一段时间
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    if (inFlight) {
      console.warn('⚠️ parsePatternAction called while already in-flight — ignoring duplicate.');
      throw new Error("UNKNOWN_ERROR");
    }
    inFlight = true;
  }

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });

  const prompt = language === 'zh'
    ? `你是一位专业的编织翻译专家。请${imageBase64 ? '分析这张编织图解图片，提取所有步骤并' : '将以下英文图解'}转换为中文清单。

       【核心准则】：
       1. 必须保留原始行号标签（例如 "Row 5:"或者"R5" 翻译为 "第5行:"）。
       2. 翻译要专业，同时在括号中保留关键术语（例如：空针 (yo), 左上二并一 (k2tog)）。
       3. 严禁自行发明或修改针法逻辑，必须忠实于原稿。
       4. 如果原文明确写出了行数范围（如 Rows 1-4），请写为 "第1-4行: [重复动作]"。如果原文说 "for the next N rows"，请写为 "接下来的N行: [重复动作]"，不要转换为具体行数范围格式。

       【返回格式】：
       只返回 JSON：{"steps":[{"text":"第X行: 翻译后的指令", "original": "Row X: original instruction verbatim"}]}
       text 字段只放中文翻译，original 字段只放英文原稿，两个字段分开，不要混合。
       ${imageBase64 ? '' : `\n       图解文本如下：\n       ${text}`}`
    : `You are a professional knitting pattern parser.
       ${imageBase64 ? 'Analyze this knitting pattern image and extract all instructions' : 'Parse the following knitting pattern text'} into clear, actionable checklist steps.
       [RULES]:
       1. Extract ALL instructions — including cast-on, bind-off, setup rows, and any row instructions.
       2. Keep existing row labels if present (e.g., "Row 5:", "R3:"). If none exist, write a concise step description.
       3. For a block like "for the next N rows: do X", keep it as ONE step using the original phrasing (e.g., "For the next 10 rows: knit odd rows, purl even rows"). Do NOT convert "next N rows" phrasing into a numbered range like "Rows 1–10". Do NOT split the same block into multiple steps.
       4. Do NOT skip or omit any instruction, even if it lacks a row label.
       5. ONLY use the ${imageBase64 ? 'image' : 'pattern text below'}. Do NOT invent any steps.
       Return JSON only: {"steps":[{"text":"instruction here"}]}
       ${imageBase64 ? '' : `\n       Pattern:\n       ${text}`}`;

  const contents = imageBase64
    ? [{ inlineData: { mimeType: imageMimeType!, data: imageBase64 } }, prompt]
    : prompt;

  try {
    const result = await model.generateContent(contents);
    const response = await result.response;
    const raw = response.text().trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    inFlight = false;
    return parsed;

  } catch (error: any) {
    // ── Full diagnostic dump ──────────────────────────────────────────────────
    const httpStatus   = error.status ?? error.response?.status ?? 'unknown';
    const errMessage   = error.message ?? '';
    const errDetails   = error.errorDetails ?? error.response?.data ?? null;

    // Detect TPM vs RPM from the error message / details
    const msgLower = errMessage.toLowerCase() + JSON.stringify(errDetails ?? '').toLowerCase();
    const limitKind = msgLower.includes('token') ? 'TPM (tokens/min)'
                    : msgLower.includes('request') ? 'RPM (requests/min)'
                    : 'unknown limit type';

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

    console.error('─── Gemini 429 diagnostic ───────────────────────────────');
    console.error('HTTP status  :', httpStatus);
    console.error('Limit kind   :', limitKind, isDailyQuota ? '(DAILY — no retry)' : '');
    console.error('API retry in :', apiDelaySec != null ? `${apiDelaySec}s` : 'not specified');
    console.error('Message      :', errMessage);
    console.error('errorDetails :', JSON.stringify(errDetails, null, 2));
    console.error('retryCount   :', retryCount);
    console.error('isImage      :', !!imageBase64, '| mimeType:', imageMimeType ?? 'n/a');
    console.error('─────────────────────────────────────────────────────────');

    const is429 = httpStatus === 429 || errMessage.includes('429');
    if (is429 && !isDailyQuota && retryCount < 3) {
      const wait = apiDelaySec != null ? apiDelaySec * 1000 : Math.pow(2, retryCount + 1) * 1000;
      console.log(`⚠️ Rate-limited (${limitKind}). Retry ${retryCount + 1}/3 in ${wait / 1000}s…`);
      await sleep(wait);
      return parsePatternAction(text, language, retryCount + 1, imageBase64, imageMimeType);
    }

    inFlight = false;
    throw new Error(is429 ? "QUOTA_EXCEEDED" : "UNKNOWN_ERROR");
  }
}
