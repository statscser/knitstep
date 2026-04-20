"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredFile } from "../db";
import type { Project, TrackerData, CrochetData } from "../types";
import { isStoredFile } from "../types";

const BUCKET = "project-images";

// ─── Blob helpers ─────────────────────────────────────────────────────────────

/** Convert a base64 data URL to a Blob. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, b64] = dataUrl.split(",");
  const mimeMatch     = header.match(/:(.*?);/);
  const mime          = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary        = atob(b64);
  const arr           = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Convert a StoredFile (base64) to a Blob. */
export function storedFileToBlob(sf: StoredFile): Blob {
  const binary = atob(sf.data);
  const arr    = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: sf.mimeType });
}

/** Fetch a URL and return its content as a base64 data URL. */
async function urlToDataUrl(url: string): Promise<string> {
  const res  = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

/** Upload a single image blob; returns the Storage path. */
async function uploadBlob(
  supabase: SupabaseClient,
  path: string,
  blob: Blob,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true });
  if (error) throw new Error(`[imageUtils] Storage upload failed: ${error.message}`);
}

/**
 * Upload all binary data in `project` to Supabase Storage.
 * Returns a new Project with `_imagePath` set in trackerData/crochetData
 * and `originalFiles` unchanged (base64 still there for local cache).
 *
 * Skips uploads if `_imagePath` is already set (idempotent).
 */
export async function uploadProjectImages(
  supabase: SupabaseClient,
  userId: string,
  project: Project,
): Promise<{ trackerData?: TrackerData; crochetData?: CrochetData; originalFilePaths: string[] }> {
  const base = `${userId}/${project.id}`;

  // TrackerData image
  let trackerData = project.trackerData;
  if (trackerData?.imageSrc && !trackerData._imagePath) {
    const path = `${base}/tracker.jpg`;
    await uploadBlob(supabase, path, dataUrlToBlob(trackerData.imageSrc));
    trackerData = { ...trackerData, _imagePath: path };
  }

  // CrochetData image
  let crochetData = project.crochetData;
  if (crochetData?.imageSrc && !crochetData._imagePath) {
    const path = `${base}/crochet.jpg`;
    await uploadBlob(supabase, path, dataUrlToBlob(crochetData.imageSrc));
    crochetData = { ...crochetData, _imagePath: path };
  }

  // Original files (instruction / grid chart references)
  let originalFilePaths: string[] = [];
  if (project.originalFiles && project.originalFiles.length > 0) {
    originalFilePaths = await Promise.all(
      project.originalFiles.map(async (f, i) => {
        if (!isStoredFile(f)) return "";
        const mimeExt = f.mimeType.includes("pdf") ? "pdf" : "jpg";
        const path    = `${base}/original_${i}.${mimeExt}`;
        await uploadBlob(supabase, path, storedFileToBlob(f));
        return path;
      }),
    );
  }

  return { trackerData, crochetData, originalFilePaths };
}

// ─── Download / rehydration ───────────────────────────────────────────────────

/**
 * Generate a short-lived signed URL for a Storage path.
 * Returns empty string on failure (graceful — components show blank image).
 */
export async function getSignedUrl(
  supabase: SupabaseClient,
  path: string,
  expiresIn = 3600,
): Promise<string> {
  if (!path) return "";
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return "";
  return data.signedUrl;
}

/**
 * Rehydrate a project's imageSrc fields from Supabase Storage.
 * Downloads the image and converts to a data URL so existing components
 * work unchanged.  Call this when a project is first OPENED (not on login).
 */
export async function rehydrateProjectImages(
  supabase: SupabaseClient,
  project: Project,
): Promise<Project> {
  let trackerData = project.trackerData;
  if (trackerData && !trackerData.imageSrc && trackerData._imagePath) {
    const signedUrl = await getSignedUrl(supabase, trackerData._imagePath);
    if (signedUrl) {
      const imageSrc = await urlToDataUrl(signedUrl);
      trackerData = { ...trackerData, imageSrc };
    }
  }

  let crochetData = project.crochetData;
  if (crochetData && !crochetData.imageSrc && crochetData._imagePath) {
    const signedUrl = await getSignedUrl(supabase, crochetData._imagePath);
    if (signedUrl) {
      const imageSrc = await urlToDataUrl(signedUrl);
      crochetData = { ...crochetData, imageSrc };
    }
  }

  // originalFiles: rehydrate from storage if they're empty (paths in originalFilePaths)
  // For now we leave originalFiles as-is; blob URL generation in useProjectManager handles it.

  return { ...project, trackerData, crochetData };
}

// ─── Storage cleanup ──────────────────────────────────────────────────────────

/** Delete all Storage files associated with a project. */
export async function deleteProjectImages(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  cloudRow: {
    original_file_paths?: string[];
    tracker_data?: { _imagePath?: string } | null;
    crochet_data?: { _imagePath?: string } | null;
  },
): Promise<void> {
  const paths: string[] = [];

  const trackerPath  = cloudRow.tracker_data?._imagePath;
  const crochetPath  = cloudRow.crochet_data?._imagePath;
  const origPaths    = cloudRow.original_file_paths ?? [];

  if (trackerPath) paths.push(trackerPath);
  if (crochetPath) paths.push(crochetPath);
  paths.push(...origPaths.filter(Boolean));

  if (paths.length === 0) return;

  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    // Log but don't throw — a missing file shouldn't block the delete flow
    console.warn("[imageUtils] Storage remove warning:", error.message);
  }
}
