/**
 * POST /api/admin/orders/[id]   body: { action: "fulfil" | "confirm" | "refresh" }
 *
 * The owner's three hands-on moves for one order, admins only (bearer token
 * → is_admin(), as /api/admin/status):
 *   fulfil   a merch order still at `paid` with no provider id → fulfil()
 *            (the same function the Stripe webhook runs); its outcome is the
 *            newest order_events row, returned as a sentence.
 *   confirm  a submitted order the provider holds as a draft → provider
 *            .confirmOrder (Printful confirm / Printify send_to_production).
 *   refresh  read the order back from the provider; the status moves only
 *            forward (same rule as /api/webhooks/pod) and tracking fills in.
 *
 * A provider failure is still HTTP 200 with { message }: it is recorded as an
 * event and the card shows it. Only our own faults are 4xx/5xx, always as
 * JSON { error }.
 */
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";
import { sendShippedEmail } from "@/lib/commerce/email";
import { hasSupabase } from "@/lib/commerce/env";
import { fulfil } from "@/lib/commerce/fulfilment";
import {
  appendEvent,
  getOrderById,
  listOrderEvents,
  needsConfirmFrom,
  toAdminSummary,
  updateOrder,
  type OrderEventRow,
  type OrderRow,
} from "@/lib/commerce/orders";
import { getPod } from "@/lib/commerce/pod";
import { errorMessage, type OrderStatus } from "@/lib/commerce/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case is the Printful draft -> confirm flow with one 429 wait each
// (15 + 5 + 15 s twice); same budget as the Stripe webhook route.
export const maxDuration = 60;

const NO_STORE = { headers: { "Cache-Control": "no-store" } };
const ACTIONS = ["fulfil", "confirm", "refresh"] as const;
type Action = (typeof ACTIONS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * How long after creation the Stripe webhook's deferred fulfilment may still
 * be running. On Vercel after() ends inside that route's maxDuration (60 s);
 * locally there is no cap and the longest Printful chain (draft, lookup,
 * confirm, each with one 429 wait) is about 105 s, so 150 s covers both.
 */
const WEBHOOK_GRACE_MS = 150_000;

// Status only ever moves forward; cancelled/failed are accepted unless delivered.
// Kept in step with src/app/api/webhooks/pod/route.ts (copied, not imported).
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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, ...NO_STORE });
}

function field(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v : null;
}

/** One sentence for the card from the event fulfil() left behind. */
function describeFulfilment(order: OrderRow, event: OrderEventRow | null): string {
  if (!event) return order.pod_order_id ? `Sent to ${order.pod_provider} as order ${order.pod_order_id}.` : "Nothing happened.";
  const p = event.payload as Record<string, unknown> | null;
  switch (event.type) {
    case "pod_submitted": {
      const draft = p && p.sentToProduction === false;
      return `Sent to ${order.pod_provider} as order ${order.pod_order_id}${draft ? " (a draft: confirm it to start production)" : ""}.`;
    }
    case "pod_not_configured":
      return "No print provider is configured yet (token + store id). The order stays at paid.";
    case "pod_unmapped": {
      const unmapped = Array.isArray(p?.unmapped) ? (p?.unmapped as unknown[]).join(", ") : "some variants";
      return `The maker has no ids for ${unmapped}: run the product sync (or set the site URL to https) and try again.`;
    }
    case "pod_no_address":
      return "This order has no shipping address, so it cannot go to the maker. Fulfil it by hand.";
    case "pod_failed":
      return `${field(p, "provider") ?? "The maker"} refused the order: ${field(p, "message") ?? "unknown error"}`;
    case "pod_submitted_unrecorded":
      return `${field(p, "provider") ?? "The maker"} accepted the order (${field(p, "providerOrderId") ?? "?"}) but it could not be recorded here. Do NOT send it again; set pod_order_id by hand.`;
    default:
      return `Done: ${event.type}.`;
  }
}

async function respond(orderId: string, message: string): Promise<Response> {
  const fresh = await getOrderById(orderId);
  if (!fresh) return json({ error: "The order vanished mid-action." }, 500);
  const events = await listOrderEvents(orderId, 20);
  return json({
    order: toAdminSummary(fresh.order, fresh.items, events[0] ?? null, Boolean(fresh.order.pod_order_id) && needsConfirmFrom(events)),
    events: events.slice(0, 5).map((e) => e.type),
    message,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const token = bearerToken(req);
  const caller = token ? await serverSupabaseAs(token) : null;
  if (!caller) return json({ error: "Sign in first." }, 401);
  const { data: isAdmin, error } = await caller.sb.rpc("is_admin");
  if (error || isAdmin !== true) return json({ error: "Admins only." }, 403);

  if (!hasSupabase()) {
    return json({ error: "Orders live in Supabase, and this deployment has no SUPABASE_SERVICE_ROLE_KEY." }, 503);
  }

  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "That is not an order id." }, 400);

  let action: Action;
  try {
    const body = (await req.json()) as { action?: unknown } | null;
    const a = body?.action;
    if (typeof a !== "string" || !(ACTIONS as readonly string[]).includes(a)) {
      return json({ error: `action must be one of ${ACTIONS.join(", ")}.` }, 400);
    }
    action = a as Action;
  } catch {
    return json({ error: "Send a JSON body like { \"action\": \"fulfil\" }." }, 400);
  }

  try {
    const found = await getOrderById(id);
    if (!found) return json({ error: "No such order." }, 404);
    const { order, items } = found;
    const pod = getPod();

    if (action === "fulfil") {
      if (order.kind !== "merch") return json({ error: "Only merch orders go to the maker." }, 409);
      if (order.pod_order_id) return json({ error: `Already at ${order.pod_provider} as order ${order.pod_order_id}.` }, 409);
      if (order.status !== "paid") return json({ error: `Only paid orders can be sent; this one is ${order.status}.` }, 409);
      if (!order.processed_at && Date.now() - Date.parse(order.created_at) < WEBHOOK_GRACE_MS) {
        return json({ error: "The payment webhook is still working on this order. Reload in a minute." }, 409);
      }
      await appendEvent(order.id, "admin_fulfil", { by: caller.email });
      // force: past the grace period a claim left by a run that died is taken over.
      const updated = await fulfil(order, items, { force: true });
      const events = await listOrderEvents(order.id, 5);
      const latest = events.find((e) => e.type !== "admin_fulfil") ?? null;
      return respond(order.id, describeFulfilment(updated, latest));
    }

    // confirm and refresh both need the provider that holds the order.
    if (!order.pod_order_id) return json({ error: "This order has not been sent to the maker yet." }, 409);
    if (order.pod_provider && order.pod_provider !== pod.name) {
      return json({ error: `This order is at ${order.pod_provider}, but ${pod.name} is the configured provider.` }, 409);
    }

    if (action === "confirm") {
      if (!pod.confirmOrder) return json({ error: `${pod.name} does not offer confirm from here.` }, 409);
      if (order.status !== "submitted") return json({ error: `Only submitted orders can be confirmed; this one is ${order.status}.` }, 409);
      try {
        const result = await pod.confirmOrder(order.pod_order_id);
        await appendEvent(order.id, "pod_confirmed", { provider: pod.name, by: caller.email, ...result });
        return respond(
          order.id,
          result.sentToProduction
            ? `${pod.name} confirmed order ${order.pod_order_id}; it is in production.${result.note ? ` (${result.note})` : ""}`
            : `${pod.name} accepted the confirm for ${order.pod_order_id}.${result.note ? ` ${result.note}` : ""}`,
        );
      } catch (err) {
        const message = errorMessage(err);
        await appendEvent(order.id, "pod_confirm_failed", { provider: pod.name, by: caller.email, message });
        console.error(`[admin/orders] confirm failed for ${order.id}:`, err);
        return respond(order.id, `${pod.name} would not confirm it: ${message}`);
      }
    }

    // refresh
    if (!pod.getOrder) return json({ error: `${pod.name} does not offer a status read from here.` }, 409);
    try {
      const remote = await pod.getOrder(order.pod_order_id);
      await appendEvent(order.id, "pod_refreshed", {
        provider: pod.name,
        by: caller.email,
        providerStatus: remote.providerStatus,
        status: remote.status,
        tracking: remote.tracking,
      });
      let message = `${pod.name} says "${remote.providerStatus}"`;
      if (remote.status && advances(order.status, remote.status)) {
        const moved = await updateOrder(order.id, { status: remote.status, tracking: remote.tracking ?? order.tracking });
        message += `: moved ${order.status} → ${remote.status}.`;
        if (moved.status === "shipped" && order.status !== "shipped") {
          // The same email the pod webhook sends when it learns of the shipment first.
          const mail = await sendShippedEmail(moved, remote.tracking ?? moved.tracking);
          await appendEvent(order.id, mail.sent ? "email_shipped_sent" : "email_shipped_skipped", { to: moved.email, id: mail.id });
          message += mail.sent ? " Tracking email sent." : "";
        }
      } else if (remote.tracking && !order.tracking) {
        await updateOrder(order.id, { tracking: remote.tracking });
        message += "; tracking added.";
      } else {
        message += remote.status ? ` (${remote.status}); nothing to change.` : "; no status change.";
      }
      return respond(order.id, message);
    } catch (err) {
      const message = errorMessage(err);
      await appendEvent(order.id, "pod_refresh_failed", { provider: pod.name, by: caller.email, message });
      console.error(`[admin/orders] refresh failed for ${order.id}:`, err);
      return respond(order.id, `Could not read it back from ${pod.name}: ${message}`);
    }
  } catch (err) {
    console.error(`[admin/orders] ${action} failed for ${id}:`, err);
    return json({ error: errorMessage(err) }, 500);
  }
}
