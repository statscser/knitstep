// test-api.mjs
import { GoogleGenerativeAI } from "@google/generative-ai";

// Read API key from environment — never hardcode secrets in source files
// Run with: GEMINI_API_KEY=your_key node test-api.mjs
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error("❌ Set GEMINI_API_KEY env var before running."); process.exit(1); }

// 2. 测试列表：看看哪个模型能跑通
// Crochet parsing: gemini-3.1-pro-preview → gemini-2.5-pro
// Everything else: gemini-3-flash-preview → gemini-2.5-flash
// parse-video:     gemini-3-flash-preview (single model, no fallback)
const MODELS_TO_TEST = [
  "gemini-3.1-pro-preview",
  "gemini-2.5-pro",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];

async function runTest() {
  const genAI = new GoogleGenerativeAI(API_KEY);

  for (const modelId of MODELS_TO_TEST) {
    console.log(`\n--- Testing Model: ${modelId} ---`);
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent("Hello, are you working?");
      const response = await result.response;
      console.log(`✅ Success! Response: ${response.text().substring(0, 20)}...`);
    } catch (err) {
      console.error(`❌ Failed: ${modelId}`);
      console.error(`   Error Message: ${err.message}`);
      // 如果报 429，说明是配额问题；如果报 404，说明模型 ID 写错了
    }
  }
}

runTest();