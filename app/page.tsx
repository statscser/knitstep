"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Circle, CheckCircle2, UploadCloud } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Lang = "zh" | "en";

interface Step {
  id: number;
  text: string;
  checked: boolean;
}

// ─── Translations dictionary ──────────────────────────────────────────────────

const dict = {
  zh: {
    subtitle:       "将你的编织图解转为进度清单",
    tabText:        "文字录入",
    tabAI:          "智能识别",
    placeholder:    "粘贴你的织法图解...\n\n例如：\nR1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts",
    convertBtn:     "开始转换 ✨",
    uploadTitle:    "拖拽图片或视频到这里",
    uploadSub:      "KnitStep 帮你识别编织步骤",
    uploadClick:    "或点击选择文件",
    uploadComing:   "🔜 AI 识别功能即将上线，敬请期待",
    checklistTitle: "步骤清单",
    noMatch:        "未识别到编织行指令。",
    noMatchSub:     "请确认文本包含 Row、R1、knit、purl 等关键词。",
    allDone:        "🎉 全部完成！你的编织作品完工啦！",
  },
  en: {
    subtitle:       "Turn your knitting patterns into a checklist",
    tabText:        "Text Input",
    tabAI:          "Smart Scan",
    placeholder:    "Paste your pattern here...\n\ne.g.:\nR1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts",
    convertBtn:     "Convert Now ✨",
    uploadTitle:    "Drag an image or video here",
    uploadSub:      "KnitStep will recognize your knitting steps",
    uploadClick:    "or click to browse files",
    uploadComing:   "🔜 AI recognition coming soon, stay tuned!",
    checklistTitle: "Checklist",
    noMatch:        "No knitting row instructions detected.",
    noMatchSub:     "Make sure the text contains keywords like Row, R1, knit, purl, etc.",
    allDone:        "🎉 All done! Your knitted piece is complete!",
  },
} as const;

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

const RADIUS = "2rem";

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Language — persisted in localStorage ──
  const [lang, setLang] = useState<Lang>("zh");

  useEffect(() => {
    const saved = localStorage.getItem("knitstep-lang");
    if (saved === "zh" || saved === "en") setLang(saved);
  }, []);

  function toggleLang() {
    const next: Lang = lang === "zh" ? "en" : "zh";
    setLang(next);
    localStorage.setItem("knitstep-lang", next);
  }

  const t = dict[lang];

  // ── Core state ──
  const [inputText, setInputText] = useState(
    "R1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts"
  );
  const [steps, setSteps]               = useState<Step[]>([]);
  const [hasConverted, setHasConverted] = useState(false);
  const [activeTab, setActiveTab]       = useState<"text" | "ai">("text");

  // Placeholder — future: send file to AI vision API with lang-aware prompt:
  // "Detect the pattern language. If UI lang is 'zh', translate complex knitting
  //  terms into plain Chinese with the original term in parentheses. If 'en',
  //  output the checklist in English directly."
  function handleFileUpload(_file: File) {}

  function handleConvert() {
    setSteps(parseInput(inputText));
    setHasConverted(true);
  }

  function toggleStep(id: number) {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, checked: !s.checked } : s))
    );
  }

  const doneCount  = steps.filter((s) => s.checked).length;
  const totalCount = steps.length;
  const allDone    = totalCount > 0 && doneCount === totalCount;
  const isDisabled = inputText.trim().length === 0;

  return (
    <div
      className="relative min-h-screen flex flex-col items-center py-16 px-4"
      style={{ background: "var(--bg)", fontFamily: "var(--font-body)" }}
    >
      {/* ── Language toggle — fixed top-right ── */}
      <div className="fixed top-5 right-5 z-50">
        <LangToggle lang={lang} onToggle={toggleLang} />
      </div>

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
          <AnimatePresence mode="wait">
            <motion.p
              key={lang + "-subtitle"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22 }}
              className="mt-1 text-sm font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              {t.subtitle}
            </motion.p>
          </AnimatePresence>
        </div>
      </motion.header>

      {/* ── Input Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="w-full max-w-xl mb-6"
        style={{ ...CARD_STYLE, borderRadius: RADIUS, overflow: "hidden" }}
      >
        {/* ── Tabs ── */}
        <div className="flex" style={{ borderBottom: "1.5px solid var(--border)" }}>
          {(["text", "ai"] as const).map((tab) => {
            const label  = tab === "text" ? t.tabText : t.tabAI;
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="relative flex-1 py-3.5 text-sm font-semibold tracking-wide transition-colors duration-200"
                style={{
                  color:      active ? "var(--morandi-pink)" : "var(--text-muted)",
                  background: "transparent",
                  border:     "none",
                  cursor:     "pointer",
                }}
              >
                <AnimatePresence mode="wait">
                  <motion.span
                    key={lang + tab}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    {label}
                  </motion.span>
                </AnimatePresence>

                {active && (
                  <motion.span
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                    style={{ background: "var(--morandi-pink)" }}
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab panels ── */}
        <div className="p-8">
          <AnimatePresence mode="wait">

            {/* Text panel */}
            {activeTab === "text" && (
              <motion.div
                key="text"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 14 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <textarea
                  id="pattern-input"
                  rows={7}
                  className="w-full p-4 text-base resize-none focus:outline-none transition-all duration-200"
                  style={{
                    background:  "var(--bg)",
                    border:      "1.5px solid var(--border)",
                    borderRadius: "1.25rem",
                    color:       "var(--text-main)",
                    fontFamily:  "var(--font-body)",
                  }}
                  onFocus={(e) =>
                    (e.currentTarget.style.border = "1.5px solid var(--morandi-pink)")
                  }
                  onBlur={(e) =>
                    (e.currentTarget.style.border = "1.5px solid var(--border)")
                  }
                  placeholder={t.placeholder}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />

                <motion.button
                  onClick={handleConvert}
                  disabled={isDisabled}
                  whileHover={isDisabled ? {} : { scale: 1.05 }}
                  whileTap={isDisabled ? {} : { scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 380, damping: 16 }}
                  className="mt-5 w-full py-3.5 text-base font-semibold tracking-wide"
                  style={{
                    background:  "var(--morandi-pink)",
                    color:       "#fff",
                    borderRadius: RADIUS,
                    boxShadow:   "0 4px 20px -6px rgba(231,200,197,0.7)",
                    opacity:     isDisabled ? 0.45 : 1,
                    cursor:      isDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={lang + "-btn"}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.18 }}
                      className="block"
                    >
                      {t.convertBtn}
                    </motion.span>
                  </AnimatePresence>
                </motion.button>
              </motion.div>
            )}

            {/* AI Upload panel */}
            {activeTab === "ai" && (
              <motion.div
                key="ai"
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
              >
                <label
                  htmlFor="file-upload"
                  className="flex flex-col items-center justify-center gap-4 w-full cursor-pointer transition-all duration-200"
                  style={{
                    minHeight:  "220px",
                    border:     "2px dashed var(--morandi-sage)",
                    borderRadius: "1.5rem",
                    background: "var(--bg)",
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--morandi-pink)";
                    e.currentTarget.style.background  = "var(--bg-card)";
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--morandi-sage)";
                    e.currentTarget.style.background  = "var(--bg)";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = "var(--morandi-sage)";
                    e.currentTarget.style.background  = "var(--bg)";
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileUpload(file);
                  }}
                >
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 2.6, ease: "easeInOut" }}
                  >
                    <UploadCloud
                      size={48}
                      strokeWidth={1.4}
                      style={{ color: "var(--morandi-sage)" }}
                    />
                  </motion.div>

                  <div className="text-center px-4">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={lang + "-upload"}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                      >
                        <p className="text-sm font-semibold" style={{ color: "var(--text-main)" }}>
                          {t.uploadTitle}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                          {t.uploadSub}
                        </p>
                        <p
                          className="mt-3 text-xs px-3 py-1 rounded-full inline-block"
                          style={{ background: "var(--morandi-sage)", color: "#fff", opacity: 0.85 }}
                        >
                          {t.uploadClick}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  <input
                    id="file-upload"
                    type="file"
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                    }}
                  />
                </label>

                <AnimatePresence mode="wait">
                  <motion.p
                    key={lang + "-coming"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="mt-4 text-center text-xs"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {t.uploadComing}
                  </motion.p>
                </AnimatePresence>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
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
            <div className="flex items-center justify-between mb-5">
              <AnimatePresence mode="wait">
                <motion.span
                  key={lang + "-title"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="text-sm font-semibold uppercase tracking-widest"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.checklistTitle}
                </motion.span>
              </AnimatePresence>

              {totalCount > 0 && (
                <span
                  className="text-sm font-medium px-3 py-1 rounded-full"
                  style={{
                    background: "var(--bg)",
                    color:      "var(--text-muted)",
                    border:     "1px solid var(--border)",
                  }}
                >
                  {doneCount} / {totalCount}
                </span>
              )}
            </div>

            {totalCount === 0 ? (
              <AnimatePresence mode="wait">
                <motion.p
                  key={lang + "-nomatch"}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="text-sm text-center py-10"
                  style={{ color: "var(--text-muted)" }}
                >
                  {t.noMatch}
                  <br />
                  {t.noMatchSub}
                </motion.p>
              </AnimatePresence>
            ) : (
              <>
                <div
                  className="w-full h-2 rounded-full mb-6 overflow-hidden"
                  style={{ background: "var(--border)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--morandi-green)" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.round((doneCount / totalCount) * 100)}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>

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

                <AnimatePresence>
                  {allDone && (
                    <motion.p
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      className="mt-7 text-center text-sm font-semibold"
                      style={{ color: "var(--morandi-green)" }}
                    >
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={lang + "-done"}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.18 }}
                        >
                          {t.allDone}
                        </motion.span>
                      </AnimatePresence>
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

// ─── LangToggle ──────────────────────────────────────────────────────────────

function LangToggle({ lang, onToggle }: { lang: Lang; onToggle: () => void }) {
  return (
    <motion.button
      onClick={onToggle}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className="flex items-center gap-0.5 p-1 text-xs font-bold tracking-wider"
      style={{
        background:   "var(--morandi-stone)",
        borderRadius: "999px",
        border:       "1.5px solid var(--border)",
        boxShadow:    "0 2px 12px -4px rgba(0,0,0,0.1)",
        cursor:       "pointer",
      }}
      aria-label="Toggle language"
    >
      {(["zh", "en"] as const).map((l) => {
        const active = lang === l;
        return (
          <motion.span
            key={l}
            animate={{
              background: active ? "var(--morandi-pink)" : "transparent",
              color:      active ? "#fff" : "var(--text-muted)",
            }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="relative px-2.5 py-1 rounded-full"
            style={{ minWidth: "2rem", textAlign: "center" }}
          >
            {l === "zh" ? "ZH" : "EN"}
          </motion.span>
        );
      })}
    </motion.button>
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
        <circle cx="36" cy="38" r="22" fill="#E8A89E" opacity="0.25" />
        <circle cx="36" cy="38" r="22" stroke="#E8A89E" strokeWidth="2.2" fill="none" />
        <path d="M16 30 Q36 22 56 30" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M14 38 Q36 30 58 38" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M16 46 Q36 38 56 46" stroke="#E8A89E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M26 17 Q32 38 26 59" stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M36 16 Q42 38 36 60" stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M46 17 Q40 38 46 59" stroke="#E8A89E" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.6" />
        <line x1="52" y1="10" x2="20" y2="42" stroke="#8FAF96" strokeWidth="3" strokeLinecap="round" />
        <circle cx="52" cy="10" r="3.5" fill="#8FAF96" />
        <rect x="11" y="39" width="12" height="5" rx="2.5" fill="#8FAF96" transform="rotate(-45 17 41.5)" />
        <path d="M54 38 Q64 28 58 18 Q52 10 56 6" stroke="#E8A89E" strokeWidth="2" fill="none" strokeLinecap="round" />
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
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: step.checked ? 0.72 : 1, x: 0 }}
      transition={{
        opacity: { duration: 0.25, delay: index * 0.06 },
        x: { type: "spring", stiffness: 340, damping: 26, delay: index * 0.06 },
      }}
      whileTap={{ scale: 0.98 }}
      onClick={onToggle}
      className="flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none"
      style={{
        background:   step.checked ? "var(--bg)" : "var(--bg-card)",
        border:       "1.5px solid var(--border)",
        borderRadius: "1.25rem",
        transition:   "background 0.2s, opacity 0.2s",
      }}
    >
      <motion.span
        animate={step.checked ? { scale: [1, 1.3, 1] } : { scale: 1 }}
        transition={{ duration: 0.28 }}
        className="shrink-0"
      >
        {step.checked ? (
          <CheckCircle2 size={22} strokeWidth={1.8} style={{ color: "var(--morandi-green)" }} />
        ) : (
          <Circle size={22} strokeWidth={1.8} style={{ color: "var(--morandi-stone)" }} />
        )}
      </motion.span>

      <span
        className="text-sm font-medium leading-relaxed"
        style={{
          color:          step.checked ? "var(--text-muted)" : "var(--text-main)",
          textDecoration: step.checked ? "line-through" : "none",
          transition:     "color 0.2s",
        }}
      >
        {step.text}
      </span>
    </motion.li>
  );
}
