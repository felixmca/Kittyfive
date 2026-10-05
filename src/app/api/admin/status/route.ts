/**
 * GET /api/admin/status: which services this deployment has keys for, and
 * how far the print-on-demand wiring has got (which provider, how many of
 * the store's variants the maker can make). Admins only (bearer token →
 * is_admin()). Returns presence booleans and counts, never values.
 */
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/config";
import { podIds } from "@/config/pod-ids";
import { printfulCatalogVariant } from "@/config/printful";
import { PRODUCTS } from "@/config/products";
import { getEnv, harnessOverridesPresent, hasPrintful, hasPrintify } from "@/lib/commerce/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const has = (name: string) => Boolean(process.env[name]?.trim());

export async function GET(req: Request): Promise<Response> {
  const token = bearerToken(req);
  const caller = token ? await serverSupabaseAs(token) : null;
  if (!caller) return Response.json({ error: "Sign in first." }, { status: 401 });
  const { data: isAdmin, error } = await caller.sb.rpc("is_admin");
  if (error || isAdmin !== true) return Response.json({ error: "Admins only." }, { status: 403 });

  const env = getEnv();
  const printful = hasPrintful(env);
  const printify = hasPrintify(env);
  const provider: "printful" | "printify" | null = printful ? "printful" : printify ? "printify" : null;
  // Store ids count for the configured provider and store. Before a provider
  // is configured, Printful (the UK primary) is assumed, so ids generated
  // ahead of PRINTFUL_STORE_ID landing already show up.
  const idCtx = {
    provider: provider ?? "printful",
    storeId: provider === "printify" ? env.printifyShopId ?? null : env.printfulStoreId ?? null,
  };
  const variants = PRODUCTS.flatMap((p) => p.variants);
  const storeMapped = variants.filter(
    (v) => (v.podProductId && typeof v.podVariantId === "number") || podIds(v.id, idCtx) !== null,
  ).length;
  const catalogMapped = variants.filter((v) => printfulCatalogVariant(v.id) !== undefined).length;

  return Response.json(
    {
      supabase: supabaseConfigured,
      anthropic: has("ANTHROPIC_API_KEY"),
      stripe: has("STRIPE_SECRET_KEY") && has("STRIPE_WEBHOOK_SECRET"),
      printful,
      printfulToken: Boolean(env.printfulApiToken),
      printfulStore: Boolean(env.printfulStoreId),
      printify,
      resend: has("RESEND_API_KEY"),
      siteUrl: env.siteUrl ?? null,
      region: process.env.VERCEL_REGION ?? null,
      /** Harness base-URL / POD_IDS_JSON overrides present in this deployment's env (should be none). */
      overrides: harnessOverridesPresent(),
      pod: {
        provider,
        variants: variants.length,
        storeMapped,
        catalogMapped,
        siteUrlHttps: Boolean(env.siteUrl && /^https:\/\//i.test(env.siteUrl)),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
