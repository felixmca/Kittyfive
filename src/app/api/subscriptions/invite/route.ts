/**
 * POST /api/subscriptions/invite: an owner invites someone to get their pet's
 * new chapters by email. Double opt-in: the person gets one email with a
 * Confirm link and nothing else unless they press it.
 *
 * Body: { petId, email }. Auth: Authorization: Bearer <access token> of an
 * editor of the pet (invite_subscriber() checks, under their own RLS).
 * Someone already subscribed, or who unsubscribed, is not emailed again.
 * Refuses (503) before touching anything when email is not set up.
 */
import { mailConfigured, deliver } from "@/lib/mail";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { inviteEmail } from "@/lib/subscriptions/emails";
import { NOT_SET_UP, dbError, json } from "@/lib/subscriptions/server";
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!mailConfigured()) return json(NOT_SET_UP, 503);
  const limited = rateLimit(`sub-invite:${clientKey(req)}`, { limit: 40, windowMs: 60 * 60_000 });
  if (!limited.ok) return json({ error: "limit", message: "Slow down a little." }, 429);

  const as = await serverSupabaseAs(bearerToken(req) ?? "");
  if (!as) return json({ error: "sign-in", message: "Sign in first." }, 401);

  let body: { petId?: unknown; email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const petId = typeof body.petId === "string" ? body.petId : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 254) : "";
  if (!petId || !email) return json({ error: "bad-request" }, 400);

  const { data, error } = await as.sb.rpc("invite_subscriber", { p_pet: petId, p_email: email });
  if (error) return dbError(error);
  const row = (Array.isArray(data) ? data[0] : data) as { subscription_id: string; token: string | null; status: string } | undefined;
  if (!row) return json({ error: "db" }, 500);
  if (!row.token) return json({ status: row.status, sent: false });

  const { data: pet } = await as.sb.from("pets").select("name").eq("id", petId).maybeSingle();
  const mail = inviteEmail({
    to: email.toLowerCase(),
    petName: (pet as { name?: string } | null)?.name ?? "Kitty",
    token: row.token,
  });
  const delivery = await deliver(mail);
  await as.sb.rpc("log_story_email", {
    p_subscription: row.subscription_id,
    p_chapter: null,
    p_kind: "invite",
    p_status: delivery.sent ? "sent" : "failed",
    p_provider_id: delivery.id ?? null,
  });
  return json({ status: row.status, sent: delivery.sent });
}
