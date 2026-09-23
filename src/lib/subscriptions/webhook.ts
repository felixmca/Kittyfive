/**
 * Checking a Resend webhook (Resend signs them the Svix way): the body,
 * `svix-id` and `svix-timestamp` are signed with HMAC-SHA256 under the
 * endpoint's secret (`whsec_` + base64), and `svix-signature` carries one or
 * more "v1,<base64>" signatures. Old timestamps are refused (replays).
 *
 * Server-only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far a webhook's timestamp may be from now. */
const TOLERANCE_S = 5 * 60;

export function verifySvix(
  secret: string,
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  nowS: number = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  for (const part of signature.split(" ")) {
    const [version, value] = part.split(",", 2);
    if (version !== "v1" || !value) continue;
    let given: Buffer;
    try {
      given = Buffer.from(value, "base64");
    } catch {
      continue;
    }
    if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** What a Resend event means for a subscription: stop sending, or nothing. */
export function outcomeOf(event: { type?: unknown; data?: { bounce?: { type?: unknown } } }): "bounced" | "unsubscribed" | null {
  if (event.type === "email.complained") return "unsubscribed";
  if (event.type === "email.bounced") {
    // A temporary bounce (a full inbox) is not a reason to stop for good.
    const kind = String(event.data?.bounce?.type ?? "Permanent");
    return /transient|temporary/i.test(kind) ? null : "bounced";
  }
  return null;
}
