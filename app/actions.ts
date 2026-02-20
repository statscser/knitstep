'use server'

import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
const MODEL_NAME = "gemini-2.5-flash"

// 辅助函数：等待一段时间
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function parsePatternAction(text: string, language: 'zh' | 'en', retryCount = 0) {
  if (!process.env.GEMINI_API_KEY) throw new Error('API_KEY_MISSING');

  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const prompt = language === 'zh'
    ? `你是一位专业的编织翻译专家。请将以下英文图解转换为中文清单。
       
       【核心准则】：
       1. 必须保留原始行号标签（例如 "Row 5:"或者"R5" 翻译为 "第5行:"）。
       2. 翻译要专业，同时在括号中保留关键术语（例如：空针 (yo), 左上二并一 (k2tog)）。
       3. 严禁自行发明或修改针法逻辑，必须忠实于原稿。
       4. 如果是行数范围（如 Rows 1-4），请写为 "第1-4行: [重复动作]"。

       【返回格式】：
       只返回 JSON：{"steps":[{"text":"第X行: 翻译后的指令 (Original Instruction)"}]}
       
       图解文本如下：
       ${text}`
    : `You are a strict knitting pattern extractor. 
       [CRITICAL RULES]:
       1. EXTRACT instructions verbatim. Keep all row labels (e.g., "Row 5:").
       2. Do NOT rewrite or "improve" the pattern logic.
       3. For row ranges (e.g., "Rows 1-4"), clearly state the range.
       Return JSON only: {"steps":[{"text":"Row X: exact instruction content"}]}`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const raw = response.text().trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    return JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

  } catch (error: any) {
    // ✨ 核心逻辑：如果是 429 错误，且重试次数少于 3 次
    if (error.status === 429 && retryCount < 3) {
      console.log(`⚠️ 触发频率限制，正在进行第 ${retryCount + 1} 次重试...`);
      // 等待时间随次数增加：2s, 4s, 8s
      await sleep(Math.pow(2, retryCount + 1) * 1000); 
      return parsePatternAction(text, language, retryCount + 1);
    }

    console.error('Gemini Error:', error);
    // 转发给前端识别
    throw new Error(error.status === 429 ? "QUOTA_EXCEEDED" : "UNKNOWN_ERROR");
  }
}