/**
 * Live Commerce: Stripe Checkout Sessions, a signature-verified webhook,
 * Supabase orders, print-on-demand submission and email.
 *
 * Verified against stripe-node 22.6.2 (API 2026-08-26.dahlia): the shipping
 * address of a completed session lives at
 * session.collected_information.shipping_details, contact details at
 * session.customer_details.
 */
import { after } from "next/server";
import Stripe from "stripe";
import { findVariant, SHIPPING, SNACK } from "@/config/products";
import { SITE } from "@/config/site";
import { sendOrderConfirmation } from "./email";
import { getEnv, hasEmail, hasPod, hasStripe, hasSupabase, isLive } from "./env";
import {
  appendEvent,
  ensureOrderItems,
  getOrderBySessionId,
  insertOrderIdempotent,
  toSummary,
  updateOrder,
  type NewOrder,
  type NewOrderItem,
  type OrderItemRow,
  type OrderRow,
} from "./orders";
import { getPod, mapItemsToPod, toPodAddress } from "./pod";
import {
  CommerceError,
  errorMessage,
  validateQuantity,
  type Commerce,
  type CommerceStatus,
  type OrderKind,
  type PostalAddress,
  type StripeWebhookResult,
} from "./types";

let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const { stripeSecretKey } = getEnv();
  if (!stripeSecretKey) throw new CommerceError("Stripe is not configured", 503);
  stripeClient = new Stripe(stripeSecretKey, {
    appInfo: { name: "Kitty", url: SITE.url },
  });
  return stripeClient;
}

/** Stripe fetches product images itself, so only public https URLs are useful. */
function absoluteImage(origin: string, path: string | undefined): string[] {
  if (!path) return [];
  try {
    const url = new URL(path, origin);
    return url.protocol === "https:" ? [url.toString()] : [];
  } catch {
    return [];
  }
}

const ALLOWED_COUNTRIES = [
  ...SHIPPING.countries,
] as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];

export function sessionToNewOrder(session: Stripe.Checkout.Session): { order: NewOrder; items: NewOrderItem[] } {
  const meta = session.metadata ?? {};
  const kind: OrderKind = meta.kind === "snack" ? "snack" : "merch";
  // API ≥ 2025-03-31.basil: collected_information.shipping_details. Older
  // webhook endpoint versions render the legacy top-level shipping_details;
  // processPaidSession re-fetches with the SDK's pinned version, but keep the
  // fallback so a raw event still yields an address.
  type LegacyShipping = { shipping_details?: Stripe.Checkout.Session.CollectedInformation.ShippingDetails | null };
  const shipping =
    session.collected_information?.shipping_details ?? (session as LegacyShipping).shipping_details ?? null;
  const customer = session.customer_details;

  const address: PostalAddress | null = shipping?.address
    ? {
        name: shipping.name,
        line1: shipping.address.line1 ?? "",
        line2: shipping.address.line2 ?? null,
        city: shipping.address.city ?? "",
        state: shipping.address.state ?? null,
        postalCode: shipping.address.postal_code ?? "",
        country: shipping.address.country ?? "",
      }
    : null;

  const items: NewOrderItem[] = [];
  if (kind === "snack") {
    items.push({ product_id: "snack", variant_id: "snack", quantity: 1, unit_pence: SNACK.pricePence });
  } else if (meta.variantId) {
    const found = findVariant(meta.variantId);
    const quantity = Number.parseInt(meta.quantity ?? "1", 10) || 1;
    items.push({
      product_id: meta.productId || found?.product.id || "unknown",
      variant_id: meta.variantId,
      quantity,
      unit_pence: found?.product.pricePence ?? 0,
    });
  }

  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  return {
    order: {
      stripe_session_id: session.id,
      stripe_payment_intent: paymentIntent,
      kind,
      status: "paid",
      email: customer?.email ?? session.customer_email ?? null,
      name: shipping?.name ?? customer?.name ?? null,
      phone: customer?.phone ?? null,
      address,
      amount_pence: session.amount_total ?? 0,
      currency: (session.currency ?? "gbp").toLowerCase(),
    },
    items,
  };
}

/** What we keep in the append-only log: enough to audit, no card data (Stripe never sends any). */
function redactSession(session: Stripe.Checkout.Session) {
  return {
    id: session.id,
    payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
    payment_status: session.payment_status,
    status: session.status,
    amount_subtotal: session.amount_subtotal,
    amount_total: session.amount_total,
    currency: session.currency,
    customer_details: session.customer_details,
    collected_information: session.collected_information,
    shipping_cost: session.shipping_cost,
    metadata: session.metadata,
    created: session.created,
    livemode: session.livemode,
  };
}

/** Submit a paid merch order to the print provider. Never throws; records the outcome as events. */
async function fulfil(order: OrderRow, items: OrderItemRow[]): Promise<OrderRow> {
  if (order.pod_order_id) return order; // already submitted (this is a resumed retry)
  const { mapped, unmapped } = mapItemsToPod(items);
  if (unmapped.length) {
    await appendEvent(order.id, "pod_unmapped", {
      unmapped,
      note: "No podProductId/podVariantId in src/config/products.ts; fulfil manually. Status stays paid.",
    });
    return order;
  }
  if (!order.address) {
    await appendEvent(order.id, "pod_no_address", { note: "Session had no shipping address; fulfil manually." });
    return order;
  }
  if (!hasPod()) {
    await appendEvent(order.id, "pod_not_configured", {
      note: "PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID unset; fulfil manually. Status stays paid.",
    });
    return order;
  }
  const pod = getPod();
  let result: Awaited<ReturnType<typeof pod.createOrder>>;
  try {
    result = await pod.createOrder(
      { id: order.id, stripeSessionId: order.stripe_session_id, email: order.email },
      mapped,
      toPodAddress(order.address, order.email, order.phone),
    );
  } catch (err) {
    await appendEvent(order.id, "pod_failed", { provider: pod.name, message: errorMessage(err) });
    console.error(`[commerce] pod.createOrder failed for ${order.id}:`, err);
    return order;
  }
  // The provider now holds an order. Whatever happens next, its id must not be
  // lost, or a later manual resubmission would print the order twice.
  try {
    const updated = await updateOrder(order.id, {
      status: "submitted",
      pod_provider: pod.name,
      pod_order_id: result.providerOrderId,
    });
    await appendEvent(order.id, "pod_submitted", { provider: pod.name, ...result });
    return updated;
  } catch (err) {
    await appendEvent(order.id, "pod_submitted_unrecorded", {
      provider: pod.name,
      providerOrderId: result.providerOrderId,
      message: errorMessage(err),
      note: "Provider accepted the order but the row update failed. Do NOT resubmit; set pod_order_id by hand.",
    }).catch(() => undefined);
    console.error(`[commerce] pod order ${result.providerOrderId} created but not recorded for ${order.id}:`, err);
    return { ...order, pod_provider: pod.name, pod_order_id: result.providerOrderId };
  }
}

/**
 * Called for every paid checkout.session.* delivery, including Stripe's
 * retries. Three properties, in order of importance:
 *
 * 1. Exactly one order row per session (ON CONFLICT DO NOTHING in
 *    insertOrderIdempotent), so a retry can never print twice.
 * 2. A retry for an order that was inserted but never finished (items,
 *    fulfilment, email) RESUMES that work instead of returning "duplicate":
 *    `processed_at` is only set at the very end.
 * 3. The 200 goes back to Stripe as soon as the row and its event exist;
 *    the print provider (two 15 s timeouts) and email run in `after()`, so
 *    the hosted Checkout redirect never waits on them.
 */
async function processPaidSession(rawSession: Stripe.Checkout.Session, eventType: string): Promise<StripeWebhookResult> {
  // The event body is rendered with the webhook endpoint's API version, which
  // may predate collected_information; the SDK's pinned version is what this
  // module was written against. Fall back to the raw event on any failure.
  const session = await getStripe()
    .checkout.sessions.retrieve(rawSession.id)
    .catch(() => rawSession);
  if (session.payment_status !== "paid") {
    return { received: true, type: eventType, handled: false, note: `payment_status=${session.payment_status}` };
  }

  const { order: newOrder, items } = sessionToNewOrder(session);
  const { order, isNew } = await insertOrderIdempotent(newOrder, items);
  if (!isNew && order.processed_at) {
    return { received: true, type: eventType, handled: true, duplicate: true, orderId: order.id };
  }
  if (isNew) await appendEvent(order.id, `stripe.${eventType}`, redactSession(session));
  else await appendEvent(order.id, `stripe.${eventType}.resumed`, { note: "earlier delivery did not finish" });

  const itemRows: OrderItemRow[] = isNew
    ? items.map((item, index) => ({ id: index, order_id: order.id, ...item }))
    : await ensureOrderItems(order.id, items);

  after(async () => {
    try {
      let current = order;
      if (order.kind === "merch") current = await fulfil(order, itemRows);
      const mail = await sendOrderConfirmation(current, itemRows);
      await appendEvent(order.id, mail.sent ? "email_confirmation_sent" : "email_confirmation_skipped", {
        to: current.email,
        id: mail.id,
      });
      await updateOrder(order.id, { processed_at: new Date().toISOString() });
    } catch (err) {
      // processed_at stays null, so Stripe's next retry (or a manual replay
      // from the Dashboard) resumes from here.
      console.error(`[commerce] deferred fulfilment failed for ${order.id}:`, err);
      await appendEvent(order.id, "fulfilment_deferred_failed", { message: errorMessage(err) }).catch(() => undefined);
    }
  });

  return { received: true, type: eventType, handled: true, duplicate: !isNew, orderId: order.id };
}

export function liveStatus(): CommerceStatus {
  return { mode: isLive() ? "live" : "demo", stripe: hasStripe(), supabase: hasSupabase(), pod: hasPod(), email: hasEmail() };
}

export function createLiveCommerce(): Commerce {
  return {
    async createMerchCheckout({ variantId, quantity, origin }) {
      const found = findVariant(variantId);
      if (!found) throw new CommerceError(`Unknown variant "${variantId}"`, 400);
      const qty = validateQuantity(quantity);
      const { product, variant } = found;
      const stripe = getStripe();

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        submit_type: "pay",
        locale: "en-GB",
        line_items: [
          {
            quantity: qty,
            price_data: {
              currency: "gbp",
              unit_amount: product.pricePence,
              product_data: {
                name: `${product.name} · ${variant.label}`,
                description: product.description,
                images: absoluteImage(origin, product.images.front),
                metadata: { productId: product.id, variantId: variant.id },
              },
            },
          },
        ],
        shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
        shipping_options: [
          {
            shipping_rate_data: {
              type: "fixed_amount",
              fixed_amount: { amount: SHIPPING.ukPence, currency: "gbp" },
              display_name: "UK tracked",
              delivery_estimate: {
                minimum: { unit: "business_day", value: 3 },
                maximum: { unit: "business_day", value: 7 },
              },
            },
          },
        ],
        phone_number_collection: { enabled: true },
        billing_address_collection: "auto",
        client_reference_id: variant.id,
        metadata: { kind: "merch", productId: product.id, variantId: variant.id, quantity: String(qty) },
        success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/store?cancelled=1`,
      });

      if (!session.url) throw new CommerceError("Stripe did not return a Checkout URL", 502);
      return { url: session.url };
    },

    async createSnackCheckout({ origin }) {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        submit_type: "pay",
        locale: "en-GB",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "gbp",
              unit_amount: SNACK.pricePence,
              product_data: {
                name: SNACK.label,
                description: "A real snack for a real cat. She approves.",
                metadata: { kind: "snack" },
              },
            },
          },
        ],
        metadata: { kind: "snack" },
        success_url: `${origin}/store?snack=thanks`,
        cancel_url: `${origin}/store`,
      });
      if (!session.url) throw new CommerceError("Stripe did not return a Checkout URL", 502);
      return { url: session.url };
    },

    async handleStripeEvent(rawBody, signature) {
      const { stripeWebhookSecret } = getEnv();
      if (!stripeWebhookSecret) throw new CommerceError("STRIPE_WEBHOOK_SECRET is not set", 503);
      if (!signature) throw new CommerceError("Missing stripe-signature header", 400);

      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
      } catch (err) {
        throw new CommerceError(`Invalid Stripe signature: ${errorMessage(err)}`, 400);
      }

      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object;
          if (session.payment_status !== "paid") {
            // Delayed payment methods: wait for async_payment_succeeded.
            return { received: true, type: event.type, handled: false, note: `payment_status=${session.payment_status}` };
          }
          if (event.livemode !== session.livemode) {
            throw new CommerceError("Event/session livemode mismatch", 400);
          }
          return processPaidSession(session, event.type);
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object;
          const existing = await getOrderBySessionId(session.id).catch(() => null);
          if (existing) {
            await updateOrder(existing.order.id, { status: "failed" });
            await appendEvent(existing.order.id, `stripe.${event.type}`, redactSession(session));
          }
          return { received: true, type: event.type, handled: Boolean(existing) };
        }
        default:
          return { received: true, type: event.type, handled: false };
      }
    },

    async getOrderForSession(sessionId) {
      if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return null;
      try {
        const found = await getOrderBySessionId(sessionId);
        if (found) return toSummary(found.order, found.items);
      } catch (err) {
        console.error("[commerce] order lookup failed, falling back to Stripe:", err);
      }
      // The webhook can lag the redirect: show what Stripe knows, marked pending.
      try {
        const session = await getStripe().checkout.sessions.retrieve(sessionId);
        if (session.payment_status !== "paid") return null;
        const { order, items } = sessionToNewOrder(session);
        return toSummary(
          { ...order, status: "paid", tracking: null, created_at: new Date(session.created * 1000).toISOString() },
          items,
          { pending: true },
        );
      } catch (err) {
        console.error("[commerce] Stripe session lookup failed:", err);
        return null;
      }
    },

    status: liveStatus,
  };
}
