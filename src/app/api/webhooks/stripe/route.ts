/**
 * POST /api/webhooks/stripe
 * Raw body + stripe-signature -> stripe.webhooks.constructEvent -> orders.
 * 200 for handled, duplicate and ignored events; 400 for a bad signature;
 * 500 for an unexpected failure so Stripe retries. Print-provider failures
 * are recorded as order_events and still return 200.
 *
 * Local dev:  stripe listen --forward-to localhost:3200/api/webhooks/stripe
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCommerce } from "@/lib/commerce";
import { CommerceError } from "@/lib/commerce/types";

export const runtime = "nodejs";
// Fulfilment + email run in after() once the 200 is sent; give them room.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  try {
    const result = await getCommerce().handleStripeEvent(rawBody, signature);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof CommerceError && err.status < 500) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[webhooks/stripe] processing failed:", err);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
