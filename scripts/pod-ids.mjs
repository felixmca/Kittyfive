#!/usr/bin/env node
/**
 * pod-ids.mjs — fetch your print-on-demand product + variant ids, and (with
 * --write) record them in src/config/pod-ids.json so fulfilment can use them.
 *
 * A paid order is only sent to the provider when every variant on it has store
 * ids: podProductId / podVariantId written by hand in src/config/products.ts,
 * or the generated src/config/pod-ids.json (see src/config/pod-ids.ts). Until
 * then the order is recorded and left at status "paid" for you to fulfil by
 * hand (src/lib/commerce/fulfilment.ts), or — Printful only — ordered straight
 * from the catalog blueprint in src/config/printful.ts.
 *
 * This script reads your provider token from the environment (or from .env.local
 * next to it, no dependencies), calls the provider's REST API, and prints every
 * product and every variant with the exact ids Kitty needs. Without --write it
 * never writes anything.
 *
 * Usage (from the project root; the vars can live in .env.local):
 *   # Printful (UK primary): the sync products `node scripts/printful.mjs
 *   # products sync` creates carry our variant ids as external_id, so --write
 *   # matches by external_id on its own.
 *   PRINTFUL_API_TOKEN=... PRINTFUL_STORE_ID=... node scripts/pod-ids.mjs [--write]
 *
 *   # Printify: variant titles never match our labels reliably, so --write
 *   # needs the pairing spelled out (our variant id = Printify variant id).
 *   PRINTIFY_API_TOKEN=... [PRINTIFY_SHOP_ID=...] node scripts/pod-ids.mjs \
 *     --write --map=cap-black=12345,cap-stone=12346,hoodie-black-s=...
 *
 *   --map also works for Printful, for products made by hand in the dashboard
 *   whose sync variants have no external_id.
 *
 * --write produces { provider, storeId, generatedAt, variants: { "<our id>":
 * { productId, variantId } } }; a mapping is only used by the app when its
 * provider and store id match the configured ones.
 *
 * Requires Node 24 (global fetch; native TypeScript import of src/config/products.ts).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const POD_IDS_PATH = join(ROOT, "src", "config", "pod-ids.json");

// ── Minimal .env.local loader (no dependency on dotenv) ──────────────────────
// Only fills vars that aren't already set in the real environment.
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue; // matches how the app's own dotenv skips non-KEY=VALUE lines
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  }
}

function parseArgs(argv) {
  const flags = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    flags[eq === -1 ? arg.slice(2) : arg.slice(2, eq)] = eq === -1 ? true : arg.slice(eq + 1);
  }
  return flags;
}

/** --map=our-id=providerVariantId,... → Map(our id → provider variant id). */
function parseMap(text) {
  const map = new Map();
  for (const pair of String(text).split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.lastIndexOf("=");
    const ours = eq === -1 ? "" : trimmed.slice(0, eq).trim();
    const theirs = eq === -1 ? NaN : Number.parseInt(trimmed.slice(eq + 1).trim(), 10);
    if (!ours || !Number.isInteger(theirs)) {
      throw new Error(`--map entry "${trimmed}" is not <our-variant-id>=<provider variant id>`);
    }
    map.set(ours, theirs);
  }
  if (!map.size) throw new Error("--map is empty");
  return map;
}

// Our variant ids, from src/config/products.ts. Node 24 strips the types
// natively; the MODULE_TYPELESS_PACKAGE_JSON warning (package.json has no
// "type") is filtered while it loads.
async function ourVariantIds() {
  const original = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const text = [warning, ...rest]
      .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? `${v.code ?? ""} ${v.message ?? ""}` : ""))
      .join(" ");
    if (/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module/.test(text)) return undefined;
    return original.call(process, warning, ...rest);
  };
  try {
    const { PRODUCTS } = await import(pathToFileURL(join(ROOT, "src", "config", "products.ts")).href);
    return new Set(PRODUCTS.flatMap((p) => p.variants.map((v) => v.id)));
  } finally {
    process.emitWarning = original;
  }
}

const TIMEOUT_MS = 20_000;

async function api(url, headers) {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Kitty/1.0 (pod-ids)", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
}

// ── Printful (API v1) ────────────────────────────────────────────────────────
// podProductId = sync product id (string); podVariantId = sync variant id (number).
// Returns [{ id, name, variants: [{ id, name, externalId }] }].
async function printful(token, storeId) {
  const base = (process.env.PRINTFUL_API_URL || "https://api.printful.com").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}`, "X-PF-Store-Id": storeId };
  console.log(`\n=== Printful store ${storeId} ===\n`);

  const list = await api(`${base}/store/products`, headers);
  const products = list.result ?? [];
  if (!products.length) {
    console.log("No products in this Printful store yet. Run `node scripts/printful.mjs products sync`");
    console.log("(or create the cap, hoodie and long-sleeve in the Printful dashboard), then re-run this.");
    return [];
  }

  const out = [];
  for (const p of products) {
    const detail = await api(`${base}/store/products/${p.id}`, headers);
    const variants = detail.result?.sync_variants ?? [];
    console.log(`PRODUCT  "${p.name}"`);
    console.log(`  podProductId: "${p.id}"   (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
    for (const v of variants) {
      console.log(`    podVariantId: ${v.id}   ${v.name}${v.external_id ? `   external_id ${v.external_id}` : ""}`);
    }
    console.log("");
    out.push({ id: String(p.id), name: p.name, variants: variants.map((v) => ({ id: v.id, name: v.name, externalId: v.external_id ?? null })) });
  }
  printfulHint();
  return out;
}

function printfulHint() {
  console.log("── How to use these ──────────────────────────────────────────────");
  console.log("Easiest: `node scripts/pod-ids.mjs --write` records them in src/config/pod-ids.json");
  console.log("(matching each sync variant's external_id to our variant id). Or, by hand, add");
  console.log("podProductId + podVariantId to each variant in src/config/products.ts:");
  console.log("");
  console.log('  { id: "hoodie-black-m", label: "Black / M", colour: "#111111", size: "M",');
  console.log('    podProductId: "<the product id above>", podVariantId: <the variant id> },');
  console.log("");
  console.log("Also set PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID in Vercel (and .env.local");
  console.log("for local live tests).");
}

// ── Printify (API v1) ─────────────────────────────────────────────────────────
// podProductId = product id (string); podVariantId = variant id (number).
// Returns { shopId, products: [{ id, name, variants: [{ id, name }] }] }.
async function printify(token, shopIdMaybe) {
  const base = (process.env.PRINTIFY_API_URL || "https://api.printify.com").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}` };

  let shopId = shopIdMaybe;
  if (!shopId) {
    const shops = await api(`${base}/v1/shops.json`, headers);
    if (!Array.isArray(shops) || !shops.length) {
      console.log("No Printify shops found for this token. Connect a sales channel in Printify first.");
      return { shopId: null, products: [] };
    }
    console.log(`\n=== Printify shops on this token ===`);
    for (const s of shops) console.log(`  shop id ${s.id}  —  "${s.title}" (${s.sales_channel})`);
    shopId = String(shops[0].id);
    console.log(`\nUsing shop ${shopId}. (Set PRINTIFY_SHOP_ID to pick a different one.)`);
  }

  console.log(`\n=== Printify shop ${shopId} products ===\n`);
  const page = await api(`${base}/v1/shops/${shopId}/products.json`, headers);
  const products = page.data ?? [];
  if (!products.length) {
    console.log("No products in this Printify shop yet. Create your cap, hoodie and");
    console.log("long-sleeve in Printify first, then re-run this.");
    return { shopId: String(shopId), products: [] };
  }

  const out = [];
  for (const p of products) {
    const variants = p.variants ?? [];
    console.log(`PRODUCT  "${p.title}"`);
    console.log(`  podProductId: "${p.id}"   (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
    for (const v of variants) {
      const enabled = v.is_enabled === false ? " [disabled]" : "";
      console.log(`    podVariantId: ${v.id}   ${v.title}${enabled}`);
    }
    console.log("");
    out.push({ id: String(p.id), name: p.title, variants: variants.map((v) => ({ id: v.id, name: v.title })) });
  }
  console.log(`\nAlso set: PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID=${shopId} in Vercel + .env.local.`);
  console.log("To record the ids: node scripts/pod-ids.mjs --write --map=<our-variant-id>=<podVariantId>,...");
  return { shopId: String(shopId), products: out };
}

// ── --write: src/config/pod-ids.json ──────────────────────────────────────────
async function writePodIds({ provider, storeId, products, map }) {
  const ours = await ourVariantIds();
  const byVariantId = new Map();
  for (const p of products) for (const v of p.variants) byVariantId.set(v.id, { productId: p.id, variant: v });
  const variants = {};

  if (map) {
    for (const [ourId, theirId] of map) {
      if (!ours.has(ourId)) throw new Error(`--map: "${ourId}" is not a variant id in src/config/products.ts`);
      const hit = byVariantId.get(theirId);
      if (!hit) throw new Error(`--map: ${provider} variant ${theirId} (for ${ourId}) is not in any product of ${provider === "printful" ? "store" : "shop"} ${storeId}`);
      variants[ourId] = { productId: hit.productId, variantId: theirId };
    }
  } else if (provider === "printful") {
    for (const p of products) {
      for (const v of p.variants) {
        if (v.externalId && ours.has(v.externalId)) variants[v.externalId] = { productId: p.id, variantId: v.id };
      }
    }
    if (!Object.keys(variants).length) {
      throw new Error(
        "no sync variant has an external_id equal to one of our variant ids. `node scripts/printful.mjs products sync` creates them that way; for products made by hand pass --map=<our-variant-id>=<podVariantId>,...",
      );
    }
  } else {
    throw new Error(
      "Printify variant titles cannot be matched to our labels reliably: pass --map=<our-variant-id>=<podVariantId>,... (one pair per variant, from the list above)",
    );
  }

  const file = { provider, storeId: String(storeId), generatedAt: new Date().toISOString(), variants };
  writeFileSync(POD_IDS_PATH, JSON.stringify(file, null, 2) + "\n");
  const covered = Object.keys(variants);
  const missing = [...ours].filter((id) => !variants[id]);
  console.log(`\nWrote ${POD_IDS_PATH}: provider ${provider}, store ${storeId}, ${covered.length} variant${covered.length === 1 ? "" : "s"}.`);
  if (missing.length) console.log(`Not covered (fulfilled by hand or, on Printful, from the catalog blueprint): ${missing.join(", ")}`);
  console.log("Commit it; the app uses it when PRINTFUL_STORE_ID / PRINTIFY_SHOP_ID matches its storeId.");
}

// ── Pick a provider and go ─────────────────────────────────────────────────────
async function main() {
  loadEnvLocal();
  const flags = parseArgs(process.argv.slice(2));
  const write = Boolean(flags.write);
  const map = typeof flags.map === "string" ? parseMap(flags.map) : flags.map === true ? parseMap("") : null;

  const pfToken = process.env.PRINTFUL_API_TOKEN;
  const pfStore = process.env.PRINTFUL_STORE_ID;
  const pyToken = process.env.PRINTIFY_API_TOKEN;
  const pyShop = process.env.PRINTIFY_SHOP_ID;

  if (pfToken && pfStore) {
    const products = await printful(pfToken, pfStore);
    if (write) await writePodIds({ provider: "printful", storeId: pfStore, products, map });
  } else if (pyToken) {
    const { shopId, products } = await printify(pyToken, pyShop);
    if (write) {
      if (!shopId) throw new Error("no Printify shop to write ids for");
      await writePodIds({ provider: "printify", storeId: shopId, products, map });
    }
  } else if (pfToken) {
    console.log("PRINTFUL_API_TOKEN is set but PRINTFUL_STORE_ID is empty — no store id yet: in Printful go to");
    console.log("Stores → Connect via API (a 'Manual order / API' store), then put its id in .env.local and");
    console.log("Vercel as PRINTFUL_STORE_ID. `node scripts/printful.mjs status` shows the stores on the token.");
    process.exitCode = 1;
  } else {
    console.log("No provider configured. Set one of these (in the shell or in .env.local):");
    console.log("");
    console.log("  Printful (UK primary):  PRINTFUL_API_TOKEN + PRINTFUL_STORE_ID");
    console.log("  Printify:               PRINTIFY_API_TOKEN  (PRINTIFY_SHOP_ID optional)");
    console.log("");
    console.log("Get a Printful token: Dashboard → Settings → API → Add token (store-scoped).");
    console.log("Get a Printify token: Account → Connections → Personal access tokens.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  console.error("Check the token is valid and has API access to the store/shop.");
  process.exitCode = 1;
});
