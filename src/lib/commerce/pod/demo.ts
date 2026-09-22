/**
 * Demo print-on-demand provider: logs the order it would have placed and
 * returns a fake id. Parses webhooks with the Printify shape, unverified.
 */
import { randomUUID } from "node:crypto";
import { parsePrintifyPayload } from "./printify";
import type { PodAddress, PodCreateResult, PodEvent, PodLineItem, PodOrderRef, PodProvider } from "./types";

export const demoPod: PodProvider = {
  name: "demo",

  async createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult> {
    const providerOrderId = `demo_${randomUUID().slice(0, 8)}`;
    console.log("[pod:demo] would create order", {
      providerOrderId,
      orderId: order.id,
      items: items.map((i) => `${i.variantId} x${i.quantity} -> ${i.podProductId}/${i.podVariantId}`),
      shipTo: `${address.firstName} ${address.lastName}, ${address.city} ${address.zip} ${address.country}`,
    });
    return { providerOrderId, sentToProduction: false, note: "demo provider: nothing was ordered" };
  },

  parseWebhook(rawBody: string): PodEvent | null {
    try {
      return parsePrintifyPayload(JSON.parse(rawBody));
    } catch {
      return null;
    }
  },
};
