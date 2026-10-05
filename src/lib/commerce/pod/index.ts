import { getEnv, hasPrintful, hasPrintify } from "../env";
import { demoPod } from "./demo";
import { createPrintfulProvider } from "./printful";
import { createPrintifyProvider } from "./printify";
import type { PodProvider } from "./types";

/**
 * One provider per distinct configuration. The key covers everything the
 * provider is built from (never logged), so a changed env — a store id that
 * lands, a harness pointing at a mock — is never served a stale provider.
 */
let cached: { key: string; provider: PodProvider } | null = null;

function remember(key: string, build: () => PodProvider): PodProvider {
  if (cached?.key !== key) cached = { key, provider: build() };
  return cached.provider;
}

/**
 * Printful when PRINTFUL_API_TOKEN + PRINTFUL_STORE_ID are set (the UK
 * primary), else Printify when PRINTIFY_API_TOKEN + PRINTIFY_SHOP_ID are set,
 * else the demo provider. Never both: one shop, one fulfilment partner.
 */
export function getPod(): PodProvider {
  const env = getEnv();
  if (hasPrintful(env) && env.printfulApiToken && env.printfulStoreId) {
    const token = env.printfulApiToken;
    const storeId = env.printfulStoreId;
    const apiUrl = env.printfulApiUrl;
    const key = ["printful", storeId, apiUrl ?? "", token, env.printfulConfirm, env.printfulWebhookSecret ?? ""].join("\u0000");
    return remember(key, () =>
      createPrintfulProvider({
        token,
        storeId,
        webhookSecret: env.printfulWebhookSecret,
        confirm: env.printfulConfirm,
        apiUrl,
      }),
    );
  }
  if (hasPrintify(env) && env.printifyApiToken && env.printifyShopId) {
    const token = env.printifyApiToken;
    const shopId = env.printifyShopId;
    const apiUrl = env.printifyApiUrl;
    const key = ["printify", shopId, apiUrl ?? "", token, env.printifySendToProduction, env.printifyWebhookSecret ?? ""].join("\u0000");
    return remember(key, () =>
      createPrintifyProvider({
        token,
        shopId,
        webhookSecret: env.printifyWebhookSecret,
        sendToProduction: env.printifySendToProduction,
        apiUrl,
      }),
    );
  }
  return demoPod;
}

export { PRINTFUL_SECRET_HEADER } from "./printful";
export * from "./types";
