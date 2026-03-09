// test-api.mjs
import { GoogleGenerativeAI } from "@google/generative-ai";

// 1. 在这里直接填入你的 API Key 进行测试
const API_KEY = "AIzaSyBrWREK-RyFwYDEC2wF-qALqwWKodOR94g"; 

// 2. 测试列表：看看哪个模型能跑通
const MODELS_TO_TEST = [
  "gemini-2.5-flash", // Current core model
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-flash-lite" // 这是 2.5 系列中更轻量的一个
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