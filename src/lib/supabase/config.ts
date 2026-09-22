/**
 * Supabase settings shared by the browser and the server. Nothing here is
 * secret: the URL and the publishable key ship in every browser bundle, and
 * row level security is what decides who can do what.
 *
 * With either value missing the site runs in demo mode: stories come from
 * src/config/stories.ts, sign-in is pretend, and edits live in the browser.
 */

export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");

/** The new sb_publishable_… key, or a legacy anon JWT; both work with supabase-js. */
export const SUPABASE_KEY = (
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  ""
).trim();

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

/** Public bucket for chapter photos, tile images and clip frames. */
export const MEDIA_BUCKET = "story-media";

/**
 * Resolve a stored media reference to a URL the browser can load.
 *
 *   "/story/01-a-cold-night/still.webp"  → as is (shipped with the site)
 *   "https://…"                           → as is
 *   "pets/<pet-id>/…"                     → the story-media bucket's public URL
 */
export function mediaUrl(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (/^(https?:|blob:|data:)/.test(ref) || ref.startsWith("/")) return ref;
  if (!SUPABASE_URL) return null;
  const path = ref
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${SUPABASE_URL}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`;
}

/**
 * `?demo=1` forces demo mode even when Supabase is configured. It exists for
 * the verification harness: `.env.local` holds the real project, so without
 * it every harness run would sign up throwaway users and write test chapters
 * into production (the lesson Birthday Lobby learned the hard way).
 */
export function demoForcedIn(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  return params.get("demo") === "1";
}
