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
import { fulfil } from "./fulfilment";
import {
  appendEvent,
  ensureOrderItems,
  getOrderBySessionId,
  insertOrderIdempotent,
  recordSubmissionIfUnrecorded,
  toSummary,
  updateOrder,
  type NewOrder,
  type NewOrderItem,
  type OrderItemRow,
} from "./orders";
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
  // STRIPE_API_BASE exists only for the verify harness (a mock Stripe on
  // localhost); unset, the SDK talks to api.stripe.com as normal.
  const base = getEnv().stripeApiBase;
  let hostOverride: Pick<Stripe.StripeConfig, "host" | "port" | "protocol"> = {};
  if (base) {
    try {
      const url = new URL(base);
      hostOverride = {
        host: url.hostname,
        port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        protocol: url.protocol === "https:" ? "https" : "http",
      };
    } catch {
      console.error("[commerce] STRIPE_API_BASE is not a URL; ignoring it");
    }
  }
  stripeClient = new Stripe(stripeSecretKey, {
    appInfo: { name: "Kitty", url: SITE.url },
    ...hostOverride,
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
    // What the session actually charged per unit (amount_subtotal excludes
    // shipping), so a price change in products.ts while a session is open
    // never shows a wrong line on the success page or in the email.
    const charged =
      typeof session.amount_subtotal === "number" && session.amount_subtotal > 0
        ? Math.round(session.amount_subtotal / quantity)
        : null;
    items.push({
      product_id: meta.productId || found?.product.id || "unknown",
      variant_id: meta.variantId,
      quantity,
      unit_pence: charged ?? found?.product.pricePence ?? 0,
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
      // If fulfil()'s own row update failed (pod_submitted_unrecorded) the
      // provider id must still land in the row, or the admin button would
      // send the order again. Only a row with NO provider id is touched: one
      // that has it may already have been moved on by the provider's webhook.
      if (current.pod_order_id) {
        await recordSubmissionIfUnrecorded(order.id, { pod_provider: current.pod_provider, pod_order_id: current.pod_order_id });
      }
      await updateOrder(order.id, { processed_at: new Date().toISOString() });
    } catch (err) {
      // processed_at stays null. Stripe does not retry a 200, so what resumes
      // from here is a manual resend from the Stripe Dashboard or the admin
      // page's "Send to the maker" button (the Orders card flags the order).
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
        // Kitty is the merchant of record on Stripe's standard (lower-fee)
        // pricing, NOT Managed Payments. Set explicitly because an account with
        // Managed Payments enabled by default rejects shipping_address_collection
        // and requires a product tax code — and it is the higher-fee, tax-managed
        // model. Standard pricing is the right (and cheaper) fit for a UK POD store.
        managed_payments: { enabled: false },
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
        // Opt out of Managed Payments here too (see createMerchCheckout): keeps
        // Kitty merchant of record on standard, lower-fee Stripe pricing.
        managed_payments: { enabled: false },
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
