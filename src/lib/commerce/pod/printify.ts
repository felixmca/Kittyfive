/**
 * Printify adapter (the fallback; Printful is the UK primary).
 *
 * Verified against https://developers.printify.com/openapi.json (5 Oct 2026):
 *   POST /v1/shops/{shop_id}/orders.json
 *     body: { external_id?, label?, line_items: [{ product_id, variant_id, quantity }],
 *             shipping_method?, send_shipping_notification?,
 *             address_to: { first_name, last_name, email, phone, country, region?,
 *                           address1, address2?, city, zip } }
 *     200: { id }
 *   POST /v1/shops/{shop_id}/orders/{order_id}/send_to_production.json → { id }
 *   GET  /v1/shops/{shop_id}/orders/{order_id}.json → { id, status, shipments: [{ carrier, number, url, delivered_at }], ... }
 *     status: pending | on-hold | sending-to-production | in-production | canceled |
 *             fulfilled | partially-fulfilled | payment-not-received | callback-received | has-issues
 *   Webhook topics include order:created, order:updated, order:sent-to-production,
 *   order:shipment:created, order:shipment:delivered.
 *   Webhook signature: header X-Pfy-Signature = "sha256=" + HMAC-SHA256(rawBody, secret).
 *   A 429 carries Retry-After; every call waits (capped at 5 s, 2 s when absent) and retries once.
 *   GET  /v1/shops/{shop_id}/orders.json?limit=50 lists recent orders (external_id per order): if
 *   POST orders.json fails after Printify stored the order, createOrder finds it there instead of
 *   ordering twice (the Printify counterpart of Printful's GET /orders/@{external_id}).
 *
 * Printify has no catalog fallback: every item needs the store's product id +
 * variant id (src/config/products.ts or the generated src/config/pod-ids.json),
 * otherwise createOrder throws PodUnmappedError listing the variants.
 *
 * `apiUrl` (PRINTIFY_API_URL, verify harness only) replaces the whole base
 * "https://api.printify.com/v1", so a mock must serve /shops/... under the URL given.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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

export const PRINTIFY_API_URL = "https://api.printify.com/v1";
const USER_AGENT = "Kitty/1.0 (Node.js)";
const TIMEOUT_MS = 15_000;
const RETRY_AFTER_DEFAULT_MS = 2_000;
const RETRY_AFTER_MAX_MS = 5_000;

export interface PrintifyConfig {
  token: string;
  shopId: string;
  webhookSecret?: string;
  sendToProduction?: boolean;
  /** Base URL override for the verify harness only; defaults to PRINTIFY_API_URL (includes /v1). */
  apiUrl?: string;
}

interface PrintifyOrder {
  id?: string | number;
  status?: string;
  shipments?: unknown[];
}

function baseUrl(cfg: PrintifyConfig): string {
  return (cfg.apiUrl?.trim() || PRINTIFY_API_URL).replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(header: string | null): number {
  const seconds = header ? Number.parseFloat(header.trim()) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return RETRY_AFTER_DEFAULT_MS;
  return Math.min(Math.round(seconds * 1000), RETRY_AFTER_MAX_MS);
}

async function printifyFetch<T>(cfg: PrintifyConfig, path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(`${baseUrl(cfg)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429 && attempt === 0) {
    const wait = retryAfterMs(res.headers.get("retry-after"));
    console.warn(`[printify] 429 on ${method} ${path}; retrying once in ${wait} ms`);
    await sleep(wait);
    return printifyFetch<T>(cfg, path, init, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Printify ${method} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
  }
  try {
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    throw new Error(`Printify ${path} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

export function verifyPrintifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const provided = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
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

/** Printify has shipped a few payload shapes; look in all the usual places. */
function extractTracking(data: Record<string, unknown>): Tracking | null {
  const shipments = Array.isArray(data.shipments) ? data.shipments : [];
  const candidates: unknown[] = [data.shipment, data.carrier, shipments[0], data];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const o = candidate as Record<string, unknown>;
    const carrierObj = asRecord(o.carrier);
    const carrier = str(o.carrier) ?? str(carrierObj.code) ?? str(o.code) ?? str(o.carrier_code);
    const number = str(o.number) ?? str(o.tracking_number) ?? str(carrierObj.tracking_number);
    const rawUrl = str(o.url) ?? str(o.tracking_url) ?? str(carrierObj.tracking_url);
    // Rendered as a link on the success page: only http(s) is ever stored.
    const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined;
    if (number || url) return { carrier: carrier ?? null, number: number ?? null, url: url ?? null };
  }
  return null;
}

/** Printify order status → ours (null when we do not model the movement). */
export function mapPrintifyStatus(status: string | null | undefined): OrderStatus | null {
  switch ((status ?? "").trim().toLowerCase()) {
    case "in-production":
    case "sending-to-production":
      return "in_production";
    case "fulfilled":
      return "shipped";
    case "canceled":
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

/** Pure mapping from a parsed Printify webhook body to our event. Shared with the demo provider. */
export function parsePrintifyPayload(json: unknown): PodEvent | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const topic = str(body.type) ?? str(body.topic) ?? "";
  const resource = asRecord(body.resource);
  const providerOrderId = idString(resource.id);
  const data = asRecord(resource.data);
  const tracking = extractTracking(data);

  switch (topic) {
    case "order:shipment:created":
      return { type: "shipment_created", topic, providerOrderId, tracking, status: "shipped", raw: json };
    case "order:shipment:delivered":
      return { type: "shipment_delivered", topic, providerOrderId, tracking, status: "delivered", raw: json };
    case "order:sent-to-production":
      return { type: "sent_to_production", topic, providerOrderId, tracking: null, status: "in_production", raw: json };
    case "order:updated": {
      const s = (str(data.status) ?? "").toLowerCase();
      const status = s === "canceled" || s === "cancelled" ? "cancelled" : null;
      return { type: "order_updated", topic, providerOrderId, tracking, status, raw: json };
    }
    default:
      return topic ? { type: "ignored", topic, providerOrderId, tracking: null, status: null, raw: json } : null;
  }
}

export function createPrintifyProvider(cfg: PrintifyConfig): PodProvider {
  const shop = encodeURIComponent(cfg.shopId);

  const sendToProduction = async (providerOrderId: string): Promise<PodCreateResult> => {
    await printifyFetch(cfg, `/shops/${shop}/orders/${encodeURIComponent(providerOrderId)}/send_to_production.json`, {
      method: "POST",
      body: "{}",
    });
    return { providerOrderId, sentToProduction: true };
  };

  /** Printify's recent orders carry external_id; the first page is enough for an order created seconds ago. */
  const findByExternalId = async (externalId: string): Promise<{ id?: string | number; status?: string } | null> => {
    try {
      const page = await printifyFetch<{ data?: Array<{ id?: string | number; external_id?: string; status?: string }> }>(
        cfg,
        `/shops/${shop}/orders.json?limit=50`,
      );
      const found = (page?.data ?? []).find((o) => o && o.external_id === externalId);
      return found && idString(found.id) ? found : null;
    } catch {
      return null;
    }
  };

  return {
    name: "printify",
    storeId: cfg.shopId,

    async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
      if (!items.length) throw new PodUnmappedError([]);
      const unmapped = items.filter((i) => !i.podProductId || typeof i.podVariantId !== "number").map((i) => i.variantId);
      if (unmapped.length) throw new PodUnmappedError(unmapped);
      const body = {
        external_id: order.stripeSessionId,
        label: `Kitty ${order.id.slice(0, 8)}`,
        line_items: items.map((item) => ({
          product_id: item.podProductId,
          variant_id: item.podVariantId,
          quantity: item.quantity,
        })),
        shipping_method: 1,
        send_shipping_notification: false,
        address_to: {
          first_name: address.firstName,
          last_name: address.lastName,
          email: address.email,
          phone: address.phone,
          country: address.country,
          region: address.region,
          address1: address.address1,
          address2: address.address2,
          city: address.city,
          zip: address.zip,
        },
      };
      const recovered = (existing: { id?: string | number; status?: string }): PodCreateResult => {
        const status = (str(existing.status) ?? "").toLowerCase();
        const inProduction = status !== "" && status !== "pending" && status !== "on-hold" && status !== "payment-not-received";
        return {
          providerOrderId: idString(existing.id) as string,
          sentToProduction: inProduction,
          note: `recovered existing order by external_id (status ${status || "unknown"})`,
        };
      };
      // Printify does NOT reject a second order with the same external_id, so
      // look first: a run that died after send_to_production but before our
      // row update must find its order here rather than order it again.
      const before = await findByExternalId(body.external_id);
      if (before) return recovered(before);

      let created: { id: string | number } | null = null;
      try {
        created = await printifyFetch<{ id: string | number }>(cfg, `/shops/${shop}/orders.json`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      } catch (err) {
        // Printify may have stored the order before the failure (timeout, 5xx
        // after commit). Look again before giving up, so a retry never orders twice.
        const existing = await findByExternalId(body.external_id);
        if (existing) return recovered(existing);
        throw err;
      }
      const providerOrderId = idString(created?.id);
      if (!providerOrderId) throw new Error("Printify POST orders.json returned no order id");

      if (cfg.sendToProduction === false) {
        return { providerOrderId, sentToProduction: false, note: "held: PRINTIFY_SEND_TO_PRODUCTION=0" };
      }
      try {
        return await sendToProduction(providerOrderId);
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        console.error("[printify] created order but send_to_production failed:", note);
        return { providerOrderId, sentToProduction: false, note };
      }
    },

    async confirmOrder(providerOrderId: string): Promise<PodCreateResult> {
      return sendToProduction(providerOrderId);
    },

    async getOrder(providerOrderId: string): Promise<PodOrderStatus> {
      const found = await printifyFetch<PrintifyOrder>(cfg, `/shops/${shop}/orders/${encodeURIComponent(providerOrderId)}.json`);
      const record = asRecord(found);
      const providerStatus = (str(record.status) ?? "").toLowerCase();
      return {
        providerOrderId: idString(record.id) ?? providerOrderId,
        providerStatus,
        status: mapPrintifyStatus(providerStatus),
        tracking: extractTracking(record),
        raw: found,
      };
    },

    parseWebhook(rawBody: string, headers: Headers): PodEvent | null {
      if (cfg.webhookSecret) {
        const header = headers.get("x-pfy-signature");
        if (!verifyPrintifySignature(rawBody, header, cfg.webhookSecret)) {
          throw new PodSignatureError();
        }
      }
      let json: unknown;
      try {
        json = JSON.parse(rawBody);
      } catch {
        return null;
      }
      return parsePrintifyPayload(json);
    },
  };
}
