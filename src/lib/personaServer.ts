/**
 * Server side of Kitty Tunables: read a pet's tunables for /api/chat, with a
 * one-minute memory so a conversation does not ask the database every turn.
 * No database, no row, or an error: the defaults (src/lib/persona.ts).
 */
import { serverSupabase } from "@/lib/supabase/server";
import { DEFAULT_TUNABLES, cleanTunables, type Tunables } from "./persona";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<Tunables> }>();

export function loadTunables(petSlug: string): Promise<Tunables> {
  if (typeof window !== "undefined") throw new Error("loadTunables() is server-only");
  const now = Date.now();
  const hit = cache.get(petSlug);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  const value = (async (): Promise<Tunables> => {
    const sb = serverSupabase();
    if (!sb) return DEFAULT_TUNABLES;
    const { data, error } = await sb
      .from("pet_personas")
      .select("tunables, pets!inner(slug)")
      .eq("pets.slug", petSlug)
      .maybeSingle();
    if (error) {
      console.warn("[persona] read failed:", error.message);
      return DEFAULT_TUNABLES;
    }
    return data ? cleanTunables((data as { tunables: unknown }).tunables) : DEFAULT_TUNABLES;
  })().catch(() => DEFAULT_TUNABLES);
  cache.set(petSlug, { at: now, value });
  return value;
}
