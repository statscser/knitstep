'use server'

// import { GoogleGenerativeAI } from "@google/generative-ai"
// ↑ Real API temporarily commented out — using mock data while API quota resets.
//   To restore: uncomment all lines marked [REAL], delete the MOCK block below.

// ─── [MOCK] ───────────────────────────────────────────────────────────────────

const MOCK_RESPONSE = {
  steps: [
    { id: "1", text: "Cast on 120 stitches using 3.5mm needles（使用 3.5mm 针起 120 针）" },
    { id: "2", text: "Work 2×2 Ribbing: K2, P2 to end of row（织双罗纹：2下针 2上针）", count: 10 },
    { id: "3", text: "Set up pattern: K10, place marker, K100, place marker, K10（排花：10下针，放记号扣，100下针，放记号扣，10下针）", count: 1 },
    { id: "4", text: "Knit across all stitches（全下针织一行）", count: 1 },
  ],
}

export async function parsePatternAction(_text: string, _language: 'zh' | 'en') {
  console.log('--- [MOCK] parsePatternAction called ---')
  // Simulate network latency
  await new Promise((resolve) => setTimeout(resolve, 1500))
  return MOCK_RESPONSE
}

// ─── [REAL] — restore when API quota resets ──────────────────────────────────
//
// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')
//
// export async function parsePatternAction(text: string, language: 'zh' | 'en') {
//   if (!process.env.GEMINI_API_KEY) throw new Error('API_KEY_IS_MISSING_IN_ENV')
//   console.log('--- Start Parsing ---')
//   console.log('Using Key:', process.env.GEMINI_API_KEY.substring(0, 8) + '...')
//
//   const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-8b" })
//   const prompt = language === 'zh'
//     ? `你是编织助手。将以下编织图解拆解为步骤清单，用中文描述，专业术语保留英文缩写（括号内）。只返回 JSON，格式：{"steps":[{"id":"1","text":"步骤说明"}]}。\n\n${text}`
//     : `You are a knitting assistant. Break the following pattern into a step-by-step checklist. Return JSON only: {"steps":[{"id":"1","text":"step description"}]}.\n\n${text}`
//   try {
//     const result = await model.generateContent(prompt)
//     const raw = result.response.text().trim()
//     const jsonStart = raw.indexOf('{')
//     const jsonEnd   = raw.lastIndexOf('}')
//     if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in response')
//     const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
//     return parsed
//   } catch (error) {
//     console.log('Full Error Object:', error)
//     const status = (error as { status?: number }).status
//     if (status === 429) throw new Error('QUOTA_EXCEEDED')
//     if (status === 401 || status === 403) throw new Error('INVALID_API_KEY')
//     if (status === 404) throw new Error('MODEL_NOT_FOUND')
//     throw new Error('UNKNOWN_ERROR')
//   }
// }
