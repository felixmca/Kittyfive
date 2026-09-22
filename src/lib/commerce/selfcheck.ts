/**
 * Cheap invariants over src/config/products.ts and the env, returned by
 * GET /api/commerce/status in demo mode so a broken config is visible before
 * any money moves. Pure: no network, no database.
 */
import { PRODUCTS, SHIPPING, SNACK, findVariant } from "@/config/products";
import { getEnv, hasPod, hasStripe, hasSupabase } from "./env";

export interface SelfCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface SelfCheckResult {
  ok: boolean;
  checks: SelfCheck[];
}

/** Stripe's documented unsupported shipping countries. */
const STRIPE_UNSUPPORTED = new Set(["AS", "CX", "CC", "CU", "HM", "IR", "KP", "MH", "FM", "NF", "MP", "PW", "SY", "UM", "VI"]);

function isPositiveInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export function runSelfCheck(): SelfCheckResult {
  const checks: SelfCheck[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push(detail ? { name, ok, detail } : { name, ok });

  add("products.nonEmpty", PRODUCTS.length > 0, `${PRODUCTS.length} products`);

  const allVariants = PRODUCTS.flatMap((p) => p.variants);
  const variantIds = allVariants.map((v) => v.id);
  const duplicates = variantIds.filter((id, i) => variantIds.indexOf(id) !== i);
  add(
    "variants.uniqueIds",
    duplicates.length === 0,
    duplicates.length ? `duplicates: ${duplicates.join(", ")}` : `${variantIds.length} variants`,
  );

  const badLookups: string[] = [];
  for (const product of PRODUCTS) {
    for (const variant of product.variants) {
      const found = findVariant(variant.id);
      if (!found || found.product.id !== product.id || found.variant.id !== variant.id) badLookups.push(variant.id);
    }
  }
  add("findVariant.roundTrips", badLookups.length === 0, badLookups.length ? badLookups.join(", ") : undefined);
  add("findVariant.rejectsUnknown", findVariant("definitely-not-a-variant") === undefined);

  const badPrices = PRODUCTS.filter((p) => !isPositiveInt(p.pricePence)).map((p) => p.id);
  add("products.pricesPositiveIntegers", badPrices.length === 0, badPrices.length ? badPrices.join(", ") : undefined);
  add("snack.pricePositiveInteger", isPositiveInt(SNACK.pricePence), `${SNACK.pricePence}p`);
  add(
    "shipping.ukPenceNonNegativeInteger",
    Number.isInteger(SHIPPING.ukPence) && SHIPPING.ukPence >= 0,
    `${SHIPPING.ukPence}p`,
  );

  const countries: readonly string[] = SHIPPING.countries;
  const badCountries = countries.filter((c) => !/^[A-Z]{2}$/.test(c) || STRIPE_UNSUPPORTED.has(c));
  add(
    "shipping.countriesValid",
    countries.length > 0 && badCountries.length === 0,
    badCountries.length ? badCountries.join(", ") : countries.join(", "),
  );

  const badImages = PRODUCTS.filter((p) => !p.images.front.startsWith("/")).map((p) => p.id);
  add("products.imagePathsRootRelative", badImages.length === 0, badImages.length ? badImages.join(", ") : undefined);

  const halfMapped = allVariants
    .filter((v) => Boolean(v.podProductId) !== (typeof v.podVariantId === "number"))
    .map((v) => v.id);
  add(
    "variants.podMappingComplete",
    halfMapped.length === 0,
    halfMapped.length ? `podProductId without podVariantId (or vice versa): ${halfMapped.join(", ")}` : undefined,
  );
  const mappedCount = allVariants.filter((v) => v.podProductId && typeof v.podVariantId === "number").length;
  add("variants.podMapped", true, `${mappedCount}/${variantIds.length} variants mapped to a print provider`);

  const env = getEnv();
  const stripeHalf = Boolean(env.stripeSecretKey) !== Boolean(env.stripeWebhookSecret);
  add(
    "env.stripePairComplete",
    !stripeHalf,
    stripeHalf
      ? "one of STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET is missing"
      : hasStripe(env)
        ? "configured"
        : "unset (demo)",
  );
  const supabaseHalf = Boolean(env.supabaseUrl) !== Boolean(env.supabaseServiceRoleKey);
  add(
    "env.supabasePairComplete",
    !supabaseHalf,
    supabaseHalf
      ? "one of NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY is missing"
      : hasSupabase(env)
        ? "configured"
        : "unset (demo)",
  );
  const printfulHalf = Boolean(env.printfulApiToken) !== Boolean(env.printfulStoreId);
  add(
    "env.printfulPairComplete",
    !printfulHalf,
    printfulHalf
      ? "one of PRINTFUL_API_TOKEN / PRINTFUL_STORE_ID is missing"
      : env.printfulApiToken
        ? "configured (Printful UK is the active provider)"
        : "unset",
  );
  const podHalf = Boolean(env.printifyApiToken) !== Boolean(env.printifyShopId);
  add(
    "env.printifyPairComplete",
    !podHalf,
    podHalf ? "one of PRINTIFY_API_TOKEN / PRINTIFY_SHOP_ID is missing" : hasPod(env) ? "configured" : "unset (demo)",
  );
  const liveKeyInDemo = Boolean(env.stripeSecretKey?.startsWith("sk_live_")) && !hasSupabase(env);
  add(
    "env.noLiveKeyWithoutDatabase",
    !liveKeyInDemo,
    liveKeyInDemo ? "sk_live_ set but Supabase is not: refusing to be live" : undefined,
  );

  return { ok: checks.every((c) => c.ok), checks };
}
