"use client";
/**
 * What the address bar said when this module was first evaluated, which is
 * before any Supabase client exists (nothing here imports one).
 *
 * The ordering matters. supabase-js reads a confirmation or recovery link's
 * fragment during its own initialisation, turns it into a session, and wipes
 * the fragment with history.replaceState. Anything that looks at the URL
 * afterwards cannot tell "arrived from a reset link" from "arrived normally",
 * and would show the signed-in page to the one person who came to set a new
 * password. So: read the URL first, let the client do its work second.
 * (Learned in Birthday Lobby; see its PASSWORD-RESET.md.)
 *
 * Link shapes captured:
 *   · the default templates land with the session in the FRAGMENT and a
 *     `type` (`recovery`, `signup`, `magiclink`, `email_change`);
 *   · a template edited to use {{ .TokenHash }} lands with `?token_hash=…`;
 *   · a dead link (expired, or already used) lands with `error_description`.
 */
export interface AuthLanding {
  type: string | null;
  error: string | null;
  tokenHash: string | null;
}

export const authLanding: AuthLanding = readAuthLanding();

function readAuthLanding(): AuthLanding {
  const none: AuthLanding = { type: null, error: null, tokenHash: null };
  if (typeof window === "undefined") return none;
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const query = new URLSearchParams(window.location.search);
    const pick = (k: string) => hash.get(k) ?? query.get(k);
    return {
      type: pick("type"),
      error: pick("error_description") ?? pick("error"),
      tokenHash: pick("token_hash"),
    };
  } catch {
    return none;
  }
}

/**
 * Remove spent auth parameters from the address bar, surgically: `?demo=1`
 * rides in the same query string and must survive.
 */
export function scrubAuthParamsFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    let touched = false;
    for (const k of ["token_hash", "type", "error", "error_code", "error_description", "code"]) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        touched = true;
      }
    }
    if (url.hash) {
      url.hash = "";
      touched = true;
    }
    if (touched) window.history.replaceState(window.history.state, "", url.toString());
  } catch {
    /* ignore */
  }
}
