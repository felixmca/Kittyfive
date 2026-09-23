/**
 * POST /api/subscriptions/unsubscribe: stop a subscription with the token
 * from an email. Two callers:
 *
 *   the Stop button on /unsubscribe     JSON { token }
 *   a mail app's one-click unsubscribe  ?t=<token>, body
 *                                       "List-Unsubscribe=One-Click" (RFC 8058)
 *
 * GET does nothing (mail scanners open links): the page asks for a press.
 */
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { cleanToken, dbError, json } from "@/lib/subscriptions/server";
import { serverSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(`sub-stop:${clientKey(req)}`, { limit: 30, windowMs: 10 * 60_000 });
  if (!limited.ok) return json({ error: "limit" }, 429);
  let token = cleanToken(new URL(req.url).searchParams.get("t"));
  if (!token && (req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      token = cleanToken(((await req.json()) as { token?: unknown }).token);
    } catch {
      token = null;
    }
  }
  if (!token) return json({ error: "bad-link", message: "That link is not complete." }, 400);
  const sb = serverSupabase();
  if (!sb) return json({ error: "demo", message: "This site is running without a database." }, 503);
  const { data, error } = await sb.rpc("unsubscribe_by_token", { p_token: token });
  if (error) return dbError(error);
  const row = (Array.isArray(data) ? data[0] : null) as { pet_slug: string; pet_name: string; status: string } | null;
  if (!row) return json({ error: "unknown-link", message: "That link doesn't match anything (it may be very old)." }, 404);
  return json({ status: row.status, petName: row.pet_name, petSlug: row.pet_slug });
}
