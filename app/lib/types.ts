"use client";

import type { StoredFile } from "./db";

// ─── Types ───────────────────────────────────────────────────────────────────

export type Lang = "zh" | "en";

export interface Step {
  id: number;
  text: string;
  original?: string;
  checked: boolean;
  isHeader?: boolean;
  count?: number;
  subCount?: number;
  sizeMap?: Record<string, string>;
  sourceBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax] in 0-1000 coords
  sourceFileIndex?: number;                     // index into project's originalFiles array
}

// GridCell is a union to support both legacy string cells (stored in DB) and
// the richer object format returned by the color-aware API.
// u: true flags an uncertain cell (low AI confidence) for visual highlighting.
export type GridCell = string | { s: string; c?: string; u?: boolean; span?: number };

export interface GridRow {
  rowNumber: number;
  type: string;
  cells: GridCell[];
}

export interface GridData {
  totalRows: number;
  totalStitches: number;
  rows: GridRow[];
  legend: Record<string, string>;
  colors?: Record<string, string>; // color palette: { "C1": "#2D5A27", ... }
  currentRow?: number;    // 1-based; persisted as knitting progress
  confidence?: number;    // 0-100 AI recognition confidence score
  analysisReport?: string; // brief description of recognition difficulty
}

export interface Project {
  id: string;
  name: string;
  steps: Step[];
  rowCount: number;
  lastUpdated: number;
  originalFile?: Blob | File;                     // legacy field — migration read only
  originalFiles?: StoredFile[] | (Blob | File)[]; // v2: Blob/File (legacy); v3+: StoredFile[]
  availableSizes: string[];
  selectedSize: string;
  type?: "instruction" | "grid";
  gridData?: GridData;
}

// ─── Translations dictionary ──────────────────────────────────────────────────

export const dict = {
  zh: {
    subtitle:       "将你的编织图解转为进度清单",
    tabText:        "文字录入",
    tabAI:          "智能识别",
    placeholder:    "粘贴你的织法图解...\n\n例如：\nR1: knit all. R2: purl all. Repeat R1-R2 for 10 rows.",
    convertBtn:     "开始转换 ✨",
    loadingBtn:     "✨ AI 正在编织清单...",
    errorQuota:     "AI 正在休息（频率限制），请 30 秒后再试。",
    errorTimeout:   "请求超时，请稍后重试。",
    errorKey:       "API Key 无效，请检查 .env.local 文件。",
    errorModel:     "模型暂不可用，请稍后重试。",
    errorUnknown:   "解析失败，请稍后重试。",
    errorFileTooLarge: "图片过大（请控制在 5MB 以内），请压缩后再试。",
    errorMaxImages: "最多上传 8 张图片。",
    clearAll:       "清除全部",
    compressing:    "正在压缩图片...",
    uploadTitle:    "拖拽图片或 PDF 到这里",
    uploadSub:      "KnitStep 帮你识别编织步骤",
    uploadClick:    "选择图片 / PDF 或拍照",
    uploadCamera:   "支持直接拍照，也可上传 PDF 文件",
    uploadPdfReady: "PDF 已就绪",
    uploadComing:   "🔜 AI 识别功能即将上线，敬请期待",
    checklistTitle: "步骤清单",
    noMatch:        "未识别到编织行指令。",
    noMatchSub:     "请确认文本包含 Row、R1、knit、purl 等关键词。",
    allDone:        "🎉 全部完成！你的编织作品完工啦！",
    editTip:        "提示：点击步骤可显示「编辑 / 查看原图」菜单",
    printBtn:       "打印图解",
    printFooter:    "由 KnitStep 生成",
    resetBtn:       "重置进度",
    resetConfirm:   "确定要清除所有进度吗？",
    myProjects:     "我的项目库",
    saveToLibrary:  "存入项目库",
    noProjects:     "暂无保存的项目",
    projectNamePrompt: "请为项目命名:",
    deleteConfirm:  "确定要删除这个项目吗？",
    editMode:       "编辑",
    editModeDone:   "完成",
    trySample:      "试试示例图解",
    feedback:       "有建议或报错？请告诉我！",
    aiSubPhoto:     "图片 / PDF",
    aiSubVideo:     "视频",
    videoUrlLabel:    "粘贴 YouTube 链接",
    videoUrlPlaceholder: "https://www.youtube.com/watch?v=...",
    loadingVideoBtn:  "✨ AI 正在从视频中提取图解，请稍候...",
    errorVideoFailed:   "视频处理失败，请重试。",
  },
  en: {
    subtitle:       "Turn your knitting patterns into a checklist",
    tabText:        "Text Input",
    tabAI:          "Smart Scan",
    placeholder:    "Paste your pattern here...\n\ne.g.:\nR1: CO 20 sts\nRow 2: Knit all stitches\nR3: K2, P2, repeat to end\nRow 4: Purl all sts\nBind off all sts",
    convertBtn:     "Convert Now ✨",
    loadingBtn:     "✨ AI is weaving your checklist...",
    errorQuota:     "AI is resting (rate limit). Please try again in 30 seconds.",
    errorTimeout:   "Request timed out. Please try again.",
    errorKey:       "Invalid API key. Please check your .env.local file.",
    errorModel:     "Model unavailable. Please try again later.",
    errorUnknown:   "Parsing failed. Please try again.",
    errorFileTooLarge: "Image too large (max 5 MB). Please compress it and try again.",
    errorMaxImages: "Maximum 8 images allowed.",
    clearAll:       "Clear all",
    compressing:    "Compressing image...",
    uploadTitle:    "Drag an image or PDF here",
    uploadSub:      "KnitStep will recognize your knitting steps",
    uploadClick:    "Browse Files or Take Photo",
    uploadCamera:   "Supports images, PDFs, and camera",
    uploadPdfReady: "PDF ready",
    uploadComing:   "🔜 AI recognition coming soon, stay tuned!",
    checklistTitle: "Checklist",
    noMatch:        "No knitting row instructions detected.",
    noMatchSub:     "Make sure the text contains keywords like Row, R1, knit, purl, etc.",
    allDone:        "🎉 All done! Your knitted piece is complete!",
    editTip:        "Tip: Tap a step to show Edit / Find options.",
    printBtn:       "Print Pattern",
    printFooter:    "Generated by KnitStep",
    resetBtn:       "Reset Progress",
    resetConfirm:   "Reset all progress?",
    myProjects:     "My Projects",
    saveToLibrary:  "Save",
    noProjects:     "No projects saved yet",
    projectNamePrompt: "Name this project:",
    deleteConfirm:  "Delete this project?",
    editMode:       "Edit",
    editModeDone:   "Done",
    trySample:      "Try Sample Pattern",
    feedback:       "Feedback or bugs? Tell us",
    aiSubPhoto:     "Photo / PDF",
    aiSubVideo:     "Video",
    videoUrlLabel:    "Paste a YouTube link",
    videoUrlPlaceholder: "https://www.youtube.com/watch?v=...",
    loadingVideoBtn:  "✨ Extracting pattern from video, please wait...",
    errorVideoFailed:   "Video processing failed. Please try again.",
  },
} as const;

// ─── Sample pattern ──────────────────────────────────────────────────────────

export const SAMPLE_PATTERN = `PATTERN
Sizes: XS (S, M, L, XL)

BRIM
Cast 60 (68, 76, 84, 92) stitches onto circular needles. We used a basic Long Tail Cast On.

Place unique marker and join for working in the round, being careful not to twist the stitches.

Round 1: *P2, k2, repeat from * to end of round.

Repeat Round 1 until piece measures 3½ (4, 4½, 5, 5) inches from cast-on edge.

BODY
Knit every round until piece measures 8 (8, 8¾, 9¼, 10) inches from cast-on edge.

CROWN
NOTE: If using short circular needles, change to double pointed needles when necessary.

Set-Up Round: Remove unique marker, k3, place unique marker for new end of round, [k15 (17, 19, 21, 23), place marker] 3 times, knit to end of round. [4 total stitch markers, including unique end-of-round marker]

Decrease Round: [Slip slip knit, knit to 2 stitches before next marker, knit 2 together, slip marker] 4 times. [8 stitches decreased]

Next Round: Knit to end of round.

Repeat last two rounds 5 (6, 7, 8, 9) more times. [12 stitches remain]

Cut yarn and thread tail onto a tapestry needle. Sew tail through remaining stitches. Pull taut and bring tail to inside of hat to weave in.

FINISHING
Weave in ends and block as desired.`;

// ─── Parse logic ─────────────────────────────────────────────────────────────

export const ROW_KEYWORDS =
  /\b(r\d+|row\s*\d+|repeat|stitch(?:es)?|cast\s*on|cast\s*off|bind\s*off|yarn|knit|purl|k\d+|p\d+|co\b|bo\b|sl\b|yo\b|k2tog|ssk)\b/i;

export function parseInput(raw: string): Step[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, idx) => ({ id: idx, text: line, checked: false }))
    .filter((step) => ROW_KEYWORDS.test(step.text));
}

// ─── Smart Sizing helpers ────────────────────────────────────────────────────

/** Collect all unique size labels (in first-appearance order) from a step array. */
export function getAvailableSizes(steps: Step[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const step of steps) {
    if (step.sizeMap) {
      for (const key of Object.keys(step.sizeMap)) {
        if (!seen.has(key)) { seen.add(key); result.push(key); }
      }
    }
  }
  return result;
}

/**
 * Returns the display text for a step.
 * When a specific size is selected and the step has that size in its sizeMap,
 * returns the size-specific replacement text; otherwise returns step.text.
 */
export function renderStepText(step: Step, selectedSize: string): string {
  if (selectedSize === "all" || !step.sizeMap) return step.text;
  return step.sizeMap[selectedSize] ?? step.text;
}

// ─── Image compression ───────────────────────────────────────────────────────

export const MAX_IMAGES = 8;
export const MAX_DIMENSION = 1280;
export const JPEG_QUALITY  = 0.7;

export async function compressImage(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width >= height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width  = MAX_DIMENSION;
        } else {
          width  = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas unavailable")); return; }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error("Compression failed")); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          const base64  = dataUrl.split(",")[1];
          resolve({ base64, mimeType: "image/jpeg", previewUrl: dataUrl });
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }, "image/jpeg", JPEG_QUALITY);
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
    img.src = objectUrl;
  });
}

// ─── File storage helpers ────────────────────────────────────────────────────

/** Returns true if `f` is a StoredFile (base64 record) rather than a Blob/File. */
export function isStoredFile(f: StoredFile | Blob | File): f is StoredFile {
  return !(f instanceof Blob) && typeof (f as StoredFile).data === "string";
}

/** Converts a File/Blob to a StoredFile (base64 + mimeType) safe for IndexedDB on all platforms. */
export async function fileToStoredFile(f: File | Blob): Promise<StoredFile> {
  const ab    = await f.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary  = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...(bytes.subarray(i, i + chunk) as unknown as number[]));
  }
  return { data: btoa(binary), mimeType: f.type || "application/octet-stream" };
}

// ─── Shared style tokens ─────────────────────────────────────────────────────

export const CARD_STYLE: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1.5px solid var(--border)",
  boxShadow: "0 10px 40px -15px rgba(0,0,0,0.05)",
};

export const RADIUS = "2rem";

export const ACCESS_CODE = "KNITSTEPBYSTEP";
