/**
 * Demo Commerce: no Stripe, no database, no money. Checkout "succeeds" by
 * redirecting straight to the success page with demo=1 so the whole UI can be
 * exercised with zero env vars. The DemoBanner makes this state unmissable.
 */
import { findVariant, PRODUCTS, SHIPPING, SNACK } from "@/config/products";
import { hasEmail, hasPod, hasStripe, hasSupabase } from "./env";
import { toSummary } from "./orders";
import { CommerceError, validateQuantity, type Commerce, type CommerceStatus, type OrderSummary } from "./types";

export function demoStatus(): CommerceStatus {
  return { mode: "demo", stripe: hasStripe(), supabase: hasSupabase(), pod: hasPod(), email: hasEmail() };
}

/** A believable order summary for the success page in demo mode. */
export function demoSummaryForVariant(variantId: string | undefined, quantity = 1, sessionId = "demo"): OrderSummary {
  const found = (variantId && findVariant(variantId)) || { product: PRODUCTS[0], variant: PRODUCTS[0].variants[0] };
  const qty = Number.isInteger(quantity) && quantity >= 1 && quantity <= 5 ? quantity : 1;
  const items = [
    {
      product_id: found.product.id,
      variant_id: found.variant.id,
      quantity: qty,
      unit_pence: found.product.pricePence,
    },
  ];
  return toSummary(
    {
      stripe_session_id: sessionId,
      kind: "merch",
      status: "paid",
      amount_pence: found.product.pricePence * qty + SHIPPING.ukPence,
      currency: "gbp",
      email: null,
      name: null,
      tracking: null,
      created_at: new Date().toISOString(),
    },
    items,
    { demo: true },
  );
}

export function demoSnackSummary(sessionId = "demo-snack"): OrderSummary {
  return toSummary(
    {
      stripe_session_id: sessionId,
      kind: "snack",
      status: "paid",
      amount_pence: SNACK.pricePence,
      currency: "gbp",
      email: null,
      name: null,
      tracking: null,
      created_at: new Date().toISOString(),
    },
    [{ product_id: "snack", variant_id: "snack", quantity: 1, unit_pence: SNACK.pricePence }],
    { demo: true },
  );
}

export function createDemoCommerce(): Commerce {
  return {
    async createMerchCheckout({ variantId, quantity, origin }) {
      const found = findVariant(variantId);
      if (!found) throw new CommerceError(`Unknown variant "${variantId}"`, 400);
      const qty = validateQuantity(quantity);
      console.log(`[commerce:demo] merch checkout ${found.product.name} / ${found.variant.label} x${qty} (no payment)`);
      const params = new URLSearchParams({ demo: "1", variant: variantId, qty: String(qty) });
      return { url: `${origin}/checkout/success?${params.toString()}` };
    },

    async createSnackCheckout({ origin }) {
      console.log("[commerce:demo] snack checkout (no payment)");
      return { url: `${origin}/store?snack=thanks&demo=1` };
    },

    async handleStripeEvent(_rawBody, signature) {
      // A signed event reaching the demo backend means Stripe is live but the
      // database is not (env regressed or half-configured). Refuse with 503 so
      // Stripe keeps retrying until the env is fixed, instead of swallowing a
      // real payment.
      if (signature) throw new CommerceError("Stripe webhook received while commerce is in demo mode", 503);
      return { received: true, demo: true };
    },

    async getOrderForSession(sessionId) {
      if (!sessionId) return null;
      if (sessionId.startsWith("demo-snack")) return demoSnackSummary(sessionId);
      return demoSummaryForVariant(undefined, 1, sessionId);
    },

    status: demoStatus,
  };
}
