"use client";
/**
 * "Has this browser signed in before?" without loading supabase-js. The
 * library stores the session under sb-<project-ref>-auth-token, so the menu
 * can say "Your account" instead of "Sign in" on pages (like the landing)
 * that should not pay for the auth client.
 */
import { SUPABASE_URL, supabaseConfigured } from "./config";

const ADMIN_HINT = "kittyfive-admin-hint";

/**
 * Remember (in this browser) that the signed-in account is an admin, so the
 * menu can offer "Admin" on pages that never load the auth client. Only a
 * hint for the menu: /admin and the database decide who is one.
 */
export function rememberAdmin(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(ADMIN_HINT, "1");
    else window.localStorage.removeItem(ADMIN_HINT);
  } catch {
    /* private mode */
  }
}

/** Signed in, and last seen as an admin in this browser. */
export function wasAdmin(): boolean {
  if (typeof window === "undefined" || !hasStoredSession()) return false;
  try {
    return window.localStorage.getItem(ADMIN_HINT) === "1";
  } catch {
    return false;
  }
}

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
