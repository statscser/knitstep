import { NextResponse } from "next/server";
import { createClient } from "../../../lib/supabase/server";

/**
 * OAuth callback handler — Supabase redirects here after Google sign-in.
 * Exchanges the one-time `code` for a persistent session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  // `next` lets the caller redirect somewhere specific after login; default to "/"
  const next  = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Something went wrong — redirect to home with an error param
  return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
}
