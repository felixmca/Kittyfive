/**
 * GET /api/subscriptions/status: can this deployment send email? The owner's
 * panel on /stories uses it to say so before anyone presses Send.
 */
import { mailConfigured } from "@/lib/mail";
import { json } from "@/lib/subscriptions/server";

export const runtime = "nodejs";

export function GET(): Response {
  return json({ email: mailConfigured() });
}
