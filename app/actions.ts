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
    ? `将编织图解转为 JSON: {"steps":[{"text":"步骤"}]} \n\n ${text}`
    : `Convert to JSON: {"steps":[{"text":"step"}]} \n\n ${text}`;

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