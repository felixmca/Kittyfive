/**
 * Printful adapter (the research-verified UK pick: Printful's own factory in
 * Wolverhampton does cap embroidery, hoodie embroidery and Kornit water-based
 * DTG, and fulfils UK-address orders from there).
 *
 * API v1 (stable; v2 is still "Open Beta" as of Sept 2026):
 *   POST https://api.printful.com/orders[?confirm=true]
 *     headers: Authorization: Bearer <token>, X-PF-Store-Id: <store id>
 *     body: { external_id, shipping: "STANDARD", recipient: { name, address1,
 *             address2, city, state_code, country_code, zip, phone, email },
 *             items: [{ sync_variant_id, quantity }] }
 *     200: { code: 200, result: { id, external_id, status, ... } }
 *   POST /orders/{id}/confirm            (if created without ?confirm=true)
 *   Webhooks (POST /webhooks { url, types }): payload
 *     { type: "package_shipped" | "package_returned" | "order_created" |
 *             "order_updated" | "order_failed" | "order_canceled" | ...,
 *       created, retries, store,
 *       data: { shipment?: { id, carrier, service, tracking_number, tracking_url,
 *                            ship_date, shipped_at, reshipment },
 *               order: { id, external_id, status, ... } } }
 *   v1 webhooks are NOT signed. We therefore register the endpoint with a
 *   secret in the URL (…/api/webhooks/pod?secret=…); the route copies it into
 *   the x-printful-webhook-secret header and this adapter requires it to match
 *   PRINTFUL_WEBHOOK_SECRET. Payload data is only ever used to set status and
 *   tracking on an order we already hold by provider id.
 *
 * Mapping: `podProductId` in src/config/products.ts is the Printful sync
 * product id (string), `podVariantId` is the sync variant id (number). Create
 * the three products in the Printful dashboard with the embroidery / DTG
 * files attached, then copy the ids from GET /store/products.
 */
import { timingSafeEqual } from "node:crypto";
import type { Tracking } from "../types";
import {
  PodSignatureError,
  PodUnmappedError,
  type PodAddress,
  type PodCreateResult,
  type PodEvent,
  type PodLineItem,
  type PodOrderRef,
  type PodProvider,
} from "./types";

const BASE_URL = "https://api.printful.com";
const USER_AGENT = "Kitty/1.0 (Node.js)";
const TIMEOUT_MS = 15_000;
export const PRINTFUL_SECRET_HEADER = "x-printful-webhook-secret";

export interface PrintfulConfig {
  token: string;
  storeId: string;
  webhookSecret?: string;
  /** Default true: confirm (pay + start fulfilment) immediately. */
  confirm?: boolean;
}

interface PrintfulEnvelope<T> {
  code: number;
  result: T;
  error?: { message?: string };
}

async function printfulFetch<T>(cfg: PrintfulConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
  const text = await res.text();
  let json: PrintfulEnvelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as PrintfulEnvelope<T>) : null;
  } catch {
    json = null;
  }
  if (!res.ok || !json || json.code >= 400) {
    const msg = json?.error?.message ?? text.slice(0, 500);
    throw new Error(`Printful ${init.method ?? "GET"} ${path} failed: ${res.status} ${msg}`);
  }
  return json.result;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractTracking(shipment: Record<string, unknown>): Tracking | null {
  const carrier = str(shipment.carrier) ?? str(shipment.service);
  const number = str(shipment.tracking_number);
  const url = str(shipment.tracking_url);
  if (!number && !url) return null;
  return { carrier: carrier ?? null, number: number ?? null, url: url ?? null };
}

/** Pure mapping from a parsed Printful webhook body to our event. */
export function parsePrintfulPayload(json: unknown): PodEvent | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const topic = str(body.type) ?? "";
  const data = asRecord(body.data);
  const order = asRecord(data.order);
  const rawId = order.id;
  const providerOrderId =
    typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : null;
  const tracking = extractTracking(asRecord(data.shipment));

  switch (topic) {
    case "package_shipped":
      return { type: "shipment_created", topic, providerOrderId, tracking, status: "shipped", raw: json };
    case "order_canceled":
      return { type: "order_updated", topic, providerOrderId, tracking: null, status: "cancelled", raw: json };
    case "order_failed":
      return { type: "order_updated", topic, providerOrderId, tracking: null, status: "failed", raw: json };
    case "order_updated": {
      const s = (str(order.status) ?? "").toLowerCase();
      // Printful order statuses: draft, pending, failed, canceled, inprocess,
      // onhold, partial, fulfilled. Only movements we model are mapped.
      const status =
        s === "inprocess" ? "in_production" : s === "canceled" ? "cancelled" : s === "failed" ? "failed" : null;
      return { type: "order_updated", topic, providerOrderId, tracking, status, raw: json };
    }
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

export function createPrintfulProvider(cfg: PrintfulConfig): PodProvider {
  return {
    name: "printful",

    async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
      if (!items.length) throw new PodUnmappedError([]);
      const body = {
        external_id: order.stripeSessionId,
        shipping: "STANDARD",
        recipient: {
          name: `${address.firstName} ${address.lastName}`.trim(),
          address1: address.address1,
          address2: address.address2 || undefined,
          city: address.city,
          state_code: address.region || undefined,
          country_code: address.country,
          zip: address.zip,
          phone: address.phone || undefined,
          email: address.email || undefined,
        },
        items: items.map((item) => ({
          sync_variant_id: item.podVariantId,
          quantity: item.quantity,
        })),
      };
      const confirm = cfg.confirm !== false;
      const created = await printfulFetch<{ id: number | string; status?: string }>(
        cfg,
        confirm ? "/orders?confirm=true" : "/orders",
        { method: "POST", body: JSON.stringify(body) },
      );
      const providerOrderId = String(created.id);
      if (!confirm) {
        return { providerOrderId, sentToProduction: false, note: "draft: PRINTFUL_CONFIRM=0" };
      }
      return { providerOrderId, sentToProduction: true, note: created.status };
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
      return parsePrintfulPayload(json);
    },
  };
}
