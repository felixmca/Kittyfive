/**
 * Shared bits of the /api/subscriptions routes (server-only).
 */
export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Said when a route would send email and this deployment cannot. */
export const NOT_SET_UP = {
  error: "email-not-set-up",
  message: "Email isn't set up on this site yet: it needs a domain and Resend (Roadmap, Phase 5). Nothing was sent or changed.",
};

/** A database error from one of the subscription functions, as an HTTP answer. */
export function dbError(err: { code?: string; message?: string }): Response {
  const message = err.message ?? "Something went wrong.";
  switch (err.code) {
    case "42501":
      return json({ error: "forbidden", message: "Only the pet's owner can do that." }, 403);
    case "28000":
      return json({ error: "sign-in", message: "Sign in with a confirmed email first." }, 401);
    case "22023":
      return json({ error: "bad-email", message: "That doesn't look like an email address." }, 400);
    case "54000":
      return json({ error: "limit", message: "That's the limit for today: thirty invitations." }, 429);
    default:
      console.warn("[subscriptions] db error:", err.code, message);
      return json({ error: "db", message: "Something went wrong. Try again in a minute." }, 500);
  }
}

/** A 64-character token from the confirm/unsubscribe links, or null. */
export function cleanToken(v: unknown): string | null {
  return typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : null;
}
