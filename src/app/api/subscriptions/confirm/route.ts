/**
 * POST /api/subscriptions/confirm: the Confirm button on /subscribe/confirm.
 * Body: { token } from the invitation link. Anyone holding the token may use
 * it (that is what the link is for); nothing else is accepted.
 */
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { cleanToken, dbError, json } from "@/lib/subscriptions/server";
import { serverSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(`sub-confirm:${clientKey(req)}`, { limit: 20, windowMs: 10 * 60_000 });
  if (!limited.ok) return json({ error: "limit" }, 429);
  let body: { token?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const token = cleanToken(body.token);
  if (!token) return json({ error: "bad-link", message: "That link is not complete." }, 400);
  const sb = serverSupabase();
  if (!sb) return json({ error: "demo", message: "This site is running without a database." }, 503);
  const { data, error } = await sb.rpc("confirm_subscription", { p_token: token });
  if (error) return dbError(error);
  const row = (Array.isArray(data) ? data[0] : null) as { pet_slug: string; pet_name: string; status: string } | null;
  if (!row) return json({ error: "unknown-link", message: "That link doesn't match anything (it may be very old)." }, 404);
  return json({ status: row.status, petName: row.pet_name, petSlug: row.pet_slug });
}
