/**
 * Printify adapter.
 *
 * Verified against https://developers.printify.com/openapi.json (Sept 2026):
 *   POST /v1/shops/{shop_id}/orders.json
 *     body: { external_id?, label?, line_items: [{ product_id, variant_id, quantity }],
 *             shipping_method?, send_shipping_notification?,
 *             address_to: { first_name, last_name, email, phone, country, region?,
 *                           address1, address2?, city, zip } }
 *     200: { id }
 *   POST /v1/shops/{shop_id}/orders/{order_id}/send_to_production.json
 *   Webhook topics include order:created, order:updated, order:sent-to-production,
 *   order:shipment:created, order:shipment:delivered.
 *   Webhook signature: header X-Pfy-Signature = "sha256=" + HMAC-SHA256(rawBody, secret).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
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

const BASE_URL = "https://api.printify.com/v1";
const USER_AGENT = "Kitty/1.0 (Node.js)";
const TIMEOUT_MS = 15_000;

export interface PrintifyConfig {
  token: string;
  shopId: string;
  webhookSecret?: string;
  sendToProduction?: boolean;
}

async function printifyFetch<T>(cfg: PrintifyConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Printify ${init.method ?? "GET"} ${path} failed: ${res.status} ${text.slice(0, 500)}`);
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
    const url = str(o.url) ?? str(o.tracking_url) ?? str(carrierObj.tracking_url);
    if (number || url) return { carrier: carrier ?? null, number: number ?? null, url: url ?? null };
  }
  return null;
}

/** Pure mapping from a parsed Printify webhook body to our event. Shared with the demo provider. */
export function parsePrintifyPayload(json: unknown): PodEvent | null {
  if (!json || typeof json !== "object") return null;
  const body = json as Record<string, unknown>;
  const topic = str(body.type) ?? str(body.topic) ?? "";
  const resource = asRecord(body.resource);
  const rawId = resource.id;
  const providerOrderId =
    typeof rawId === "string" ? rawId : typeof rawId === "number" ? String(rawId) : null;
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
  return {
    name: "printify",

    async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
      if (!items.length) throw new PodUnmappedError([]);
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
      const created = await printifyFetch<{ id: string }>(cfg, `/shops/${cfg.shopId}/orders.json`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const providerOrderId = String(created.id);

      if (cfg.sendToProduction === false) {
        return { providerOrderId, sentToProduction: false, note: "held: PRINTIFY_SEND_TO_PRODUCTION=0" };
      }
      try {
        await printifyFetch(cfg, `/shops/${cfg.shopId}/orders/${providerOrderId}/send_to_production.json`, {
          method: "POST",
          body: "{}",
        });
        return { providerOrderId, sentToProduction: true };
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        console.error("[printify] created order but send_to_production failed:", note);
        return { providerOrderId, sentToProduction: false, note };
      }
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
