import { getEnv, hasPrintful, hasPrintify } from "../env";
import { demoPod } from "./demo";
import { createPrintfulProvider } from "./printful";
import { createPrintifyProvider } from "./printify";
import type { PodProvider } from "./types";

let cached: PodProvider | null = null;

/**
 * Printful when PRINTFUL_API_TOKEN + PRINTFUL_STORE_ID are set (the UK
 * primary), else Printify when PRINTIFY_API_TOKEN + PRINTIFY_SHOP_ID are set,
 * else the demo provider. Never both: one shop, one fulfilment partner.
 */
export function getPod(): PodProvider {
  const env = getEnv();
  if (hasPrintful(env) && env.printfulApiToken && env.printfulStoreId) {
    if (cached?.name !== "printful") {
      cached = createPrintfulProvider({
        token: env.printfulApiToken,
        storeId: env.printfulStoreId,
        webhookSecret: env.printfulWebhookSecret,
        confirm: env.printfulConfirm,
      });
    }
    return cached;
  }
  if (hasPrintify(env) && env.printifyApiToken && env.printifyShopId) {
    if (cached?.name !== "printify") {
      cached = createPrintifyProvider({
        token: env.printifyApiToken,
        shopId: env.printifyShopId,
        webhookSecret: env.printifyWebhookSecret,
        sendToProduction: env.printifySendToProduction,
      });
    }
    return cached;
  }
  return demoPod;
}

export { PRINTFUL_SECRET_HEADER } from "./printful";
export * from "./types";
