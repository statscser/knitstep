'use server'

// ── checkAccessCode ───────────────────────────────────────────────────────────
// Validates a user-supplied code against the server-side env variable.
// Called by the client's handleUnlock — the code never lives in the client bundle.
export async function checkAccessCode(code: string): Promise<boolean> {
  const VALID_CODE = process.env.ACCESS_CODE ?? "KNITSTEPBYSTEP";
  return code === VALID_CODE;
}
