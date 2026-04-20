"use client";

import type { Step, Project } from "../types";

// ─── Steps merge ──────────────────────────────────────────────────────────────

/**
 * Merge two versions of a steps array: a step is "checked" if it was checked
 * in EITHER version.  Uses the newer version's ordering and text as the base.
 *
 * This prevents losing progress when a user checks steps on two devices
 * without syncing (e.g., checked A+B on phone, checked B+C on tablet →
 * merged result has A+B+C checked).
 */
export function mergeSteps(base: Step[], other: Step[]): Step[] {
  if (!other || other.length === 0) return base;
  if (!base  || base.length  === 0) return other;

  const otherById = new Map(other.map((s) => [s.id, s]));

  return base.map((step) => {
    const counterpart = otherById.get(step.id);
    if (!counterpart) return step;
    // Union: checked if either side had it checked
    return { ...step, checked: step.checked || counterpart.checked };
  });
}

// ─── Sync conflict resolution ─────────────────────────────────────────────────

export interface SyncResult {
  toUpload:   Project[];  // local-only → push to cloud
  toDownload: Project[];  // cloud-only → pull to local
  toMerge:    { local: Project; cloud: Project }[];  // both sides changed
  upToDate:   Project[];  // identical lastUpdated, no action needed
}

/**
 * Compare local and cloud project lists to produce a sync plan.
 * Uses project `id` as the stable key.
 */
export function planSync(
  localProjects:  Project[],
  cloudProjects:  Project[],
): SyncResult {
  const localMap  = new Map(localProjects.map((p) => [p.id, p]));
  const cloudMap  = new Map(cloudProjects.map((p) => [p.id, p]));

  const toUpload:   Project[]                          = [];
  const toDownload: Project[]                          = [];
  const toMerge:    { local: Project; cloud: Project }[] = [];
  const upToDate:   Project[]                          = [];

  for (const [id, local] of localMap) {
    if (!cloudMap.has(id)) {
      toUpload.push(local);
    } else {
      const cloud = cloudMap.get(id)!;
      if (local.lastUpdated === cloud.lastUpdated) {
        upToDate.push(local);
      } else {
        toMerge.push({ local, cloud });
      }
    }
  }
  for (const [id, cloud] of cloudMap) {
    if (!localMap.has(id)) {
      toDownload.push(cloud);
    }
  }

  return { toUpload, toDownload, toMerge, upToDate };
}

/**
 * Resolve a single conflict between a local and cloud version.
 * Rules:
 *  - steps:     union-of-checked merge
 *  - currentRow (grid/tracker/crochet): newer lastUpdated wins (cursor, not mergeable)
 *  - everything else: newer lastUpdated wins
 */
export function resolveConflict(local: Project, cloud: Project): Project {
  const newer = local.lastUpdated >= cloud.lastUpdated ? local : cloud;
  const older = newer === local ? cloud : local;

  // Merge steps if both have them
  const mergedSteps =
    newer.steps.length > 0 || older.steps.length > 0
      ? mergeSteps(newer.steps, older.steps)
      : newer.steps;

  return { ...newer, steps: mergedSteps };
}
