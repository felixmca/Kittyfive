/**
 * POST /api/webhooks/resend: bounces and spam complaints from Resend.
 *
 * A hard bounce marks the address's story subscriptions "bounced", a
 * complaint marks them "unsubscribed", so neither is emailed again (Resend
 * also keeps its own suppression list). Signed the Svix way with
 * RESEND_WEBHOOK_SECRET; writes with the service role key, because the
 * subscriptions table has no write access for anyone else. Without both it
 * answers 503 and changes nothing.
 */
import { getEnv } from "@/lib/commerce/env";
import { getSupabaseAdmin } from "@/lib/commerce/supabaseAdmin";
import { json } from "@/lib/subscriptions/server";
import { outcomeOf, verifySvix } from "@/lib/subscriptions/webhook";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";
  const env = getEnv();
  if (!secret || !env.supabaseServiceRoleKey || !env.supabaseUrl) {
    return json({ error: "not-set-up", message: "RESEND_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY are needed." }, 503);
  }
  const body = await req.text();
  if (body.length > 100_000) return json({ error: "too-big" }, 413);
  const ok = verifySvix(secret, body, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });
  if (!ok) return json({ error: "bad-signature" }, 401);

  let event: { type?: unknown; data?: { to?: unknown; bounce?: { type?: unknown } } };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const outcome = outcomeOf(event);
  if (!outcome) return json({ ignored: true });
  const to = Array.isArray(event.data?.to) ? event.data.to : [event.data?.to];
  const emails = to.filter((e): e is string => typeof e === "string").map((e) => e.trim().toLowerCase()).slice(0, 50);
  if (!emails.length) return json({ ignored: true });

  const { error, count } = await getSupabaseAdmin()
    .from("story_subscriptions")
    .update({ status: outcome, unsubscribed_at: new Date().toISOString() }, { count: "exact" })
    .in("email", emails)
    .neq("status", outcome);
  if (error) {
    console.error("[webhooks/resend] update failed:", error.message);
    return json({ error: "db" }, 500); // Resend retries
  }
  return json({ outcome, updated: count ?? 0 });
}
