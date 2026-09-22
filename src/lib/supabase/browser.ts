"use client";
/**
 * The browser's Supabase client: one per tab, session kept in localStorage,
 * refreshed automatically. Importing this module never creates a client;
 * the first call to browserSupabase() does, after authLanding has read the
 * URL (see authLanding.ts for why that order matters).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authLanding } from "@/lib/auth/authLanding";
import { SUPABASE_KEY, SUPABASE_URL, demoForcedIn, supabaseConfigured } from "./config";

// Evaluated for its side effect: capture the landing URL before any client.
void authLanding;

let client: SupabaseClient | null = null;

/** True when this page load should use real Supabase (configured, not ?demo=1). */
export function liveMode(): boolean {
  if (!supabaseConfigured) return false;
  if (typeof window === "undefined") return true;
  return !demoForcedIn(window.location.search);
}

export function browserSupabase(): SupabaseClient {
  if (typeof window === "undefined") throw new Error("browserSupabase() is browser-only");
  if (!supabaseConfigured) throw new Error("Supabase is not configured");
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { headers: { "X-Client-Info": "kittyfive-web" } },
  });
  return client;
}
