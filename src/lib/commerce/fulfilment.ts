/**
 * Turning a paid merch order into a print-on-demand order. Called from the
 * Stripe webhook (in `after()`, once the 200 has gone back) and from the
 * admin "Send to the maker" action for orders that were left at `paid`
 * (no ids yet, provider not configured, provider down).
 *
 * Never throws: every outcome is an order_events row and the returned order
 * row. Two guards keep the provider from ever printing twice:
 *   - an order that already carries pod_order_id is never resubmitted;
 *   - the order is CLAIMED atomically before the provider is called
 *     (orders.pod_provider is set with a conditional update), so two
 *     concurrent runs (a Stripe retry racing the first delivery, the admin
 *     button racing the webhook) cannot both reach the provider. A failed
 *     provider call releases the claim so a retry is possible.
 */
import { getEnv, hasPod } from "./env";
import { appendEvent, updateOrder, type OrderItemRow, type OrderRow } from "./orders";
import { getPod, mapItemsToPod, toPodAddress, type PodMapContext } from "./pod";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { errorMessage } from "./types";

/** The mapping context for the active provider (store id + site URL from env). */
export function podMapContext(providerName: string): PodMapContext {
  const env = getEnv();
  const storeId = providerName === "printful" ? env.printfulStoreId : providerName === "printify" ? env.printifyShopId : null;
  return { provider: providerName, storeId: storeId ?? null, siteUrl: env.siteUrl ?? null };
}

export interface FulfilOptions {
  /**
   * The admin button, after the webhook's grace period: take the claim even
   * if an earlier run set pod_provider and then died before recording a
   * provider id. The webhook itself never forces.
   */
  force?: boolean;
}

/**
 * Set pod_provider on the order only if nobody has: the row is the lock.
 * Returns false when another run holds it (or the order already has a
 * provider id), in which case the caller must not call the provider.
 */
async function claim(order: OrderRow, provider: string, force: boolean): Promise<boolean> {
  const db = getSupabaseAdmin();
  let query = db.from("orders").update({ pod_provider: provider }).eq("id", order.id).is("pod_order_id", null);
  if (!force) query = query.is("pod_provider", null);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`[orders] claim for fulfilment: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

async function release(order: OrderRow): Promise<void> {
  try {
    await getSupabaseAdmin().from("orders").update({ pod_provider: null }).eq("id", order.id).is("pod_order_id", null);
  } catch (err) {
    console.error(`[commerce] could not release the fulfilment claim on ${order.id}:`, err);
  }
}

/** Submit a paid merch order to the print provider. Never throws; records the outcome as events. */
export async function fulfil(order: OrderRow, items: OrderItemRow[], opts: FulfilOptions = {}): Promise<OrderRow> {
  if (order.pod_order_id) return order; // already submitted (this is a resumed retry)
  if (!hasPod()) {
    await appendEvent(order.id, "pod_not_configured", {
      note: "No print provider configured (set PRINTFUL_API_TOKEN + PRINTFUL_STORE_ID, or PRINTIFY_API_TOKEN + PRINTIFY_SHOP_ID); fulfil manually. Status stays paid.",
    });
    return order;
  }
  const pod = getPod();
  if (!items.length) {
    await appendEvent(order.id, "pod_unmapped", { provider: pod.name, unmapped: [], note: "Order has no items; nothing to send." });
    return order;
  }
  const { mapped, unmapped } = mapItemsToPod(items, podMapContext(pod.name));
  if (unmapped.length) {
    await appendEvent(order.id, "pod_unmapped", {
      provider: pod.name,
      unmapped,
      note: "No store ids (src/config/pod-ids.json or products.ts) and no catalog blueprint with https print files for these variants; fulfil manually. Status stays paid.",
    });
    return order;
  }
  if (!order.address) {
    await appendEvent(order.id, "pod_no_address", { note: "Session had no shipping address; fulfil manually." });
    return order;
  }

  let claimed: boolean;
  try {
    claimed = await claim(order, pod.name, opts.force === true);
  } catch (err) {
    await appendEvent(order.id, "pod_failed", { provider: pod.name, message: errorMessage(err), note: "Could not claim the order before calling the provider." });
    console.error(`[commerce] fulfilment claim failed for ${order.id}:`, err);
    return order;
  }
  if (!claimed) {
    await appendEvent(order.id, "pod_claimed_elsewhere", {
      provider: pod.name,
      note: "Another fulfilment run holds this order (or it already has a provider id). Nothing was sent. If it never records a provider id, the admin button retries after the grace period.",
    });
    return order;
  }

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
    await release(order);
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
    await appendEvent(order.id, "pod_submitted", {
      provider: pod.name,
      items: mapped.map((m) => `${m.variantId} x${m.quantity} -> ${m.catalog ? `catalog ${m.catalog.variantId}` : `${m.podProductId}/${m.podVariantId}`}`),
      ...result,
    });
    if (result.sentToProduction === false) {
      // Paid, held by the provider, but NOT in production (PRINTFUL_CONFIRM=0,
      // or the confirm step failed, e.g. no billing method yet). The admin
      // page shows this as a draft to confirm; keep it greppable too.
      console.error(`[commerce] order ${order.id} is a ${pod.name} draft (${result.providerOrderId}) that still needs confirming: ${result.note ?? ""}`);
      await appendEvent(order.id, "pod_draft_unconfirmed", { provider: pod.name, providerOrderId: result.providerOrderId, note: result.note ?? null });
    }
    return updated;
  } catch (err) {
    await appendEvent(order.id, "pod_submitted_unrecorded", {
      provider: pod.name,
      providerOrderId: result.providerOrderId,
      message: errorMessage(err),
      note: "Provider accepted the order but the row update failed. Do NOT resubmit; set pod_order_id by hand.",
    }).catch(() => undefined);
    console.error(`[commerce] pod order ${result.providerOrderId} created but not recorded for ${order.id}:`, err);
    return { ...order, status: "submitted", pod_provider: pod.name, pod_order_id: result.providerOrderId };
  }
}
