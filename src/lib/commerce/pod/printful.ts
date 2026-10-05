/**
 * Printful adapter (the research-verified UK pick: Printful's own factory in
 * Wolverhampton does cap embroidery, hoodie embroidery and Kornit water-based
 * DTG, and fulfils UK-address orders from there).
 *
 * API v1 (stable; v2 is still "Open Beta"), checked against
 * https://developers.printful.com/docs/ on 5 Oct 2026:
 *   headers: Authorization: Bearer <token>, X-PF-Store-Id: <store id>
 *   envelope: { code, result, error?: { message } } (code >= 400 is an error)
 *
 *   POST /orders  — creates a DRAFT (no ?confirm query param; see below).
 *     body: { external_id, shipping: "STANDARD",
 *             recipient: { name, address1, address2?, city, state_code?,
 *                          country_code, zip, phone?, email? },
 *             items: [ { sync_variant_id, quantity }                 (store product)
 *                    | { variant_id, quantity,                        (catalog fallback)
 *                        files: [{ type: <placement>, url }],
 *                        options?: [{ id, value }] } ] }
 *     external_id: "up to 32 characters long and contain digits, Latin
 *     alphabet letters, dashes and underscores" (docs). A Stripe Checkout
 *     session id is ~66 chars, so printfulExternalId() uses it only when it
 *     fits and otherwise our order uuid without dashes (32 hex chars).
 *   POST /orders/{id}/confirm — draft → pending (charges the Printful account).
 *     Done as a second call so a confirm failure (no payment method on the
 *     Printful account yet) still leaves a draft to confirm from the dashboard.
 *   GET  /orders/{id} — {id} may be "@<external_id>". result: { id, external_id,
 *     store, status, shipments: [{ carrier, service, tracking_number,
 *     tracking_url, ship_date, shipped_at, reshipment }], ... }
 *     status: draft | inreview | pending | failed | canceled | inprocess |
 *             onhold | partial | fulfilled | archived
 *   Rate limit: 120 calls/min; 429 carries Retry-After (seconds). Every call
 *   here waits that long (capped at 5 s, 2 s when absent) and retries once, so
 *   the whole draft -> confirm flow stays inside the webhook's time budget.
 *
 *   Webhooks (POST /webhooks { url, types }) deliver
 *     { type, created, retries, store, data: { order?, shipment? } }
 *   with type one of package_shipped, package_returned, order_created,
 *   order_updated, order_failed, order_canceled, order_put_hold,
 *   order_put_hold_approval, order_remove_hold, order_refunded, product_*,
 *   stock_updated. v1 webhooks are NOT signed, so the endpoint is registered
 *   as …/api/webhooks/pod?secret=…; the route copies the query value into the
 *   x-printful-webhook-secret header and parseWebhook() requires it to equal
 *   PRINTFUL_WEBHOOK_SECRET (constant-time). A body whose `store` is not our
 *   store id is ignored. Payload data only ever sets status and tracking on an
 *   order we already hold by provider id.
 *
 * Idempotency: external_id must be unique within a store, so if POST /orders
 * fails (timeout after Printful created it, a Stripe retry racing a crash
 * between our provider call and the row update), createOrder looks the order
 * up by @external_id and returns the existing id instead of printing twice;
 * a recovered draft is still confirmed when confirm is on.
 *
 * Mapping (src/lib/commerce/pod/types.ts mapItemsToPod): store ids from
 * src/config/products.ts or the generated src/config/pod-ids.json become
 * sync_variant_id items; variants without store ids order the catalog
 * variant from src/config/printful.ts with its print files and options.
 */
import { timingSafeEqual } from "node:crypto";
import type { PrintfulOption } from "@/config/printful";
import type { OrderStatus, Tracking } from "../types";
import {
  PodSignatureError,
  PodUnmappedError,
  type PodAddress,
  type PodCreateResult,
  type PodEvent,
  type PodLineItem,
  type PodOrderRef,
  type PodOrderStatus,
  type PodProvider,
} from "./types";

export const PRINTFUL_API_URL = "https://api.printful.com";
const USER_AGENT = "Kitty/1.0 (Node.js)";
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_DEFAULT_MS = 2_000;
const RETRY_AFTER_MAX_MS = 5_000;
export const PRINTFUL_SECRET_HEADER = "x-printful-webhook-secret";

export interface PrintfulConfig {
  token: string;
  storeId: string;
  webhookSecret?: string;
  /** Default true: confirm (pay + start fulfilment) right after the draft is created. */
  confirm?: boolean;
  /** Base URL override for the verify harness only; defaults to PRINTFUL_API_URL. */
  apiUrl?: string;
}

interface PrintfulEnvelope<T> {
  code: number;
  result: T;
  error?: { message?: string };
}

/** The subset of a Printful Order we read. Everything is optional: shapes drift. */
interface PrintfulOrder {
  id?: number | string;
  external_id?: string | null;
  status?: string;
  shipments?: unknown[];
}

export interface PrintfulRecipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
  phone?: string;
  email?: string;
}

export interface PrintfulSyncItem {
  sync_variant_id: number;
  quantity: number;
}

export interface PrintfulCatalogItem {
  variant_id: number;
  quantity: number;
  files: Array<{ type: string; url: string }>;
  options?: PrintfulOption[];
}

export type PrintfulOrderItem = PrintfulSyncItem | PrintfulCatalogItem;

export interface PrintfulOrderBody {
  external_id: string;
  shipping: "STANDARD";
  recipient: PrintfulRecipient;
  items: PrintfulOrderItem[];
}

export class PrintfulApiError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(method: string, path: string, status: number, detail: string) {
    super(`Printful ${method} ${path} failed: ${status} ${detail}`.trim());
    this.name = "PrintfulApiError";
    this.status = status;
    this.path = path;
  }
}

function baseUrl(cfg: PrintfulConfig): string {
  return (cfg.apiUrl?.trim() || PRINTFUL_API_URL).replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry-After in seconds (Printful sends seconds), capped; 2 s when missing or unparseable. */
export function retryAfterMs(header: string | null): number {
  const seconds = header ? Number.parseFloat(header.trim()) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return RETRY_AFTER_DEFAULT_MS;
  return Math.min(Math.round(seconds * 1000), RETRY_AFTER_MAX_MS);
}

async function printfulFetch<T>(cfg: PrintfulConfig, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(`${baseUrl(cfg)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "X-PF-Store-Id": cfg.storeId,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429 && attempt === 0) {
    const wait = retryAfterMs(res.headers.get("retry-after"));
    console.warn(`[printful] 429 on ${method} ${path}; retrying once in ${wait} ms`);
    await sleep(wait);
    return printfulFetch<T>(cfg, path, init, attempt + 1);
  }
  const text = await res.text();
  let json: PrintfulEnvelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as PrintfulEnvelope<T>) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || typeof json !== "object" || (typeof json.code === "number" && json.code >= 400)) {
    const detail = json?.error?.message ?? (json ? JSON.stringify(json).slice(0, 500) : text.slice(0, 500));
    throw new PrintfulApiError(method, path, res.status, detail);
  }
  return json.result;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function idString(value: unknown): string | null {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : null;
}

function extractTracking(shipment: Record<string, unknown>): Tracking | null {
  const carrier = str(shipment.carrier) ?? str(shipment.service);
  const number = str(shipment.tracking_number);
  // The success page renders this as a link: only http(s) ever gets stored.
  const rawUrl = str(shipment.tracking_url);
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined;
  if (!number && !url) return null;
  return { carrier: carrier ?? null, number: number ?? null, url: url ?? null };
}

/** Tracking from an order's first shipment (GET /orders/{id} and order_* webhooks). */
function trackingFromOrder(order: Record<string, unknown>): Tracking | null {
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return shipments.length ? extractTracking(asRecord(shipments[0])) : null;
}

/**
 * Printful order status → ours. Only movements we model are mapped; the rest
 * (draft, inreview, pending, onhold, partial, archived) return null so the
 * caller logs the event without changing the order.
 */
export function mapPrintfulStatus(status: string | null | undefined): OrderStatus | null {
  switch ((status ?? "").trim().toLowerCase()) {
    case "inprocess":
      return "in_production";
    case "fulfilled":
      return "shipped";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

/** Printful's rule for external_id: up to 32 chars of [A-Za-z0-9_-]. */
const EXTERNAL_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * The external_id we file the order under (pure, deterministic per order, so
 * a retry can find it with GET /orders/@{external_id}). The Stripe session id
 * when Printful accepts it; otherwise our order uuid without dashes.
 */
export function printfulExternalId(order: PodOrderRef): string {
  if (EXTERNAL_ID_RE.test(order.stripeSessionId)) return order.stripeSessionId;
  // A uuid minus its dashes is exactly 32 hex characters.
  const compact = order.id.replace(/-/g, "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 32);
  return compact || order.stripeSessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
}

/** Pure: the POST /orders body. Throws PodUnmappedError for items with neither store nor catalog ids. */
export function buildPrintfulOrderBody(order: PodOrderRef, items: PodLineItem[], address: PodAddress): PrintfulOrderBody {
  const unmapped: string[] = [];
  const mapped: PrintfulOrderItem[] = [];
  for (const item of items) {
    if (typeof item.podVariantId === "number") {
      mapped.push({ sync_variant_id: item.podVariantId, quantity: item.quantity });
      continue;
    }
    const catalog = item.catalog;
    if (catalog && typeof catalog.variantId === "number" && catalog.files.length) {
      const entry: PrintfulCatalogItem = {
        variant_id: catalog.variantId,
        quantity: item.quantity,
        files: catalog.files.map((f) => ({ type: f.placement, url: f.url })),
      };
      if (catalog.options?.length) entry.options = catalog.options;
      mapped.push(entry);
      continue;
    }
    unmapped.push(item.variantId);
  }
  if (unmapped.length) throw new PodUnmappedError(unmapped);

  const recipient: PrintfulRecipient = {
    name: (address.fullName || `${address.firstName} ${address.lastName}`).trim(),
    address1: address.address1,
    city: address.city,
    country_code: address.country,
    zip: address.zip,
  };
  if (address.address2) recipient.address2 = address.address2;
  if (address.region) recipient.state_code = address.region;
  if (address.phone) recipient.phone = address.phone;
  if (address.email) recipient.email = address.email;

  return { external_id: printfulExternalId(order), shipping: "STANDARD", recipient, items: mapped };
}

/** Pure mapping from a parsed Printful webhook body to our event. */
export function parsePrintfulPayload(json: unknown): PodEvent | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const topic = str(body.type) ?? "";
  const data = asRecord(body.data);
  const order = asRecord(data.order);
  const providerOrderId = idString(order.id);
  const shipmentTracking = extractTracking(asRecord(data.shipment));

  switch (topic) {
    case "package_shipped":
      return { type: "shipment_created", topic, providerOrderId, tracking: shipmentTracking, status: "shipped", raw: json };
    case "order_canceled":
      return { type: "order_updated", topic, providerOrderId, tracking: null, status: "cancelled", raw: json };
    case "order_failed":
      return { type: "order_updated", topic, providerOrderId, tracking: null, status: "failed", raw: json };
    case "order_updated": {
      const tracking = shipmentTracking ?? trackingFromOrder(order);
      return { type: "order_updated", topic, providerOrderId, tracking, status: mapPrintfulStatus(str(order.status)), raw: json };
    }
    case "package_returned":
    case "order_put_hold":
    case "order_put_hold_approval":
    case "order_remove_hold":
    case "order_refunded":
    case "order_created":
      // Logged against the order, never a status change.
      return { type: "order_updated", topic, providerOrderId, tracking: null, status: null, raw: json };
    default:
      return topic ? { type: "ignored", topic, providerOrderId, tracking: null, status: null, raw: json } : null;
  }
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function toOrderStatus(fallbackId: string, order: PrintfulOrder): PodOrderStatus {
  const providerStatus = (str(order.status) ?? "").toLowerCase();
  return {
    providerOrderId: idString(order.id) ?? fallbackId,
    providerStatus,
    status: mapPrintfulStatus(providerStatus),
    tracking: trackingFromOrder(asRecord(order)),
    raw: order,
  };
}

export function createPrintfulProvider(cfg: PrintfulConfig): PodProvider {
  const confirmDraft = async (providerOrderId: string): Promise<PodCreateResult> => {
    const confirmed = await printfulFetch<PrintfulOrder>(cfg, `/orders/${encodeURIComponent(providerOrderId)}/confirm`, {
      method: "POST",
      body: "{}",
    });
    return { providerOrderId: idString(confirmed?.id) ?? providerOrderId, sentToProduction: true, note: str(confirmed?.status) };
  };

  const findByExternalId = async (externalId: string): Promise<PrintfulOrder | null> => {
    try {
      const found = await printfulFetch<PrintfulOrder>(cfg, `/orders/@${encodeURIComponent(externalId)}`);
      return found && idString(found.id) ? found : null;
    } catch {
      return null;
    }
  };

  return {
    name: "printful",
    storeId: cfg.storeId,

    async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
      if (!items.length) throw new PodUnmappedError([]);
      const body = buildPrintfulOrderBody(order, items, address);

      let created: PrintfulOrder;
      try {
        created = await printfulFetch<PrintfulOrder>(cfg, "/orders", { method: "POST", body: JSON.stringify(body) });
      } catch (err) {
        // The order may already exist (a Stripe retry, or a timeout after
        // Printful created it). Never print it twice.
        const existing = await findByExternalId(body.external_id);
        if (existing) {
          const existingId = idString(existing.id) as string;
          const status = (str(existing.status) ?? "draft").toLowerCase();
          const recovered = `recovered existing order by external_id (status ${status})`;
          if (status !== "draft") return { providerOrderId: existingId, sentToProduction: true, note: recovered };
          if (cfg.confirm === false) return { providerOrderId: existingId, sentToProduction: false, note: recovered };
          // A recovered draft still has to be confirmed, or the customer paid for a draft nobody starts.
          try {
            const confirmed = await confirmDraft(existingId);
            return { ...confirmed, note: `${recovered}; confirmed` };
          } catch (confirmErr) {
            const why = confirmErr instanceof Error ? confirmErr.message : String(confirmErr);
            console.error(`[printful] recovered draft ${existingId} but confirm failed:`, why);
            return { providerOrderId: existingId, sentToProduction: false, note: `${recovered}; confirm failed: ${why}` };
          }
        }
        throw err;
      }
      const providerOrderId = idString(created?.id);
      if (!providerOrderId) throw new Error("Printful POST /orders returned no order id");
      if (cfg.confirm === false) {
        return { providerOrderId, sentToProduction: false, note: "draft: PRINTFUL_CONFIRM=0" };
      }
      try {
        return await confirmDraft(providerOrderId);
      } catch (err) {
        // The draft exists; the owner can confirm it from the dashboard or the admin page.
        const note = err instanceof Error ? err.message : String(err);
        console.error(`[printful] created draft ${providerOrderId} but confirm failed:`, note);
        return { providerOrderId, sentToProduction: false, note };
      }
    },

    async confirmOrder(providerOrderId: string): Promise<PodCreateResult> {
      return confirmDraft(providerOrderId);
    },

    async getOrder(providerOrderId: string): Promise<PodOrderStatus> {
      const found = await printfulFetch<PrintfulOrder>(cfg, `/orders/${encodeURIComponent(providerOrderId)}`);
      return toOrderStatus(providerOrderId, asRecord(found));
    },

    parseWebhook(rawBody: string, headers: Headers): PodEvent | null {
      if (cfg.webhookSecret && !secretMatches(headers.get(PRINTFUL_SECRET_HEADER), cfg.webhookSecret)) {
        throw new PodSignatureError("Printful webhook secret missing or wrong");
      }
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const store = asRecord(json).store;
      if (store !== undefined && store !== null && String(store) !== cfg.storeId) {
        console.warn(`[printful] ignoring webhook for store ${String(store)} (configured store ${cfg.storeId})`);
        return null;
      }
      return parsePrintfulPayload(json);
    },
  };
}
