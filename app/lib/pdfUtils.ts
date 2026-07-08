"use client";

import { JPEG_QUALITY } from "./types";

// Rasterization quality. Knitting charts are dense line art with small symbols;
// 1024px long-edge + JPEG 0.7 blurred adjacent symbols together, so pages are
// rendered at up to 1600px and encoded at 0.85 — then adaptively downgraded
// per page if the whole batch wouldn't fit the request-size limit (Vercel
// rejects bodies over ~4.5 MB, and base64 inflates bytes by ~33%).
const PDF_MAX_DIMENSION  = 1600;
const PDF_MAX_SCALE      = 3.0;
const PDF_JPEG_QUALITY   = 0.85;
const FALLBACK_QUALITY   = JPEG_QUALITY; // 0.7 — the pre-2026 default
const FALLBACK_DIMENSION = 1024;
/** Total base64 chars allowed across all pages (~3.3 MB decoded, safe margin). */
const TOTAL_BASE64_BUDGET = 3_500_000;
export const MAX_PDF_PAGES = 20;

// pdfjs v6 always creates workers with { type: "module" }, which fails in WeChat
// WebView and iOS < 15.4. We instead create a classic (IIFE) Worker from
// pdf.worker.min.js (pre-compiled via esbuild --format=iife) and pass it via
// workerPort so pdfjs skips its module-worker path entirely.
let pdfjsLib: typeof import("pdfjs-dist") | null = null;
let classicWorker: Worker | null = null;

async function getLib() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    // workerSrc is a required fallback field; the actual worker is overridden
    // per-document via workerPort below.
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  if (!classicWorker && typeof Worker !== "undefined") {
    try {
      classicWorker = new Worker("/pdf.worker.min.js", { type: "classic" });
    } catch (workerErr) {
      console.warn("[PDF] Failed to load classic worker, will use fallback:", workerErr);
      // Some environments (headless, SSR guard) don't support Worker; ok — pdfjs
      // will fall back to its own fake-worker path via workerSrc.
      // Try fallback worker (module version)
      try {
        classicWorker = new Worker("/pdf.worker.min.mjs", { type: "module" });
      } catch (modErr) {
        console.warn("[PDF] Failed to load module worker too:", modErr);
        // Both failed - pdfjs will use inline fake worker
      }
    }
  }
  return pdfjsLib;
}

/**
 * Opens a PDF document using a classic Worker.
 * Caller MUST call pdf.destroy() when done to free the worker port for reuse.
 */
async function openPdf(arrayBuffer: ArrayBuffer) {
  const lib = await getLib();
  // Set workerPort so pdfjs uses our classic Worker (bypasses module-worker path).
  // Reset immediately after getDocument() resolves — pdfjs has already captured
  // the port in its internal PDFWorker instance; the global is only read once.
  const hadWorkerPort = !!lib.GlobalWorkerOptions.workerPort;
  if (classicWorker && !hadWorkerPort) {
    lib.GlobalWorkerOptions.workerPort = classicWorker;
  }
  try {
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    if (!hadWorkerPort) {
      lib.GlobalWorkerOptions.workerPort = null;
    }
    return pdf;
  } catch (err) {
    if (!hadWorkerPort) {
      lib.GlobalWorkerOptions.workerPort = null;
    }
    throw err;
  }
}

/**
 * Extract raw text from a PDF using its text layer.
 * Returns { text: "", numPages } for scanned (image-only) PDFs.
 */
export async function pdfToText(file: File): Promise<{ text: string; numPages: number }> {
  let arrayBuffer: ArrayBuffer;

  // Handle arrayBuffer() API compatibility on mobile
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    // Fallback for older browsers/environments
    arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error("FileReader failed to produce ArrayBuffer"));
        }
      };
      reader.onerror = () => reject(new Error("FileReader error"));
      reader.readAsArrayBuffer(file);
    });
  }

  const pdf = await openPdf(arrayBuffer);
  try {
    const numPages = pdf.numPages;
    const limit = Math.min(numPages, MAX_PDF_PAGES);
    let text = "";
    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .filter((item) => "str" in item)
        .map((item) => (item as { str: string }).str)
        .join(" ");
      text += pageText + "\n\n";
    }
    return { text: text.trim(), numPages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/**
 * Encodes a canvas to a JPEG data URL. toDataURL is the primary method (more
 * compatible on mobile); toBlob with a timeout is the fallback.
 */
async function encodeCanvas(
  canvas: HTMLCanvasElement,
  pageNum: number,
  quality: number,
): Promise<string> {
  try {
    const url = canvas.toDataURL("image/jpeg", quality);
    // Validate that toDataURL actually produced a data URL
    if (url && url.startsWith("data:")) return url;
  } catch (err) {
    console.warn(`[PDF] Page ${pageNum} toDataURL failed:`, err);
  }

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Page ${pageNum}: toBlob timeout after 10s`)),
      10000,
    );

    canvas.toBlob(
      (blob) => {
        clearTimeout(timeout);
        if (!blob) {
          reject(new Error(`Page ${pageNum}: toBlob returned null`));
          return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
          clearTimeout(timeout);
          try {
            const result = e.target?.result;
            if (typeof result === "string" && result.startsWith("data:")) {
              resolve(result);
            } else {
              reject(new Error(`Page ${pageNum}: FileReader produced invalid result`));
            }
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => {
          clearTimeout(timeout);
          reject(new Error(`Page ${pageNum}: FileReader error`));
        };
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

export async function pdfToImages(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }[]> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    arrayBuffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (result instanceof ArrayBuffer) {
          resolve(result);
        } else {
          reject(new Error("FileReader failed to produce ArrayBuffer"));
        }
      };
      reader.onerror = () => reject(new Error("FileReader error"));
      reader.readAsArrayBuffer(file);
    });
  }

  const pdf = await openPdf(arrayBuffer);
  const numPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const results: { base64: string; mimeType: string; previewUrl: string }[] = [];

  // Each page gets an equal share of the request-size budget: short PDFs
  // (the common case) get full quality, long PDFs degrade gracefully instead
  // of blowing the platform's body-size limit with a hard 413.
  const perPageBudget = Math.floor(TOTAL_BASE64_BUDGET / numPages);

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scale = Math.min(
        PDF_MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height),
        PDF_MAX_SCALE,
      );
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable");

      await page.render({ canvasContext: ctx as any, viewport, canvas }).promise;

      // Adaptive encoding: full quality first, degrade only if this page
      // would exceed its share of the total payload budget.
      let quality = PDF_JPEG_QUALITY;
      let dataUrl = await encodeCanvas(canvas, pageNum, quality);

      if (dataUrl.length > perPageBudget) {
        quality = FALLBACK_QUALITY;
        dataUrl = await encodeCanvas(canvas, pageNum, quality);
      }

      if (dataUrl.length > perPageBudget && Math.max(canvas.width, canvas.height) > FALLBACK_DIMENSION) {
        const shrink  = FALLBACK_DIMENSION / Math.max(canvas.width, canvas.height);
        const small   = document.createElement("canvas");
        small.width   = Math.round(canvas.width * shrink);
        small.height  = Math.round(canvas.height * shrink);
        const sctx = small.getContext("2d");
        if (sctx) {
          sctx.drawImage(canvas, 0, 0, small.width, small.height);
          dataUrl = await encodeCanvas(small, pageNum, FALLBACK_QUALITY);
        }
      }

      console.info(
        `[PDF] page ${pageNum}/${numPages}: ${canvas.width}x${canvas.height} q=${quality} size=${Math.round(dataUrl.length / 1024)}KB (budget ${Math.round(perPageBudget / 1024)}KB)`,
      );

      const base64 = dataUrl.split(",")[1];
      if (!base64) {
        throw new Error(`Page ${pageNum}: Failed to extract base64 from data URL`);
      }

      results.push({
        base64,
        mimeType: "image/jpeg",
        previewUrl: dataUrl,
      });
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  return results;
}
