/**
 * Demo print-on-demand provider: logs the order it would have placed and
 * returns a fake id. Parses webhooks of either shape, unverified: a Printful
 * body (`data` + string `type`) or a Printify body (`resource` + `type`).
 */
import { randomUUID } from "node:crypto";
import { parsePrintfulPayload } from "./printful";
import { parsePrintifyPayload } from "./printify";
import type { PodAddress, PodCreateResult, PodEvent, PodLineItem, PodOrderRef, PodProvider } from "./types";

function describeItem(item: PodLineItem): string {
  const target = item.catalog
    ? `catalog ${item.catalog.variantId} + ${item.catalog.files.length} files`
    : `${item.podProductId}/${item.podVariantId}`;
  return `${item.variantId} x${item.quantity} -> ${target}`;
}

function looksLikePrintful(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const body = json as Record<string, unknown>;
  return "data" in body && typeof body.type === "string";
}

export const demoPod: PodProvider = {
  name: "demo",

  async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
    const providerOrderId = `demo_${randomUUID().slice(0, 8)}`;
    console.log("[pod:demo] would create order", {
      providerOrderId,
      orderId: order.id,
      items: items.map(describeItem),
      shipTo: `${address.firstName} ${address.lastName}, ${address.city} ${address.zip} ${address.country}`,
    });
    return { providerOrderId, sentToProduction: false, note: "demo provider: nothing was ordered" };
  },

  parseWebhook(rawBody: string): PodEvent | null {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return null;
    }
    return looksLikePrintful(json) ? parsePrintfulPayload(json) : parsePrintifyPayload(json);
  },
};
