"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { DexieProjectStore } from "./DexieProjectStore";
import { SupabaseProjectStore } from "./SupabaseProjectStore";
import type { ProjectStore } from "../projectStore";

/**
 * Factory that picks the right ProjectStore implementation:
 *  - Logged in  → SupabaseProjectStore (writes to cloud + local cache)
 *  - Logged out → DexieProjectStore   (local IndexedDB only)
 */
export function createProjectStore(
  user: User | null,
  supabase: SupabaseClient,
): ProjectStore {
  if (user) {
    return new SupabaseProjectStore(supabase, user.id);
  }
  return new DexieProjectStore();
}
