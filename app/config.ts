// Feature flags — set ENABLE_PROMPT_LAB = false before shipping to production
// to completely hide the Lab UI from end-users.
export const ENABLE_PROMPT_LAB = false;

// Login + Supabase cloud sync/storage — disabled while the Supabase project
// is suspended. Keeps the auth UI hidden and prevents any Supabase auth/db
// calls from firing (and failing with "Failed to fetch") on page load.
// Flip back to true once the database is restored.
export const ENABLE_AUTH = false;
