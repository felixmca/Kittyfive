/**
 * Print-on-demand adapter contract. Printful is the primary UK provider
 * (./printful.ts) when PRINTFUL_API_TOKEN + PRINTFUL_STORE_ID are set; Printify
 * (./printify.ts) is the fallback; a demo provider (./demo.ts) runs when neither
 * token is configured.
 */
import { podIds } from "@/config/pod-ids";
import { printfulCatalogVariant, type PrintfulOption } from "@/config/printful";
import { findVariant } from "@/config/products";
import type { OrderStatus, PostalAddress, Tracking } from "../types";

export interface PodAddress {
  /** The name exactly as the customer typed it at checkout (Printful prints this one). */
  fullName: string;
  /** Split for providers that want two fields (Printify); a one-word name repeats in both. */
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

/** A print file attached to a catalog order (Printful: { type, url }). */
export interface PodCatalogFile {
  placement: string;
  /** Absolute https URL the provider can fetch. */
  url: string;
}

export interface PodLineItem {
  /** Our variant id, e.g. "hoodie-black-m". */
  variantId: string;
  quantity: number;
  /** Store-side ids (Printful sync product / sync variant, Printify product / variant). */
  podProductId?: string;
  podVariantId?: number;
  /**
   * Printful only: order the catalog variant directly, with the print files
   * and item options from src/config/printful.ts, when no store ids exist.
   */
  catalog?: {
    variantId: number;
    files: PodCatalogFile[];
    options?: PrintfulOption[];
  };
}

export interface PodOrderRef {
  /** Our order id (uuid). */
  id: string;
  stripeSessionId: string;
  email: string | null;
}

export interface PodCreateResult {
  providerOrderId: string;
  /** Whether the order started production: send_to_production (Printify) or
   * confirm (Printful) succeeded. */
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
  /** The store / shop the provider is configured for (Printful store id, Printify shop id), for id checks. */
  readonly storeId?: string;
  createOrder(order: PodOrderRef, items: PodLineItem[], address: PodAddress): Promise<PodCreateResult>;
  /**
   * Verifies (when a secret is configured) and parses a webhook delivery.
   * Returns null for bodies that are not a recognisable event.
   * Throws PodSignatureError when the signature is present but wrong.
   */
  parseWebhook(rawBody: string, headers: Headers): PodEvent | null;
  /**
   * Start production for an order that was created without it (Printful:
   * POST /orders/{id}/confirm; Printify: send_to_production). Optional; the
   * admin page offers it when the provider implements it.
   */
  confirmOrder?(providerOrderId: string): Promise<PodCreateResult>;
  /** Read the order back from the provider, mapped to our status where possible. Optional. */
  getOrder?(providerOrderId: string): Promise<PodOrderStatus>;
}

export interface PodOrderStatus {
  providerOrderId: string;
  /** The provider's own status string, e.g. "draft", "inprocess", "fulfilled". */
  providerStatus: string;
  /** Our status it maps to, or null when the provider's status has no counterpart. */
  status: OrderStatus | null;
  tracking: Tracking | null;
  raw: unknown;
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

export interface PodMapContext {
  /** The active provider's name: "printful" | "printify" | "demo". */
  provider: string;
  /** PRINTFUL_STORE_ID / PRINTIFY_SHOP_ID, to accept only ids generated for this store. */
  storeId?: string | null;
  /** NEXT_PUBLIC_SITE_URL: print files must be public https URLs for a catalog order. */
  siteUrl?: string | null;
}

function absoluteHttps(siteUrl: string | null | undefined, path: string): string | null {
  if (!siteUrl) return null;
  try {
    const url = new URL(path, siteUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Map our order items to provider ids. Resolution order per variant:
 *   1. podProductId + podVariantId written by hand in src/config/products.ts
 *   2. src/config/pod-ids.json, when generated for this provider and store
 *   3. (Printful, and the demo provider standing in for it) the catalog
 *      blueprint in src/config/printful.ts: variant_id + print files, which
 *      needs NEXT_PUBLIC_SITE_URL to be https so Printful can fetch the files
 *   4. unmapped: the caller must NOT call the provider (owner fulfils by hand).
 */
export function mapItemsToPod(
  items: Array<{ variant_id: string; quantity: number }>,
  ctx: PodMapContext,
): { mapped: PodLineItem[]; unmapped: string[] } {
  const mapped: PodLineItem[] = [];
  const unmapped: string[] = [];
  for (const item of items) {
    const found = findVariant(item.variant_id);
    if (!found) {
      unmapped.push(item.variant_id);
      continue;
    }
    const inline = found.variant;
    if (inline.podProductId && typeof inline.podVariantId === "number") {
      mapped.push({
        variantId: item.variant_id,
        quantity: item.quantity,
        podProductId: inline.podProductId,
        podVariantId: inline.podVariantId,
      });
      continue;
    }
    const generated = podIds(item.variant_id, { provider: ctx.provider, storeId: ctx.storeId });
    if (generated) {
      mapped.push({
        variantId: item.variant_id,
        quantity: item.quantity,
        podProductId: generated.productId,
        podVariantId: generated.variantId,
      });
      continue;
    }
    if (ctx.provider === "printful" || ctx.provider === "demo") {
      const catalog = printfulCatalogVariant(item.variant_id);
      const files = catalog
        ? catalog.blueprint.placements.map((p) => ({ placement: p.placement, url: absoluteHttps(ctx.siteUrl, p.file) }))
        : [];
      if (catalog && files.length && files.every((f) => f.url)) {
        mapped.push({
          variantId: item.variant_id,
          quantity: item.quantity,
          catalog: {
            variantId: catalog.catalogVariantId,
            files: files.map((f) => ({ placement: f.placement, url: f.url as string })),
            options: catalog.blueprint.options,
          },
        });
        continue;
      }
    }
    unmapped.push(item.variant_id);
  }
  return { mapped, unmapped };
}

export function toPodAddress(address: PostalAddress, email: string | null, phone: string | null): PodAddress {
  const parts = address.name.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? "Kitty";
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : firstName;
  return {
    fullName: address.name.trim() || firstName,
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
