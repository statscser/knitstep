"use client";

import { useState } from "react";

interface Step {
  id: number;
  text: string;
  checked: boolean;
}

// Recognizes lines that look like knitting row instructions.
// Matches patterns such as: R1, R12, Row 1, Row1, row 3, r5, or any line
// containing the word "repeat", "stitch", "cast", "bind", "yarn", "knit", "purl"
const ROW_KEYWORDS =
  /\b(r\d+|row\s*\d+|repeat|stitch(?:es)?|cast\s*on|cast\s*off|bind\s*off|yarn|knit|purl|k\d+|p\d+|co\b|bo\b|sl\b|yo\b|k2tog|ssk)\b/i;

function parseInput(raw: string): Step[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => ({
      id: idx,
      text: line,
      checked: false,
      // We keep every non-empty line but flag knitting rows visually via isRow
    }))
    .filter((step) => ROW_KEYWORDS.test(step.text));
}

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [hasConverted, setHasConverted] = useState(false);

  function handleConvert() {
    const parsed = parseInput(inputText);
    setSteps(parsed);
    setHasConverted(true);
  }

  function toggleStep(id: number) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s))
    );
  }

  const doneCount = steps.filter((s) => s.checked).length;
  const totalCount = steps.length;

  return (
    <div className="min-h-screen bg-rose-50 flex flex-col items-center py-16 px-4">
      {/* Header */}
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-rose-700">
          🧶 KnitStep
        </h1>
        <p className="mt-2 text-rose-500 text-sm">
          粘贴你的编织图解，一键生成步骤清单
        </p>
      </header>

      {/* Input Card */}
      <div className="w-full max-w-2xl bg-white rounded-2xl shadow-md p-6 mb-6">
        <label
          htmlFor="pattern-input"
          className="block text-sm font-semibold text-rose-700 mb-2"
        >
          编织图解文本
        </label>
        <textarea
          id="pattern-input"
          className="w-full h-48 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-zinc-700 placeholder-zinc-400 resize-none focus:outline-none focus:ring-2 focus:ring-rose-300 transition"
          placeholder={`例如：
R1: CO 20 sts
Row 2: Knit all stitches
R3: K2, P2, repeat to end
Row 4: Purl all sts
Bind off all sts`}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button
          onClick={handleConvert}
          disabled={inputText.trim().length === 0}
          className="mt-4 w-full rounded-xl bg-rose-600 py-3 text-sm font-semibold text-white shadow hover:bg-rose-700 active:scale-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          解析图解 →
        </button>
      </div>

      {/* Results */}
      {hasConverted && (
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-rose-700">
              步骤清单
            </h2>
            {totalCount > 0 && (
              <span className="text-xs text-zinc-400">
                {doneCount} / {totalCount} 完成
              </span>
            )}
          </div>

          {totalCount === 0 ? (
            <p className="text-sm text-zinc-400 text-center py-8">
              未识别到编织行指令。请确认文本中包含
              Row、R1、knit、purl 等关键词。
            </p>
          ) : (
            <>
              {/* Progress bar */}
              <div className="w-full h-1.5 bg-rose-100 rounded-full mb-5 overflow-hidden">
                <div
                  className="h-full bg-rose-400 rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.round((doneCount / totalCount) * 100)}%`,
                  }}
                />
              </div>

              <ul className="flex flex-col gap-3">
                {steps.map((step) => (
                  <li
                    key={step.id}
                    onClick={() => toggleStep(step.id)}
                    className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer select-none transition-all duration-200 ${
                      step.checked
                        ? "border-rose-100 bg-rose-50 opacity-50"
                        : "border-zinc-100 bg-white hover:border-rose-200 hover:bg-rose-50"
                    }`}
                  >
                    {/* Custom checkbox */}
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200 ${
                        step.checked
                          ? "border-rose-400 bg-rose-400"
                          : "border-zinc-300"
                      }`}
                    >
                      {step.checked && (
                        <svg
                          className="h-3 w-3 text-white"
                          viewBox="0 0 12 12"
                          fill="none"
                        >
                          <path
                            d="M2 6l3 3 5-5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>

                    <span
                      className={`text-sm leading-relaxed transition-all duration-200 ${
                        step.checked
                          ? "line-through text-zinc-400"
                          : "text-zinc-700"
                      }`}
                    >
                      {step.text}
                    </span>
                  </li>
                ))}
              </ul>

              {doneCount === totalCount && totalCount > 0 && (
                <p className="mt-6 text-center text-sm font-semibold text-rose-500">
                  🎉 全部完成！你的编织品即将完工！
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
