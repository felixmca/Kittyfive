/**
 * Commerce contract for the Kitty store.
 *
 * One interface, two implementations, chosen at runtime by env presence in
 * ./index.ts:
 *   - ./stripe.ts  live: Stripe Checkout + verified webhook + Supabase orders
 *                  + print-on-demand (Printify) + email (Resend)
 *   - ./demo.ts    in-memory, zero env vars, clearly labelled DEMO
 *
 * REAL MONEY. There is no play economy in v1. Orders are written only by the
 * verified Stripe webhook using the service-role key on the server; the
 * browser never writes them.
 */

export type CommerceMode = "demo" | "live";
export type OrderKind = "merch" | "snack";
export type OrderStatus =
  | "paid"
  | "submitted"
  | "in_production"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "failed";

export const ORDER_STATUSES: readonly OrderStatus[] = [
  "paid",
  "submitted",
  "in_production",
  "shipped",
  "delivered",
  "cancelled",
  "failed",
];

/** Checkout accepts 1..MAX_QUANTITY of a single variant per session. */
export const MAX_QUANTITY = 5;

export interface PostalAddress {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
}

export interface Tracking {
  carrier: string | null;
  number: string | null;
  url: string | null;
}

export interface OrderItemSummary {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  quantity: number;
  unitPence: number;
}

/** What the success page shows. Never contains secrets or full addresses. */
export interface OrderSummary {
  sessionId: string;
  kind: OrderKind;
  status: OrderStatus;
  amountPence: number;
  currency: string;
  email: string | null;
  name: string | null;
  items: OrderItemSummary[];
  tracking: Tracking | null;
  createdAt: string;
  /** True when this summary came from the demo implementation. */
  demo: boolean;
  /**
   * True when Stripe says the session is paid but the webhook has not written
   * the order to Supabase yet (webhooks can lag the redirect by a second).
   */
  pending?: boolean;
}

export interface CommerceStatus {
  mode: CommerceMode;
  stripe: boolean;
  supabase: boolean;
  pod: boolean;
  email: boolean;
}

export interface StripeWebhookResult {
  received: true;
  demo?: boolean;
  type?: string;
  handled?: boolean;
  duplicate?: boolean;
  orderId?: string;
  note?: string;
}

export interface Commerce {
  createMerchCheckout(input: {
    variantId: string;
    quantity: number;
    origin: string;
  }): Promise<{ url: string }>;
  createSnackCheckout(input: { origin: string }): Promise<{ url: string }>;
  /**
   * Verifies and handles a Stripe webhook delivery. Throws CommerceError(400)
   * on a bad signature; resolves for handled, duplicate and ignored events.
   */
  handleStripeEvent(rawBody: string, signature: string | null): Promise<StripeWebhookResult>;
  getOrderForSession(sessionId: string): Promise<OrderSummary | null>;
  status(): CommerceStatus;
}

/** An error with an HTTP status the route handlers can pass straight through. */
export class CommerceError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CommerceError";
    this.status = status;
  }
}

/** Parses a quantity from untrusted input; 1 when absent. Throws CommerceError. */
export function validateQuantity(input: unknown): number {
  const q = input === undefined || input === null || input === "" ? 1 : Number(input);
  if (!Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) {
    throw new CommerceError(`quantity must be a whole number between 1 and ${MAX_QUANTITY}`);
  }
  return q;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
