/**
 * POST /api/snack  ->  { url } | { error }
 * Creates a Stripe Checkout Session for the £1 snack (demo URL when unconfigured).
 */
import { NextResponse, type NextRequest } from "next/server";
import { getCommerce } from "@/lib/commerce";
import { resolveOrigin } from "@/lib/commerce/origin";
import { CommerceError, errorMessage } from "@/lib/commerce/types";
import { clientKey, rateLimit } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const limited = rateLimit(`snack:${clientKey(req)}`, { limit: 12, windowMs: 10 * 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Kitty is full for now. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } },
    );
  }

  const origin = resolveOrigin(req);
  try {
    const { url } = await getCommerce().createSnackCheckout({ origin });
    return NextResponse.json({ url });
  } catch (err) {
    const status = err instanceof CommerceError ? err.status : 500;
    console.error("[api/snack] failed:", err);
    return NextResponse.json(
      { error: status >= 500 ? "The snack tin is jammed. Please try again in a moment." : errorMessage(err) },
      { status },
    );
  }
}
