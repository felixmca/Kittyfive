/**
 * Entry point: getCommerce() returns the live implementation when every
 * required env var is present, otherwise the demo one. Server-only (pulls in
 * stripe, supabase and resend); client components talk to /api/* instead.
 */
import { createDemoCommerce } from "./demo";
import { isLive } from "./env";
import { createLiveCommerce } from "./stripe";
import type { Commerce, CommerceStatus } from "./types";

let live: Commerce | null = null;
let demo: Commerce | null = null;

export function getCommerce(): Commerce {
  if (isLive()) {
    live ??= createLiveCommerce();
    return live;
  }
  demo ??= createDemoCommerce();
  return demo;
}

/** Public, secret-free description of the current mode. */
export function status(): CommerceStatus {
  return getCommerce().status();
}

export { isLive } from "./env";
export { CommerceError, MAX_QUANTITY, validateQuantity } from "./types";
export type {
  Commerce,
  CommerceMode,
  CommerceStatus,
  OrderItemSummary,
  OrderKind,
  OrderStatus,
  OrderSummary,
  PostalAddress,
  StripeWebhookResult,
  Tracking,
} from "./types";
