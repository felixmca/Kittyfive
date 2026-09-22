/**
 * POST /api/checkout  { variantId: string, quantity?: 1..5 }  ->  { url } | { error }
 * Creates a Stripe Checkout Session for one merch variant (demo URL when unconfigured).
 */
import { NextResponse, type NextRequest } from "next/server";
import { findVariant } from "@/config/products";
import { getCommerce } from "@/lib/commerce";
import { resolveOrigin } from "@/lib/commerce/origin";
import { CommerceError, errorMessage, validateQuantity } from "@/lib/commerce/types";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const limited = rateLimit(`checkout:${clientKey(req)}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON: { variantId, quantity }" }, { status: 400 });
  }
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const variantId = typeof input.variantId === "string" ? input.variantId.trim() : "";
  if (!variantId || !findVariant(variantId)) {
    return NextResponse.json({ error: "Unknown variantId" }, { status: 400 });
  }

  let quantity: number;
  try {
    quantity = validateQuantity(input.quantity);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }

  const origin = resolveOrigin(req);
  try {
    const { url } = await getCommerce().createMerchCheckout({ variantId, quantity, origin });
    return NextResponse.json({ url });
  } catch (err) {
    const status = err instanceof CommerceError ? err.status : 500;
    console.error("[api/checkout] failed:", err);
    return NextResponse.json(
      {
        error:
          status >= 500 ? "Checkout is unavailable right now. Kitty is unbothered; please try again." : errorMessage(err),
      },
      { status },
    );
  }
}
