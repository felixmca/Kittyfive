/**
 * Cheap invariants over src/config/products.ts, src/config/printful.ts,
 * src/config/pod-ids.json and the env, returned by GET /api/commerce/status
 * in demo mode so a broken config is visible before any money moves. Pure: no
 * network, no database, no filesystem beyond the statically imported JSON.
 */
import { podIds, podIdsFile } from "@/config/pod-ids";
import { PRINTFUL_BLUEPRINTS, printfulCatalogVariant } from "@/config/printful";
import { PRODUCTS, SHIPPING, SNACK, findVariant } from "@/config/products";
import { getEnv, harnessOverridesPresent, hasPod, hasPrintful, hasPrintify, hasStripe, hasSupabase, type CommerceEnv } from "./env";

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

/** The provider pod/index.ts would pick for this env, and the store it is scoped to. */
function configuredProvider(env: CommerceEnv): { provider: "printful" | "printify" | "demo"; storeId: string | null } {
  if (hasPrintful(env)) return { provider: "printful", storeId: env.printfulStoreId ?? null };
  if (hasPrintify(env)) return { provider: "printify", storeId: env.printifyShopId ?? null };
  return { provider: "demo", storeId: null };
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

  const env = getEnv();
  const active = configuredProvider(env);

  // Store-mapped: ids written in products.ts, or generated for the configured
  // provider + store. Catalog-mapped: no store ids, but a Printful blueprint
  // (mapItemsToPod orders the catalog variant with its print files).
  let storeMapped = 0;
  let catalogMapped = 0;
  for (const v of allVariants) {
    const inline = Boolean(v.podProductId) && typeof v.podVariantId === "number";
    if (inline || podIds(v.id, { provider: active.provider, storeId: active.storeId })) storeMapped += 1;
    else if (printfulCatalogVariant(v.id)) catalogMapped += 1;
  }
  const unmappedCount = variantIds.length - storeMapped - catalogMapped;
  add(
    "variants.podMapped",
    true,
    `${storeMapped}/${variantIds.length} store-mapped (products.ts or pod-ids.json for ${active.provider}), ` +
      `${catalogMapped}/${variantIds.length} catalog-mapped (Printful blueprint), ${unmappedCount} unmapped`,
  );

  // Every variant has exactly one blueprint entry, every blueprint variant is
  // ours, and every print file lives under public/print.
  const blueprintProblems: string[] = [];
  const known = new Set(variantIds);
  const seen = new Map<string, number>();
  for (const blueprint of PRINTFUL_BLUEPRINTS) {
    for (const id of Object.keys(blueprint.variants)) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (!known.has(id)) blueprintProblems.push(`${blueprint.productId} lists unknown variant ${id}`);
    }
    for (const placement of blueprint.placements) {
      if (!placement.file.startsWith("/print/")) {
        blueprintProblems.push(`${blueprint.productId}/${placement.placement} file ${placement.file} is not under /print/`);
      }
    }
  }
  for (const id of variantIds) {
    const count = seen.get(id) ?? 0;
    if (count === 0) blueprintProblems.push(`${id} has no blueprint`);
    else if (count > 1) blueprintProblems.push(`${id} is in ${count} blueprints`);
  }
  add(
    "printful.blueprintsCoverEveryVariant",
    blueprintProblems.length === 0,
    blueprintProblems.length
      ? blueprintProblems.join("; ")
      : `${PRINTFUL_BLUEPRINTS.length} blueprints cover all ${variantIds.length} variants`,
  );

  // A catalog order sends Printful the print-file URLs built from
  // NEXT_PUBLIC_SITE_URL; mapItemsToPod refuses anything but https.
  const siteUrl = env.siteUrl ?? "";
  const httpsSite = /^https:\/\//i.test(siteUrl);
  const printfulConfigured = hasPrintful(env);
  add(
    "printful.catalogOrderNeedsHttpsSiteUrl",
    !printfulConfigured || httpsSite,
    printfulConfigured
      ? httpsSite
        ? `NEXT_PUBLIC_SITE_URL is https; Printful can fetch /print files for catalog orders`
        : `NEXT_PUBLIC_SITE_URL is ${siteUrl ? "not https" : "unset"}: variants without store ids cannot be ordered from the catalog and will be left unmapped`
      : `Printful not configured; NEXT_PUBLIC_SITE_URL ${httpsSite ? "is https" : siteUrl ? "is not https (catalog orders would be unmapped)" : "is unset (catalog orders would be unmapped)"}`,
  );

  // Generated store ids only mean something inside the store they came from.
  const ids = podIdsFile();
  const idCount = Object.keys(ids.variants).length;
  if (ids.provider && ids.storeId) {
    if (active.provider === "demo") {
      add(
        "podIds.matchesConfiguredStore",
        true,
        `pod-ids.json has ${idCount} ids for ${ids.provider} store ${ids.storeId}; no provider configured, so they are unused`,
      );
    } else {
      const matches = ids.provider === active.provider && ids.storeId === active.storeId;
      add(
        "podIds.matchesConfiguredStore",
        matches,
        matches
          ? `pod-ids.json: ${idCount} ids for ${ids.provider} store ${ids.storeId}`
          : `pod-ids.json was generated for ${ids.provider} store ${ids.storeId} but the configured provider is ${active.provider} store ${active.storeId ?? "(none)"}; its ids are ignored — re-run the sync for this store`,
      );
    }
  } else {
    add("podIds.matchesConfiguredStore", true, "no generated ids yet");
  }

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
  const overrides = harnessOverridesPresent();
  add(
    "env.noHarnessOverrides",
    overrides.length === 0,
    overrides.length
      ? `${overrides.join(", ")} set: these exist for scripts/verify-commerce.mjs only (ignored in production unless they point at localhost)`
      : undefined,
  );
  const liveKeyInDemo = Boolean(env.stripeSecretKey?.startsWith("sk_live_")) && !hasSupabase(env);
  add(
    "env.noLiveKeyWithoutDatabase",
    !liveKeyInDemo,
    liveKeyInDemo ? "sk_live_ set but Supabase is not: refusing to be live" : undefined,
  );

  return { ok: checks.every((c) => c.ok), checks };
}
