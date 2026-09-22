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
