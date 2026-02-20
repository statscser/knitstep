'use server'

import { GoogleGenerativeAI } from "@google/generative-ai"

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

const REQUEST_TIMEOUT_MS = 15_000

export async function parsePatternAction(text: string, language: 'zh' | 'en') {
  if (!process.env.GEMINI_API_KEY) throw new Error('API_KEY_IS_MISSING_IN_ENV')

  // Prefer gemini-2.0-flash (stable until Mar 2026). If 429, try gemini-2.0-flash-lite.
  const modelId = "gemini-2.0-flash"
  console.log('🚀 Sending request to Gemini:', modelId)
  console.log('Key prefix:', process.env.GEMINI_API_KEY.substring(0, 8) + '...')

  const model = genAI.getGenerativeModel({ model: modelId })

  const prompt = language === 'zh'
    ? `你是编织助手。将以下编织图解拆解为步骤清单，用中文描述，专业术语保留英文缩写（括号内）。只返回 JSON，格式：{"steps":[{"id":"1","text":"步骤说明"}]}。\n\n${text}`
    : `You are a knitting assistant. Break the following pattern into a step-by-step checklist. Return JSON only: {"steps":[{"id":"1","text":"step description"}]}.\n\n${text}`

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), REQUEST_TIMEOUT_MS)
  })

  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      timeoutPromise,
    ])

    const response = result.response

    // Log response metadata only (avoid flooding console with full text)
    const headerInfo = {
      hasCandidates: !!response.candidates?.length,
      candidateCount: response.candidates?.length ?? 0,
      finishReason: response.candidates?.[0]?.finishReason,
      textLength: response.text?.()?.length ?? 0,
    }
    console.log('📥 Gemini response header:', headerInfo)

    const raw = response.text().trim()
    const jsonStart = raw.indexOf('{')
    const jsonEnd   = raw.lastIndexOf('}')
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found in response')

    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1))
    console.log('Parsed steps count:', parsed.steps?.length ?? 0)
    return parsed

  } catch (error) {
    console.log('Full Error Object:', error)

    if ((error as Error).message === 'REQUEST_TIMEOUT') {
      throw new Error('REQUEST_TIMEOUT')
    }

    const status = (error as { status?: number }).status
    if (status === 429) throw new Error('QUOTA_EXCEEDED')
    if (status === 401 || status === 403) throw new Error('INVALID_API_KEY')
    if (status === 404) throw new Error('MODEL_NOT_FOUND')
    throw new Error('UNKNOWN_ERROR')
  }
}
