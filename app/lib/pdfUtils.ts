"use client";

import { JPEG_QUALITY } from "./types";

const PDF_MAX_DIMENSION = 1024;
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
      classicWorker = new Worker("/pdf.worker.min.js");
    } catch {
      // Some environments (headless, SSR guard) don't support Worker; ok — pdfjs
      // will fall back to its own fake-worker path via workerSrc.
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
  if (classicWorker) {
    lib.GlobalWorkerOptions.workerPort = classicWorker;
  }
  try {
    const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
    lib.GlobalWorkerOptions.workerPort = null;
    return pdf;
  } catch (err) {
    lib.GlobalWorkerOptions.workerPort = null;
    throw err;
  }
}

/**
 * Extract raw text from a PDF using its text layer.
 * Returns { text: "", numPages } for scanned (image-only) PDFs.
 */
export async function pdfToText(file: File): Promise<{ text: string; numPages: number }> {
  const arrayBuffer = await file.arrayBuffer();
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
    // Always destroy — frees the workerPort entry so the next call can reuse
    // the same classicWorker instance.
    await pdf.loadingTask.destroy();
  }
}

export async function pdfToImages(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await openPdf(arrayBuffer);
  const numPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const results: { base64: string; mimeType: string; previewUrl: string }[] = [];

  try {
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scale = Math.min(
        PDF_MAX_DIMENSION / Math.max(baseViewport.width, baseViewport.height),
        2.0,
      );
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");

      await page.render({ canvasContext: ctx as any, viewport, canvas }).promise;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error("toBlob failed")); return; }
            const reader = new FileReader();
            reader.onload  = (e) => resolve(e.target!.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      });

      results.push({
        base64:     dataUrl.split(",")[1],
        mimeType:   "image/jpeg",
        previewUrl: dataUrl,
      });
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  return results;
}
