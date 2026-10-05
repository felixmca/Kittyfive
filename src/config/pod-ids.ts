/**
 * Store-side print-on-demand ids, GENERATED: `node scripts/printful.mjs
 * products sync` (or `node scripts/pod-ids.mjs --write` for Printify) writes
 * src/config/pod-ids.json after creating the products in the provider's store.
 * Hand-written ids in src/config/products.ts (podProductId/podVariantId) win
 * over this file.
 *
 * The ids only mean something inside the store they came from, so a mapping
 * is used only when its provider AND store id match the configured ones;
 * otherwise mapItemsToPod() falls back to the Printful catalog blueprint
 * (src/config/printful.ts) or reports the variant as unmapped.
 *
 * POD_IDS_JSON (an env var holding the same JSON) overrides the file; the
 * verify harness uses it to exercise the store-id path without a real store.
 * It is ignored on Vercel: the committed file is the only source there.
 */
import generated from "./pod-ids.json";

export interface PodIdMapping {
  /** Provider product id (Printful sync product id, Printify product id), as a string. */
  productId: string;
  /** Provider variant id (Printful sync variant id, Printify variant id). */
  variantId: number;
}

export interface PodIdsFile {
  provider: "printful" | "printify" | null;
  storeId: string | null;
  generatedAt: string | null;
  variants: Record<string, PodIdMapping>;
}

const EMPTY: PodIdsFile = { provider: null, storeId: null, generatedAt: null, variants: {} };

function sanitise(value: unknown): PodIdsFile {
  if (!value || typeof value !== "object") return EMPTY;
  const v = value as Record<string, unknown>;
  const provider = v.provider === "printful" || v.provider === "printify" ? v.provider : null;
  const storeId = typeof v.storeId === "string" || typeof v.storeId === "number" ? String(v.storeId) : null;
  const generatedAt = typeof v.generatedAt === "string" ? v.generatedAt : null;
  const variants: Record<string, PodIdMapping> = {};
  const raw = v.variants && typeof v.variants === "object" ? (v.variants as Record<string, unknown>) : {};
  for (const [id, m] of Object.entries(raw)) {
    if (!m || typeof m !== "object") continue;
    const mm = m as Record<string, unknown>;
    const productId = typeof mm.productId === "string" || typeof mm.productId === "number" ? String(mm.productId) : null;
    const variantId = typeof mm.variantId === "number" ? mm.variantId : Number.parseInt(String(mm.variantId ?? ""), 10);
    if (productId && Number.isInteger(variantId)) variants[id] = { productId, variantId };
  }
  return { provider, storeId, generatedAt, variants };
}

let cached: { source: string; file: PodIdsFile } | null = null;

/** The generated ids (env override first, then the committed JSON). */
export function podIdsFile(): PodIdsFile {
  const override = process.env.VERCEL ? undefined : process.env.POD_IDS_JSON?.trim();
  const source = override ? `env:${override}` : "file";
  if (cached && cached.source === source) return cached.file;
  let file: PodIdsFile;
  if (override) {
    try {
      file = sanitise(JSON.parse(override));
    } catch {
      console.error("[pod-ids] POD_IDS_JSON is not valid JSON; ignoring it");
      file = sanitise(generated);
    }
  } else {
    file = sanitise(generated);
  }
  cached = { source, file };
  return file;
}

/**
 * The store ids for one of our variants, if the generated file was produced
 * for the given provider and store. `storeId` undefined means "do not check"
 * (Printify's shop id is also a store id and is checked the same way).
 */
export function podIds(variantId: string, ctx: { provider: string; storeId?: string | null }): PodIdMapping | null {
  const file = podIdsFile();
  if (file.provider !== ctx.provider) return null;
  if (ctx.storeId && file.storeId && file.storeId !== String(ctx.storeId)) return null;
  return file.variants[variantId] ?? null;
}
