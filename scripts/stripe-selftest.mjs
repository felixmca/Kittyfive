#!/usr/bin/env node
/**
 * stripe-selftest.mjs — prove the Stripe TEST key works and that Kitty's
 * checkout parameters create a valid test-mode Checkout Session.
 *
 * No money is ever charged: creating a Checkout Session reserves nothing, and
 * a test-mode key touches no real balance. The script REFUSES to run on a live
 * (sk_live_) key. It mirrors the exact session params in
 * src/lib/commerce/stripe.ts (createMerchCheckout / createSnackCheckout) so a
 * PASS here means the real route will build the same session once isLive() is
 * satisfied (Stripe webhook secret + Supabase service-role key present).
 *
 * Usage (from the project root):  node scripts/stripe-selftest.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Stripe from "stripe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Minimal .env.local loader (same approach as pod-ids.mjs; no dotenv dependency).
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
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadEnvLocal();

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("No STRIPE_SECRET_KEY found in .env.local");
  process.exit(1);
}
if (!key.startsWith("sk_test_")) {
  console.error(`REFUSING: STRIPE_SECRET_KEY starts "${key.slice(0, 8)}" — this self-test only runs on a TEST key.`);
  process.exit(1);
}

const stripe = new Stripe(key, { appInfo: { name: "Kitty selftest" } });

// Mirror of src/config/products.ts values used below.
const SHIPPING_UK_PENCE = 399;
const HOODIE = {
  name: "Kitty Hoodie",
  label: "Black / M",
  pricePence: 5500,
  description: "Heavyweight brushed-cotton hoodie, small embroidered Kitty on the left chest.",
  productId: "hoodie",
  variantId: "hoodie-black-m",
};
const SNACK = { pricePence: 100, label: "Give Kitty a snack" };
const origin = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3200";

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ASSERT FAILED: " + msg);
    failed = true;
  }
}

async function main() {
  // 1) Key validity + which account it belongs to, and confirm test mode.
  const balance = await stripe.balance.retrieve();
  const acct = await stripe.accounts.retrieve().catch(() => null);
  console.log("=== Stripe key check ===");
  console.log("  balance.livemode:", balance.livemode);
  if (acct) {
    console.log("  account:", acct.id, "|", acct.settings?.dashboard?.display_name ?? "(no name)", "|", acct.country ?? "");
  }
  assert(balance.livemode === false, "balance.livemode must be false (test mode)");

  // 2) Merch checkout session — identical params to createMerchCheckout().
  const merch = await stripe.checkout.sessions.create({
    mode: "payment",
    submit_type: "pay",
    locale: "en-GB",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: HOODIE.pricePence,
          product_data: {
            name: `${HOODIE.name} · ${HOODIE.label}`,
            description: HOODIE.description,
            metadata: { productId: HOODIE.productId, variantId: HOODIE.variantId },
          },
        },
      },
    ],
    // Managed Payments is enabled by default on this sandbox account and is
    // incompatible with shipping collection; opt out per-request so Kitty can
    // still collect the shipping address it needs for POD fulfilment.
    managed_payments: { enabled: false },
    shipping_address_collection: { allowed_countries: ["GB"] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: SHIPPING_UK_PENCE, currency: "gbp" },
          display_name: "UK tracked",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 3 },
            maximum: { unit: "business_day", value: 7 },
          },
        },
      },
    ],
    phone_number_collection: { enabled: true },
    billing_address_collection: "auto",
    client_reference_id: HOODIE.variantId,
    metadata: { kind: "merch", productId: HOODIE.productId, variantId: HOODIE.variantId, quantity: "1" },
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/store?cancelled=1`,
  });
  console.log("\n=== Merch checkout session (hoodie) ===");
  console.log("  id:", merch.id);
  console.log("  livemode:", merch.livemode);
  console.log("  amount_total:", merch.amount_total, merch.currency, "(5500 hoodie + 399 shipping = 5899)");
  console.log("  url:", merch.url);
  assert(merch.id.startsWith("cs_test_"), "merch session id must start cs_test_");
  assert(merch.livemode === false, "merch session livemode must be false");
  assert(merch.amount_total === 5899, "merch amount_total must be 5899");
  assert(typeof merch.url === "string" && merch.url.length > 0, "merch session must return a hosted Checkout url");

  // 3) Snack checkout session — identical params to createSnackCheckout().
  const snack = await stripe.checkout.sessions.create({
    mode: "payment",
    submit_type: "pay",
    locale: "en-GB",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: SNACK.pricePence,
          product_data: {
            name: SNACK.label,
            description: "A real snack for a real cat. She approves.",
            metadata: { kind: "snack" },
          },
        },
      },
    ],
    // Managed Payments is on by default on this account; opt out per-session so
    // no product tax code is demanded and Kitty stays merchant of record (lower fees).
    managed_payments: { enabled: false },
    metadata: { kind: "snack" },
    success_url: `${origin}/store?snack=thanks`,
    cancel_url: `${origin}/store`,
  });
  console.log("\n=== Snack checkout session ===");
  console.log("  id:", snack.id, "| amount_total:", snack.amount_total, snack.currency);
  assert(snack.id.startsWith("cs_test_"), "snack session id must start cs_test_");

  console.log("\nRESULT:", failed ? "FAIL" : "PASS — test key valid, both sessions created in TEST mode, no charge.");
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nStripe self-test failed:", e.message);
  process.exit(1);
});
