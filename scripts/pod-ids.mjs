#!/usr/bin/env node
/**
 * pod-ids.mjs — fetch your print-on-demand product + variant ids so you can fill
 * in src/config/products.ts.
 *
 * The ONE thing standing between Kitty and live fulfilment is the podProductId /
 * podVariantId fields in src/config/products.ts. Until a variant has both, a paid
 * order for it is recorded and left at status "paid" for you to fulfil by hand —
 * nothing is ever sent to the provider (see src/lib/commerce/stripe.ts:fulfil()).
 *
 * This script reads your provider token from the environment (or from .env.local
 * next to it, no dependencies), calls the provider's REST API, and prints every
 * product and every variant with the exact ids Kitty needs — plus a ready-to-edit
 * products.ts snippet. It never writes anything; it only reads and prints.
 *
 * Usage (from the project root):
 *   # Printful (UK primary):
 *   PRINTFUL_API_TOKEN=... PRINTFUL_STORE_ID=... node scripts/pod-ids.mjs
 *
 *   # Printify:
 *   PRINTIFY_API_TOKEN=... [PRINTIFY_SHOP_ID=...] node scripts/pod-ids.mjs
 *
 * Or just put those vars in .env.local (which you already have) and run:
 *   node scripts/pod-ids.mjs
 *
 * Requires Node 18+ (uses the global fetch). Kitty runs Node 20+, so you're fine.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

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
async function printful(token, storeId) {
  const headers = { Authorization: `Bearer ${token}`, "X-PF-Store-Id": storeId };
  console.log(`\n=== Printful store ${storeId} ===\n`);

  const list = await api("https://api.printful.com/store/products", headers);
  const products = list.result ?? [];
  if (!products.length) {
    console.log("No products in this Printful store yet. Create your cap, hoodie and");
    console.log("long-sleeve in the Printful dashboard first, then re-run this.");
    return;
  }

  for (const p of products) {
    const detail = await api(`https://api.printful.com/store/products/${p.id}`, headers);
    const variants = detail.result?.sync_variants ?? [];
    console.log(`PRODUCT  "${p.name}"`);
    console.log(`  podProductId: "${p.id}"   (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
    for (const v of variants) {
      console.log(`    podVariantId: ${v.id}   ${v.name}`);
    }
    console.log("");
  }
  printfulHint();
}

function printfulHint() {
  console.log("── How to use these ──────────────────────────────────────────────");
  console.log("In src/config/products.ts, add podProductId + podVariantId to each");
  console.log("variant, matching Kitty's variant to the Printful variant by size/colour:");
  console.log("");
  console.log('  { id: "hoodie-black-m", label: "Black / M", colour: "#111111", size: "M",');
  console.log('    podProductId: "<the product id above>", podVariantId: <the variant id> },');
  console.log("");
  console.log("Also set PRINTFUL_API_TOKEN and PRINTFUL_STORE_ID in Vercel (and .env.local");
  console.log("for local live tests). A variant missing either id is fulfilled by hand.");
}

// ── Printify (API v1) ─────────────────────────────────────────────────────────
// podProductId = product id (string); podVariantId = variant id (number).
async function printify(token, shopIdMaybe) {
  const headers = { Authorization: `Bearer ${token}` };

  let shopId = shopIdMaybe;
  if (!shopId) {
    const shops = await api("https://api.printify.com/v1/shops.json", headers);
    if (!Array.isArray(shops) || !shops.length) {
      console.log("No Printify shops found for this token. Connect a sales channel in Printify first.");
      return;
    }
    console.log(`\n=== Printify shops on this token ===`);
    for (const s of shops) console.log(`  shop id ${s.id}  —  "${s.title}" (${s.sales_channel})`);
    shopId = String(shops[0].id);
    console.log(`\nUsing shop ${shopId}. (Set PRINTIFY_SHOP_ID to pick a different one.)`);
  }

  console.log(`\n=== Printify shop ${shopId} products ===\n`);
  const page = await api(`https://api.printify.com/v1/shops/${shopId}/products.json`, headers);
  const products = page.data ?? [];
  if (!products.length) {
    console.log("No products in this Printify shop yet. Create your cap, hoodie and");
    console.log("long-sleeve in Printify first, then re-run this.");
    return;
  }

  for (const p of products) {
    const variants = p.variants ?? [];
    console.log(`PRODUCT  "${p.title}"`);
    console.log(`  podProductId: "${p.id}"   (${variants.length} variant${variants.length === 1 ? "" : "s"})`);
    for (const v of variants) {
      const enabled = v.is_enabled === false ? " [disabled]" : "";
      console.log(`    podVariantId: ${v.id}   ${v.title}${enabled}`);
    }
    console.log("");
  }
  console.log(`\nAlso set: PRINTIFY_API_TOKEN, PRINTIFY_SHOP_ID=${shopId} in Vercel + .env.local.`);
  console.log("A variant missing podProductId or podVariantId is fulfilled by hand.");
}

// ── Pick a provider and go ─────────────────────────────────────────────────────
async function main() {
  loadEnvLocal();

  const pfToken = process.env.PRINTFUL_API_TOKEN;
  const pfStore = process.env.PRINTFUL_STORE_ID;
  const pyToken = process.env.PRINTIFY_API_TOKEN;
  const pyShop = process.env.PRINTIFY_SHOP_ID;

  if (pfToken && pfStore) {
    await printful(pfToken, pfStore);
  } else if (pyToken) {
    await printify(pyToken, pyShop);
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
