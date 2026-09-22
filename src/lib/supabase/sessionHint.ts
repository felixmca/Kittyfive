"use client";
/**
 * "Has this browser signed in before?" without loading supabase-js. The
 * library stores the session under sb-<project-ref>-auth-token, so the menu
 * can say "Your account" instead of "Sign in" on pages (like the landing)
 * that should not pay for the auth client.
 */
import { SUPABASE_URL, supabaseConfigured } from "./config";

export function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (supabaseConfigured && !new URLSearchParams(window.location.search).has("demo")) {
      const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
      return Boolean(window.localStorage.getItem(`sb-${ref}-auth-token`));
    }
    return Boolean(window.localStorage.getItem("kittyfive-demo-auth"));
  } catch {
    return false;
  }
}
