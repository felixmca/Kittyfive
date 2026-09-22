/**
 * Print-on-demand adapter contract. Printify by default (./printify.ts); a
 * demo provider (./demo.ts) when no token is configured.
 */
import { findVariant } from "@/config/products";
import type { OrderStatus, PostalAddress, Tracking } from "../types";

export interface PodAddress {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  region: string;
  address1: string;
  address2: string;
  city: string;
  zip: string;
}

export interface PodLineItem {
  /** Our variant id, e.g. "hoodie-black-m". */
  variantId: string;
  podProductId: string;
  podVariantId: number;
  quantity: number;
}

export interface PodOrderRef {
  /** Our order id (uuid). */
  id: string;
  stripeSessionId: string;
  email: string | null;
}

export interface PodCreateResult {
  providerOrderId: string;
  /** Printify: whether send_to_production succeeded. */
  sentToProduction?: boolean;
  note?: string;
}

export type PodEventType =
  | "shipment_created"
  | "shipment_delivered"
  | "sent_to_production"
  | "order_updated"
  | "ignored";

export interface PodEvent {
  type: PodEventType;
  /** Provider's topic string, e.g. "order:shipment:created". */
  topic: string;
  providerOrderId: string | null;
  tracking: Tracking | null;
  /** Our status to move to, or null to only log. */
  status: OrderStatus | null;
  raw: unknown;
}

export interface PodProvider {
  readonly name: string;
  createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult>;
  /**
   * Verifies (when a secret is configured) and parses a webhook delivery.
   * Returns null for bodies that are not a recognisable event.
   * Throws PodSignatureError when the signature is present but wrong.
   */
  parseWebhook(rawBody: string, headers: Headers): PodEvent | null;
}

export class PodUnmappedError extends Error {
  readonly unmapped: string[];
  constructor(unmapped: string[]) {
    super(`No print-on-demand mapping for: ${unmapped.join(", ")}`);
    this.name = "PodUnmappedError";
    this.unmapped = unmapped;
  }
}

export class PodSignatureError extends Error {
  constructor(message = "Invalid print-on-demand webhook signature") {
    super(message);
    this.name = "PodSignatureError";
  }
}

/**
 * Map our order items to provider ids via src/config/products.ts. A variant
 * with no podProductId/podVariantId is reported as unmapped; the caller must
 * NOT call the provider in that case (owner fulfils by hand).
 */
export function mapItemsToPod(
  items: Array<{ variant_id: string; quantity: number }>,
): { mapped: PodLineItem[]; unmapped: string[] } {
  const mapped: PodLineItem[] = [];
  const unmapped: string[] = [];
  for (const item of items) {
    const found = findVariant(item.variant_id);
    const podProductId = found?.variant.podProductId;
    const podVariantId = found?.variant.podVariantId;
    if (!found || !podProductId || typeof podVariantId !== "number") {
      unmapped.push(item.variant_id);
      continue;
    }
    mapped.push({ variantId: item.variant_id, podProductId, podVariantId, quantity: item.quantity });
  }
  return { mapped, unmapped };
}

export function toPodAddress(address: PostalAddress, email: string | null, phone: string | null): PodAddress {
  const parts = address.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Kitty";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  return {
    firstName,
    lastName,
    email: email ?? "",
    phone: phone ?? "",
    country: address.country,
    region: address.state ?? "",
    address1: address.line1,
    address2: address.line2 ?? "",
    city: address.city,
    zip: address.postalCode,
  };
}
