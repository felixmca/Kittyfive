/**
 * POST /api/webhooks/pod
 * Print-on-demand webhook (Printful or Printify, whichever is configured).
 *
 * - Printify signs with X-Pfy-Signature (HMAC-SHA256 of the raw body).
 * - Printful v1 does not sign, so the endpoint is registered as
 *   /api/webhooks/pod?secret=… and the adapter checks that value.
 * - In live mode a provider MUST have a webhook secret configured, otherwise
 *   the route refuses (503) rather than accept unauthenticated status changes.
 * - Status only ever moves forward (paid → submitted → in_production →
 *   shipped → delivered); cancelled/failed are always accepted. Providers
 *   retry deliveries, so out-of-order arrival is normal.
 * - Bodies over 64 KB are rejected; the raw event is logged to order_events.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getEnv, isLive } from "@/lib/commerce/env";
import { sendShippedEmail } from "@/lib/commerce/email";
import { appendEvent, getOrderByPodOrderId, updateOrder } from "@/lib/commerce/orders";
import { getPod, PodSignatureError, PRINTFUL_SECRET_HEADER, type PodEvent } from "@/lib/commerce/pod";
import type { OrderStatus } from "@/lib/commerce/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 64 * 1024;
const RANK: Record<OrderStatus, number> = {
  paid: 0,
  submitted: 1,
  in_production: 2,
  shipped: 3,
  delivered: 4,
  cancelled: 99,
  failed: 99,
};

function advances(from: OrderStatus, to: OrderStatus): boolean {
  if (to === "cancelled" || to === "failed") return from !== "delivered";
  return RANK[to] > RANK[from];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const pod = getPod();
  const env = getEnv();
  const live = isLive();
  if (live) {
    const hasSecret =
      (pod.name === "printful" && Boolean(env.printfulWebhookSecret)) ||
      (pod.name === "printify" && Boolean(env.printifyWebhookSecret));
    if (!hasSecret) {
      console.error(`[webhooks/pod] refused: live mode with provider "${pod.name}" and no webhook secret`);
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }
  }

  const headers = new Headers(req.headers);
  const urlSecret = req.nextUrl.searchParams.get("secret");
  if (urlSecret && !headers.has(PRINTFUL_SECRET_HEADER)) headers.set(PRINTFUL_SECRET_HEADER, urlSecret);

  let event: PodEvent | null;
  try {
    event = pod.parseWebhook(rawBody, headers);
  } catch (err) {
    if (err instanceof PodSignatureError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[webhooks/pod] parse failed:", err);
    return NextResponse.json({ error: "Unreadable webhook" }, { status: 400 });
  }

  if (!event) return NextResponse.json({ received: true, ignored: true });
  if (!live) {
    console.log("[webhooks/pod:demo]", event.topic, event.providerOrderId, event.tracking);
    return NextResponse.json({ received: true, demo: true, type: event.type });
  }
  if (!event.providerOrderId) {
    await appendEvent(null, `pod_webhook:${event.topic}`, event.raw);
    return NextResponse.json({ received: true, matched: false });
  }

  try {
    const order = await getOrderByPodOrderId(event.providerOrderId);
    if (!order) {
      await appendEvent(null, `pod_webhook_unmatched:${event.topic}`, {
        providerOrderId: event.providerOrderId,
        raw: event.raw,
      });
      return NextResponse.json({ received: true, matched: false });
    }
    await appendEvent(order.id, `pod_webhook:${event.topic}`, event.raw);

    if (event.status && advances(order.status, event.status)) {
      const updated = await updateOrder(order.id, {
        status: event.status,
        tracking: event.tracking ?? order.tracking,
      });
      if (event.type === "shipment_created") {
        const mail = await sendShippedEmail(updated, event.tracking ?? updated.tracking);
        await appendEvent(order.id, mail.sent ? "email_shipped_sent" : "email_shipped_skipped", {
          to: updated.email,
          id: mail.id,
        });
      }
      return NextResponse.json({ received: true, matched: true, orderId: order.id, status: updated.status });
    }
    if (event.tracking && !order.tracking) {
      await updateOrder(order.id, { tracking: event.tracking });
    }
    return NextResponse.json({ received: true, matched: true, orderId: order.id, logged: true });
  } catch (err) {
    console.error("[webhooks/pod] processing failed:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
