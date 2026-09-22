/**
 * Server-side env for the money path. Read lazily so a missing variable is a
 * runtime decision (demo vs live), never an import-time crash.
 *
 * isLive() requires Stripe key + Stripe webhook secret + Supabase URL +
 * Supabase service-role key. Printify and Resend are optional extras: without
 * them, orders are still recorded and the owner fulfils / emails by hand.
 */

export interface CommerceEnv {
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  printifyApiToken?: string;
  printifyShopId?: string;
  printifyWebhookSecret?: string;
  /** Default true: submitted Printify orders are sent to production at once. */
  printifySendToProduction: boolean;
  /** Printful (UK primary): token + store id select it over Printify. */
  printfulApiToken?: string;
  printfulStoreId?: string;
  printfulWebhookSecret?: string;
  /** Default true: Printful orders are confirmed (paid + fulfilled) at once. */
  printfulConfirm: boolean;
  resendApiKey?: string;
  emailFrom?: string;
  siteUrl?: string;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getEnv(): CommerceEnv {
  const sendToProduction = read("PRINTIFY_SEND_TO_PRODUCTION");
  const printfulConfirm = read("PRINTFUL_CONFIRM");
  return {
    printfulApiToken: read("PRINTFUL_API_TOKEN"),
    printfulStoreId: read("PRINTFUL_STORE_ID"),
    printfulWebhookSecret: read("PRINTFUL_WEBHOOK_SECRET"),
    printfulConfirm: !(printfulConfirm === "0" || printfulConfirm === "false"),
    stripeSecretKey: read("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: read("STRIPE_WEBHOOK_SECRET"),
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseServiceRoleKey: read("SUPABASE_SERVICE_ROLE_KEY"),
    printifyApiToken: read("PRINTIFY_API_TOKEN"),
    printifyShopId: read("PRINTIFY_SHOP_ID"),
    printifyWebhookSecret: read("PRINTIFY_WEBHOOK_SECRET"),
    printifySendToProduction: !(sendToProduction === "0" || sendToProduction === "false"),
    resendApiKey: read("RESEND_API_KEY"),
    emailFrom: read("EMAIL_FROM"),
    siteUrl: read("NEXT_PUBLIC_SITE_URL"),
  };
}

export function hasStripe(env: CommerceEnv = getEnv()): boolean {
  return Boolean(env.stripeSecretKey && env.stripeWebhookSecret);
}

export function hasSupabase(env: CommerceEnv = getEnv()): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function hasPrintful(env: CommerceEnv = getEnv()): boolean {
  return Boolean(env.printfulApiToken && env.printfulStoreId);
}

export function hasPrintify(env: CommerceEnv = getEnv()): boolean {
  return Boolean(env.printifyApiToken && env.printifyShopId);
}

/** Any print provider configured (Printful preferred, Printify otherwise). */
export function hasPod(env: CommerceEnv = getEnv()): boolean {
  return hasPrintful(env) || hasPrintify(env);
}

export function hasEmail(env: CommerceEnv = getEnv()): boolean {
  return Boolean(env.resendApiKey && env.emailFrom);
}

/** Live means real Stripe sessions and real Supabase writes. */
export function isLive(env: CommerceEnv = getEnv()): boolean {
  return hasStripe(env) && hasSupabase(env);
}
