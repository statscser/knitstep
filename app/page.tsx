"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Circle, CheckCircle2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Step {
  id: number;
  text: string;
  checked: boolean;
}

// ─── Parse logic ─────────────────────────────────────────────────────────────

const ROW_KEYWORDS =
  /\b(r\d+|row\s*\d+|repeat|stitch(?:es)?|cast\s*on|cast\s*off|bind\s*off|yarn|knit|purl|k\d+|p\d+|co\b|bo\b|sl\b|yo\b|k2tog|ssk)\b/i;

function parseInput(raw: string): Step[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => ({ id: idx, text: line, checked: false }))
    .filter((step) => ROW_KEYWORDS.test(step.text));
}

// ─── Shared style tokens ─────────────────────────────────────────────────────

const CARD_STYLE: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1.5px solid var(--border)",
  boxShadow: "0 10px 40px -15px rgba(0,0,0,0.05)",
};

const RADIUS = "2rem"; // rounded-[2rem] equivalent for inline styles

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const [inputText, setInputText] = useState(
    `R1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts`
  );
  const [steps, setSteps] = useState<Step[]>([]);
  const [hasConverted, setHasConverted] = useState(false);

  function handleConvert() {
    setSteps(parseInput(inputText));
    setHasConverted(true);
  }

  function toggleStep(id: number) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s))
    );
  }

  const doneCount = steps.filter((s) => s.checked).length;
  const totalCount = steps.length;
  const allDone = totalCount > 0 && doneCount === totalCount;
  const isDisabled = inputText.trim().length === 0;

  return (
    <div
      className="min-h-screen flex flex-col items-center py-16 px-4"
      style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}
    >
      {/* ── Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="mb-8 flex flex-col items-center gap-3 text-center"
      >
        <KnitLogo />
        <div>
          <h1
            className="text-3xl font-bold tracking-wide leading-tight"
            style={{ color: "var(--text-main)" }}
          >
            KnitStep
          </h1>
          <p
            className="mt-1 text-sm font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            粘贴编织图解，生成可勾选的步骤清单
          </p>
        </div>
      </motion.header>

      {/* ── Input Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-xl p-8 mb-6"
        style={{ ...CARD_STYLE, borderRadius: RADIUS }}
      >
        <label
          htmlFor="pattern-input"
          className="block text-sm font-semibold uppercase tracking-widest mb-3"
          style={{ color: "var(--text-muted)" }}
        >
          编织图解文本
        </label>

        <textarea
          id="pattern-input"
          rows={7}
          className="w-full p-4 text-base resize-none focus:outline-none transition-all duration-200"
          style={{
            background: "var(--bg)",
            border: "1.5px solid var(--border)",
            borderRadius: "1.25rem",
            color: "var(--text-main)",
            fontFamily: "var(--font-body)",
          }}
          onFocus={(e) =>
            (e.currentTarget.style.border =
              "1.5px solid var(--morandi-pink)")
          }
          onBlur={(e) =>
            (e.currentTarget.style.border = "1.5px solid var(--border)")
          }
          placeholder={`例如：\nR1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts`}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />

        {/* ── Convert Button ── */}
        <motion.button
          onClick={handleConvert}
          disabled={isDisabled}
          whileHover={isDisabled ? {} : { scale: 1.05 }}
          whileTap={isDisabled ? {} : { scale: 0.95 }}
          transition={{ type: "spring", stiffness: 380, damping: 16 }}
          className="mt-5 w-full py-3.5 text-base font-semibold tracking-wide"
          style={{
            background: "var(--morandi-pink)",
            color: "#fff",
            borderRadius: RADIUS,
            boxShadow: "0 4px 20px -6px rgba(231,200,197,0.7)",
            opacity: isDisabled ? 0.45 : 1,
            cursor: isDisabled ? "not-allowed" : "pointer",
          }}
        >
          解析图解 ✨
        </motion.button>
      </motion.div>

      {/* ── Results Card ── */}
      <AnimatePresence>
        {hasConverted && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="w-full max-w-xl p-8"
            style={{ ...CARD_STYLE, borderRadius: RADIUS }}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-5">
              <span
                className="text-sm font-semibold uppercase tracking-widest"
                style={{ color: "var(--text-muted)" }}
              >
                步骤清单
              </span>
              {totalCount > 0 && (
                <span
                  className="text-sm font-medium px-3 py-1 rounded-full"
                  style={{
                    background: "var(--bg)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {doneCount} / {totalCount}
                </span>
              )}
            </div>

            {totalCount === 0 ? (
              <p
                className="text-sm text-center py-10"
                style={{ color: "var(--text-muted)" }}
              >
                未识别到编织行指令。
                <br />
                请确认文本包含 Row、R1、knit、purl 等关键词。
              </p>
            ) : (
              <>
                {/* Progress bar */}
                <div
                  className="w-full h-2 rounded-full mb-6 overflow-hidden"
                  style={{ background: "var(--border)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--morandi-green)" }}
                    initial={{ width: 0 }}
                    animate={{
                      width: `${Math.round((doneCount / totalCount) * 100)}%`,
                    }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>

                {/* Step list — staggered slide-in on first render */}
                <ul className="flex flex-col gap-2">
                  {steps.map((step, i) => (
                    <StepItem
                      key={step.id}
                      step={step}
                      index={i}
                      onToggle={() => toggleStep(step.id)}
                    />
                  ))}
                </ul>

                {/* All-done celebration */}
                <AnimatePresence>
                  {allDone && (
                    <motion.p
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 20,
                      }}
                      className="mt-7 text-center text-sm font-semibold"
                      style={{ color: "var(--morandi-green)" }}
                    >
                      🎉 全部完成！你的编织品即将完工！
                    </motion.p>
                  )}
                </AnimatePresence>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── KnitLogo ────────────────────────────────────────────────────────────────

function KnitLogo() {
  return (
    <div className="flex-shrink-0">
      <svg
        width="56"
        height="56"
        viewBox="0 0 72 72"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Yarn ball body */}
        <circle cx="36" cy="38" r="22" fill="#E8A89E" opacity="0.25" />
        <circle cx="36" cy="38" r="22" stroke="#E8A89E" strokeWidth="2.2" fill="none" />

        {/* Yarn wraps on the ball */}
        <path d="M16 30 Q36 22 56 30" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M14 38 Q36 30 58 38" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M16 46 Q36 38 56 46" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M26 17 Q32 38 26 59"  stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M36 16 Q42 38 36 60"  stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M46 17 Q40 38 46 59"  stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />

        {/* Knitting needle — diagonal, sage green */}
        <line x1="52" y1="10" x2="20" y2="42" stroke="#8FAF96" strokeWidth="3" strokeLinecap="round" />
        {/* Needle tip */}
        <circle cx="52" cy="10" r="3.5" fill="#8FAF96" />
        {/* Needle grip end */}
        <rect x="11" y="39" width="12" height="5" rx="2.5"
          fill="#8FAF96" transform="rotate(-45 17 41.5)" />

        {/* Yarn tail looping off the ball */}
        <path d="M54 38 Q64 28 58 18 Q52 10 56 6"
          stroke="#E8A89E" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ─── StepItem ────────────────────────────────────────────────────────────────

function StepItem({
  step,
  index,
  onToggle,
}: {
  step: Step;
  index: number;
  onToggle: () => void;
}) {
  return (
    <motion.li
      // Staggered slide-in when the list first appears
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: step.checked ? 0.72 : 1, x: 0 }}
      transition={{
        // entrance stagger
        opacity: { duration: 0.25, delay: index * 0.06 },
        x: {
          type: "spring",
          stiffness: 340,
          damping: 26,
          delay: index * 0.06,
        },
      }}
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
      style={{
        // checked → slightly darker stone background
        background: step.checked ? "var(--bg)" : "var(--bg-card)",
        border: `1.5px solid ${
          step.checked ? "var(--border)" : "var(--border)"
        }`,
        borderRadius: "1.25rem",
        transition: "background 0.2s, border-color 0.2s, opacity 0.2s",
      }}
    >
      {/* ── Lucide icon checkbox ── */}
      <motion.span
        animate={step.checked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.28 }}
        className="shrink-0"
      >
        {step.checked ? (
          <CheckCircle2
            size={22}
            strokeWidth={1.8}
            style={{ color: "var(--morandi-green)" }}
          />
        ) : (
          <Circle
            size={22}
            strokeWidth={1.8}
            style={{ color: "var(--morandi-stone)" }}
          />
        )}
      </motion.span>

      {/* ── Step text ── */}
      <span
        className="text-sm font-medium leading-relaxed"
        style={{
          color: step.checked ? "var(--text-muted)" : "var(--text-main)",
          textDecoration: step.checked ? "line-through" : "none",
          transition: "color 0.2s",
        }}
      >
        {step.text}
      </span>
    </motion.li>
  );
}
