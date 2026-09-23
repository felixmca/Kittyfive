"use client";
/**
 * Browser side of Kitty Tunables: read them (the store's opening line, the
 * /admin editor) and save them (the editor). Live mode goes through Supabase,
 * where RLS lets anyone read a public pet's tunables and only its editors
 * write them; demo mode keeps them in this browser.
 */
import { useEffect, useState } from "react";
import { browserSupabase, liveMode } from "@/lib/supabase/browser";
import { DEFAULT_TUNABLES, cleanTunables, type Tunables } from "./persona";

const DEMO_KEY = "kittyfive-demo-persona-v1";

function demoRead(slug: string): Tunables {
  try {
    const all = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "{}") as Record<string, unknown>;
    return cleanTunables(all[slug]);
  } catch {
    return DEFAULT_TUNABLES;
  }
}

function demoWrite(slug: string, t: Tunables): void {
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "{}") as Record<string, unknown>;
  } catch {
    all = {};
  }
  all[slug] = t;
  window.localStorage.setItem(DEMO_KEY, JSON.stringify(all));
}

/** A pet's tunables, or the defaults when it has none yet. */
export async function fetchTunables(petSlug: string): Promise<{ tunables: Tunables; saved: boolean; updatedAt: string | null }> {
  if (!liveMode()) {
    const raw = (() => {
      try {
        return (JSON.parse(window.localStorage.getItem(DEMO_KEY) ?? "{}") as Record<string, unknown>)[petSlug];
      } catch {
        return undefined;
      }
    })();
    return { tunables: demoRead(petSlug), saved: raw !== undefined, updatedAt: null };
  }
  const { data, error } = await browserSupabase()
    .from("pet_personas")
    .select("tunables, updated_at, pets!inner(slug)")
    .eq("pets.slug", petSlug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { tunables: DEFAULT_TUNABLES, saved: false, updatedAt: null };
  const row = data as { tunables: unknown; updated_at: string | null };
  return { tunables: cleanTunables(row.tunables), saved: true, updatedAt: row.updated_at };
}

/** Each pet's opening line, asked for once a visit (per pet). */
const openingCache = new Map<string, Promise<string>>();

/** Save a pet's tunables (editors only; RLS says no to anyone else). */
export async function saveTunables(petId: string, petSlug: string, t: Tunables): Promise<void> {
  const clean = cleanTunables(t);
  // The store asks again next time, so a new opening line shows without a reload.
  openingCache.delete(petSlug);
  if (!liveMode()) {
    demoWrite(petSlug, clean);
    return;
  }
  const { error } = await browserSupabase()
    .from("pet_personas")
    .upsert({ pet_id: petId, tunables: clean }, { onConflict: "pet_id" });
  if (error) throw new Error(error.message);
}

/** The first thing the pet says in the store, from its tunables (the default until they load). */
export function useOpeningLine(petSlug: string): string {
  const [line, setLine] = useState(DEFAULT_TUNABLES.opening);
  useEffect(() => {
    let cancelled = false;
    let opening = openingCache.get(petSlug);
    if (!opening) {
      opening = fetchTunables(petSlug)
        .then((r) => r.tunables.opening)
        .catch(() => DEFAULT_TUNABLES.opening);
      openingCache.set(petSlug, opening);
    }
    void opening.then((l) => {
      if (!cancelled) setLine(l);
    });
    return () => {
      cancelled = true;
    };
  }, [petSlug]);
  return line;
}
