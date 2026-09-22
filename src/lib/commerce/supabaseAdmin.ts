/**
 * Supabase client with the SERVICE ROLE key. Server-only: bypasses RLS, so it
 * must never reach a client bundle. Import it only from route handlers,
 * server components and lib/commerce.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

const SERVER_ONLY = "supabaseAdmin is server-only and must never be imported by a client component";

if (typeof window !== "undefined") {
  throw new Error(SERVER_ONLY);
}

let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error(SERVER_ONLY);
  if (client) return client;
  const { supabaseUrl, supabaseServiceRoleKey } = getEnv();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  client = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "kitty-commerce" } },
  });
  return client;
}
