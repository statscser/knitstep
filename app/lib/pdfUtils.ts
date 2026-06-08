"use client";

import { JPEG_QUALITY } from "./types";

const PDF_MAX_DIMENSION = 1024;
export const MAX_PDF_PAGES = 20;

let workerSet = false;

async function getPdfjsLib() {
  const pdfjsLib = await import("pdfjs-dist");
  if (!workerSet) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    workerSet = true;
  }
  return pdfjsLib;
}

/**
 * Extract raw text from a PDF using its text layer.
 * Returns empty string for scanned (image-only) PDFs.
 */
export async function pdfToText(file: File): Promise<{ text: string; numPages: number }> {
  const pdfjsLib = await getPdfjsLib();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
}

export async function pdfToImages(
  file: File,
): Promise<{ base64: string; mimeType: string; previewUrl: string }[]> {
  const pdfjsLib = await getPdfjsLib();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const numPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const results: { base64: string; mimeType: string; previewUrl: string }[] = [];

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

  return results;
}
