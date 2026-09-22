/**
 * Server-side Supabase client with no session: it reads exactly what an
 * anonymous visitor may read (published chapters of public pets), which is
 * what server-rendered pages show. Owner-only data is fetched in the browser
 * with the owner's own session, so RLS stays the single gate.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, supabaseConfigured } from "./config";

let client: SupabaseClient | null = null;

export function serverSupabase(): SupabaseClient | null {
  if (typeof window !== "undefined") throw new Error("serverSupabase() is server-only");
  if (!supabaseConfigured) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "X-Client-Info": "kittyfive-server" } },
  });
  return client;
}

/**
 * A server client that acts as the signed-in user whose access token came
 * with the request (Authorization: Bearer …). Every query runs under that
 * user's RLS. Returns the client and the verified user, or null.
 */
export async function serverSupabaseAs(
  accessToken: string,
): Promise<{ sb: SupabaseClient; userId: string; email: string | null } | null> {
  if (!supabaseConfigured || !accessToken) return null;
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${accessToken}`, "X-Client-Info": "kittyfive-server" } },
  });
  const { data, error } = await sb.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { sb, userId: data.user.id, email: data.user.email ?? null };
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}
