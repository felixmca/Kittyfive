/**
 * Orders in Supabase. Every function here runs on the server with the service
 * role. Inserts are idempotent on stripe_session_id because Stripe retries
 * webhooks and may deliver the same event twice.
 */
import { findVariant, SNACK } from "@/config/products";
import { getSupabaseAdmin } from "./supabaseAdmin";
import type {
  OrderItemSummary,
  OrderKind,
  OrderStatus,
  OrderSummary,
  PostalAddress,
  Tracking,
} from "./types";

export interface OrderRow {
  id: string;
  stripe_session_id: string;
  stripe_payment_intent: string | null;
  kind: OrderKind;
  status: OrderStatus;
  email: string | null;
  name: string | null;
  phone: string | null;
  address: PostalAddress | null;
  amount_pence: number;
  currency: string;
  pod_provider: string | null;
  pod_order_id: string | null;
  tracking: Tracking | null;
  /** Set once the webhook has finished fulfilment + email for this order. */
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_pence: number;
}

export interface NewOrder {
  stripe_session_id: string;
  stripe_payment_intent: string | null;
  kind: OrderKind;
  status?: OrderStatus;
  email: string | null;
  name: string | null;
  phone: string | null;
  address: PostalAddress | null;
  amount_pence: number;
  currency: string;
}

export interface NewOrderItem {
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_pence: number;
}

export type OrderPatch = Partial<
  Pick<
    OrderRow,
    | "status"
    | "pod_provider"
    | "pod_order_id"
    | "tracking"
    | "stripe_payment_intent"
    | "email"
    | "phone"
    | "processed_at"
  >
>;

/**
 * Insert items for an order that has none yet (a retry after the first
 * delivery died between the order upsert and the items insert). No-op when
 * items already exist, so it is safe on every retry.
 */
export async function ensureOrderItems(orderId: string, items: NewOrderItem[]): Promise<OrderItemRow[]> {
  const existing = await getOrderItems(orderId);
  if (existing.length || !items.length) return existing;
  const db = getSupabaseAdmin();
  const { error } = await db.from("order_items").insert(items.map((item) => ({ ...item, order_id: orderId })));
  if (error) fail("insert order_items (retry)", error);
  return getOrderItems(orderId);
}

function fail(where: string, error: { message: string } | null): never {
  throw new Error(`[orders] ${where}: ${error?.message ?? "unknown error"}`);
}

/**
 * Insert an order and its items exactly once per Stripe session.
 * Returns the stored row and whether this call created it.
 */
export async function insertOrderIdempotent(
  order: NewOrder,
  items: NewOrderItem[],
): Promise<{ order: OrderRow; isNew: boolean }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("orders")
    .upsert({ ...order, status: order.status ?? "paid" }, { onConflict: "stripe_session_id", ignoreDuplicates: true })
    .select()
    .maybeSingle();
  if (error) fail("upsert order", error);

  if (data) {
    const row = data as OrderRow;
    if (items.length) {
      const { error: itemsError } = await db
        .from("order_items")
        .insert(items.map((item) => ({ ...item, order_id: row.id })));
      if (itemsError) fail("insert order_items", itemsError);
    }
    return { order: row, isNew: true };
  }

  // ON CONFLICT DO NOTHING returned no row: the order already exists.
  const existing = await getOrderBySessionId(order.stripe_session_id);
  if (!existing) {
    throw new Error(`[orders] upsert reported a duplicate for ${order.stripe_session_id} but it cannot be read back`);
  }
  return { order: existing.order, isNew: false };
}

export async function getOrderBySessionId(
  sessionId: string,
): Promise<{ order: OrderRow; items: OrderItemRow[] } | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("orders").select("*").eq("stripe_session_id", sessionId).maybeSingle();
  if (error) fail("select order by session", error);
  if (!data) return null;
  const order = data as OrderRow;
  const items = await getOrderItems(order.id);
  return { order, items };
}

export async function getOrderByPodOrderId(podOrderId: string): Promise<OrderRow | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("orders")
    .select("*")
    .eq("pod_order_id", podOrderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail("select order by pod id", error);
  return (data as OrderRow | null) ?? null;
}

export async function getOrderItems(orderId: string): Promise<OrderItemRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("order_items").select("*").eq("order_id", orderId).order("id");
  if (error) fail("select order_items", error);
  return (data as OrderItemRow[] | null) ?? [];
}

export async function updateOrder(orderId: string, patch: OrderPatch): Promise<OrderRow> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("orders")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .select()
    .single();
  if (error) fail("update order", error);
  return data as OrderRow;
}

/** Append to the audit log. Never throws into the caller's flow. */
export async function appendEvent(orderId: string | null, type: string, payload: unknown): Promise<void> {
  try {
    const db = getSupabaseAdmin();
    const { error } = await db
      .from("order_events")
      .insert({ order_id: orderId, type, payload: payload ?? {} });
    if (error) fail("insert order_event", error);
  } catch (err) {
    console.error(`[orders] could not append event ${type} for ${orderId ?? "(no order)"}:`, err);
  }
}

type ItemLike = Pick<NewOrderItem, "product_id" | "variant_id" | "quantity" | "unit_pence">;

/** Describe items for humans, using the product config for names. */
export function describeItems(items: ItemLike[]): OrderItemSummary[] {
  return items.map((item) => {
    if (item.product_id === "snack") {
      return {
        productId: "snack",
        variantId: "snack",
        name: SNACK.label,
        variantLabel: "",
        quantity: item.quantity,
        unitPence: item.unit_pence,
      };
    }
    const found = findVariant(item.variant_id);
    return {
      productId: item.product_id,
      variantId: item.variant_id,
      name: found?.product.name ?? item.product_id,
      variantLabel: found?.variant.label ?? item.variant_id,
      quantity: item.quantity,
      unitPence: item.unit_pence,
    };
  });
}

export function toSummary(
  order: Pick<OrderRow, "stripe_session_id" | "kind" | "status" | "amount_pence" | "currency" | "email" | "name"> &
    Partial<Pick<OrderRow, "tracking" | "created_at">>,
  items: ItemLike[],
  extra: { demo?: boolean; pending?: boolean } = {},
): OrderSummary {
  return {
    sessionId: order.stripe_session_id,
    kind: order.kind,
    status: order.status,
    amountPence: order.amount_pence,
    currency: order.currency,
    email: order.email,
    name: order.name,
    items: describeItems(items),
    tracking: order.tracking ?? null,
    createdAt: order.created_at ?? new Date().toISOString(),
    demo: extra.demo ?? false,
    ...(extra.pending ? { pending: true } : {}),
  };
}

// --- Admin reads (service role; the /api/admin/orders routes gate on is_admin()) ---

export interface OrderEventRow {
  id: number;
  order_id: string | null;
  type: string;
  payload: unknown;
  created_at: string;
}

export interface OrderWithItems {
  order: OrderRow;
  items: OrderItemRow[];
}

export interface OrderListRow extends OrderWithItems {
  /** The newest order_events row for this order, or null when it has none. */
  lastEvent: Pick<OrderEventRow, "type" | "created_at"> | null;
  /** The provider holds it as a draft that nobody has confirmed (see needsConfirmFrom). */
  needsConfirm: boolean;
}

/** The event types that say whether the provider's copy is a draft or in production. */
const CONFIRM_EVENTS = new Set(["pod_submitted", "pod_draft_unconfirmed", "pod_confirmed"]);

/**
 * From an order's events (NEWEST FIRST): is the provider's order still an
 * unconfirmed draft? True when the latest of pod_submitted /
 * pod_draft_unconfirmed / pod_confirmed says sentToProduction false (or is
 * the draft marker), false once a later pod_confirmed reports production.
 */
export function needsConfirmFrom(events: Array<Pick<OrderEventRow, "type" | "payload">>): boolean {
  for (const ev of events) {
    if (!CONFIRM_EVENTS.has(ev.type)) continue;
    if (ev.type === "pod_draft_unconfirmed") return true;
    const p = ev.payload && typeof ev.payload === "object" ? (ev.payload as Record<string, unknown>) : {};
    return p.sentToProduction === false;
  }
  return false;
}

/** Hard cap on one admin page: the list is read whole into memory. */
export const MAX_ORDER_LIST = 100;

function clampLimit(limit: number | undefined, fallback: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return fallback;
  return Math.min(MAX_ORDER_LIST, Math.max(1, Math.floor(limit)));
}

/**
 * Newest orders first, each with its items and its latest event. Three
 * queries however many orders: orders, their items, their events (type and
 * time only, newest first, first seen per order wins).
 */
export async function listOrders(opts: { limit?: number; status?: OrderStatus } = {}): Promise<OrderListRow[]> {
  const db = getSupabaseAdmin();
  const limit = clampLimit(opts.limit, 30);
  let query = db.from("orders").select("*").order("created_at", { ascending: false }).limit(limit);
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) fail("list orders", error);
  const orders = (data as OrderRow[] | null) ?? [];
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);

  const [{ data: itemData, error: itemsError }, { data: eventData, error: eventsError }] = await Promise.all([
    db.from("order_items").select("*").in("order_id", ids).order("id"),
    db
      .from("order_events")
      .select("order_id, type, created_at, payload")
      .in("order_id", ids)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(ids.length * 25),
  ]);
  if (itemsError) fail("list order_items", itemsError);
  if (eventsError) fail("list order_events", eventsError);

  const itemsByOrder = new Map<string, OrderItemRow[]>();
  for (const item of (itemData as OrderItemRow[] | null) ?? []) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }
  const lastEventByOrder = new Map<string, Pick<OrderEventRow, "type" | "created_at">>();
  const eventsByOrder = new Map<string, Array<Pick<OrderEventRow, "type" | "payload">>>();
  for (const ev of (eventData as Array<Pick<OrderEventRow, "order_id" | "type" | "created_at" | "payload">> | null) ?? []) {
    if (!ev.order_id) continue;
    if (!lastEventByOrder.has(ev.order_id)) lastEventByOrder.set(ev.order_id, { type: ev.type, created_at: ev.created_at });
    const list = eventsByOrder.get(ev.order_id) ?? [];
    list.push({ type: ev.type, payload: ev.payload });
    eventsByOrder.set(ev.order_id, list);
  }
  return orders.map((order) => ({
    order,
    items: itemsByOrder.get(order.id) ?? [],
    lastEvent: lastEventByOrder.get(order.id) ?? null,
    needsConfirm: Boolean(order.pod_order_id) && needsConfirmFrom(eventsByOrder.get(order.id) ?? []),
  }));
}

export async function getOrderById(id: string): Promise<OrderWithItems | null> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) fail("select order by id", error);
  if (!data) return null;
  const order = data as OrderRow;
  const items = await getOrderItems(order.id);
  return { order, items };
}

/** An order's audit trail, newest first. */
export async function listOrderEvents(orderId: string, limit = 20): Promise<OrderEventRow[]> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("order_events")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(clampLimit(limit, 20));
  if (error) fail("list order_events for order", error);
  return (data as OrderEventRow[] | null) ?? [];
}

/** What /admin shows per order: never the full address or the phone number. */
export interface AdminOrderSummary {
  id: string;
  createdAt: string;
  kind: OrderKind;
  status: OrderStatus;
  amountPence: number;
  currency: string;
  email: string | null;
  name: string | null;
  items: Array<Pick<OrderItemSummary, "name" | "variantLabel" | "quantity">>;
  podProvider: string | null;
  podOrderId: string | null;
  tracking: Tracking | null;
  processedAt: string | null;
  lastEvent: { type: string; createdAt: string } | null;
  /** The provider holds this order as a draft nobody has confirmed: it will not be made until someone does. */
  needsConfirm: boolean;
}

export function toAdminSummary(
  order: OrderRow,
  items: ItemLike[],
  lastEvent: Pick<OrderEventRow, "type" | "created_at"> | null,
  needsConfirm = false,
): AdminOrderSummary {
  return {
    id: order.id,
    createdAt: order.created_at,
    kind: order.kind,
    status: order.status,
    amountPence: order.amount_pence,
    currency: order.currency,
    email: order.email,
    name: order.name,
    items: describeItems(items).map(({ name, variantLabel, quantity }) => ({ name, variantLabel, quantity })),
    podProvider: order.pod_provider,
    podOrderId: order.pod_order_id,
    tracking: order.tracking ?? null,
    processedAt: order.processed_at,
    lastEvent: lastEvent ? { type: lastEvent.type, createdAt: lastEvent.created_at } : null,
    needsConfirm,
  };
}
