#!/usr/bin/env node
// ─── COMMERCE VERIFICATION HARNESS ───────────────────────────────────────────
//
//   npm run verify:commerce              # builds if .next is missing or stale
//   npm run verify:commerce -- --build   # force a fresh production build
//   npm run verify:commerce -- --no-build
//   npm run verify:commerce -- --only=printful | --only=printify | --only=overrides
//
// Proves the whole money path end to end WITHOUT a real key: a mock Stripe, a
// mock Supabase PostgREST, a mock Printful and a mock Printify
// (scripts/commerce-mocks.mjs) on localhost, driving the REAL production
// build of the site (`next start`) with every commerce env var set explicitly
// to a mock value, so nothing in .env.local can leak into the run.
//
// What it exercises, in order:
//   printful run (the UK primary, PRINTFUL_CONFIRM=1):
//     checkout → Stripe session params (success_url back to this localhost
//     even with NEXT_PUBLIC_SITE_URL set to the live site; print-file URLs on
//     the live site) → hosted Checkout "pays" → signed
//     checkout.session.completed → order rows + events → the fulfilment claim
//     (conditional PATCH on pod_provider) → Printful draft + confirm (catalog
//     item with print files, then a store-id item) → unsigned / wrong-secret /
//     duplicate delivery → provider 500 (pod_failed, claim released) → 429 +
//     retry → 500 after the provider stored the order (recovered by
//     @external_id and confirmed) → confirm fails (submitted, draft flagged
//     by pod_draft_unconfirmed) → the final processed_at update fails once and
//     a redelivery resumes the order without a second Printful order →
//     quantity 2 → a realistic 66-char Stripe id (external_id = order uuid) →
//     a one-word customer name → Printful webhooks (secret, store id,
//     package_shipped, no status regression, a javascript: tracking URL
//     dropped, order_updated "fulfilled" first then package_shipped with one
//     shipped email) → the success page → the harness URL overrides were
//     honoured (they point at 127.0.0.1; nothing logged as ignored).
//   printify run (the fallback): mapping, unmapped variant, HMAC webhook,
//     recovery through GET orders.json after a 500 that stored the order.
//   overrides run (demo mode, production build): STRIPE_API_BASE /
//     PRINTFUL_API_URL / PRINTIFY_API_URL pointing at a non-local host are
//     ignored and logged; the self-check names them.
//   NOT covered: the admin routes (/api/admin/orders, /api/admin/status, the
//     Orders card's fulfil / confirm / refresh actions) — they need a signed-in
//     admin, which the mocks do not provide; and email delivery (no Resend).
//
// Results print as a table and land in .verify/commerce-results.json; the
// site's stdout/stderr for each run is in .verify/commerce-site-<run>.log.
// Exit 1 on any failure. The app is never edited from here: a failing check
// is a report of what the real build did.

import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { startMocks } from "./commerce-mocks.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, ".verify");
mkdirSync(OUT, { recursive: true });

// Node warns that src/config/*.ts has no "type": "module" package.json when
// imported directly (the other scripts do the same). Keep every other warning.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code === "MODULE_TYPELESS_PACKAGE_JSON") return;
  console.warn(w.stack ?? w.message);
});

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "1"] : [a, "1"];
  }),
);

// ─── fixed values the mocks and the site agree on ────────────────────────────

const STRIPE_KEY = "sk_test_mockkey";
const STRIPE_WEBHOOK_SECRET = "whsec_mock";
const SUPABASE_KEY = "mock-service-role";
const PF = { token: "mock-token", storeId: "1001", secret: "pf-secret" };
const PY = { token: "mock", shopId: "777", secret: "py-secret" };
const SITE_URL = "https://kittyfive.vercel.app";
const PORTS = { stripe: 3291, supabase: 3292, printful: 3293, printify: 3294, printfulSite: 3202, printifySite: 3203, overridesSite: 3204 };
const BUYER = {
  email: "buyer@example.com",
  name: "Test Buyer",
  phone: "+44 7700 900123",
  address: { line1: "1 Pacific Wharf", line2: null, city: "London", state: null, postal_code: "SE16 7AL", country: "GB" },
};
const POD_IDS_PRINTFUL = {
  provider: "printful",
  storeId: PF.storeId,
  generatedAt: "test",
  variants: { "cap-black": { productId: "501", variantId: 90001 } },
};
const POD_IDS_PRINTIFY = {
  provider: "printify",
  storeId: PY.shopId,
  generatedAt: "test",
  variants: { "hoodie-black-m": { productId: "p1", variantId: 4321 } },
};

const stripe = new Stripe(STRIPE_KEY);
const { printfulCatalogVariant } = await import(pathToFileURL(join(root, "src", "config", "printful.ts")).href);
const { findVariant, SHIPPING } = await import(pathToFileURL(join(root, "src", "config", "products.ts")).href);

// ─── results ─────────────────────────────────────────────────────────────────

const results = [];
function record(run, route, check, ok, detail = "") {
  results.push({ run, route, check, ok: Boolean(ok), detail: String(detail) });
  const mark = ok ? "ok " : "FAIL";
  console.log(`  [${mark}] ${run} ${route} — ${check}${detail ? `: ${detail}` : ""}`);
  return Boolean(ok);
}

const short = (value, n = 220) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text && text.length > n ? `${text.slice(0, n)}…` : text ?? "";
};

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15_000, interval = 150 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(interval);
  }
}

async function http(method, url, { headers = {}, body, json } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(30_000) };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers["content-type"] = "application/json";
  } else if (body !== undefined) {
    init.body = body;
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  return { status: res.status, text, data, headers: res.headers };
}

// ─── the production build ────────────────────────────────────────────────────

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    const t = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

/** Why a build is needed, or false. The site under test must be THIS source, not last week's. */
function buildReason() {
  if (args["no-build"]) return false;
  if (args.build) return "--build";
  const idPath = join(root, ".next", "BUILD_ID");
  if (!existsSync(idPath)) return "no .next/BUILD_ID";
  const built = statSync(idPath).mtimeMs;
  const inputs = [join(root, "src"), join(root, "next.config.ts"), join(root, "package.json")];
  for (const input of inputs) {
    if (!existsSync(input)) continue;
    const t = statSync(input).isDirectory() ? newestMtime(input) : statSync(input).mtimeMs;
    if (t > built) return `${relative(root, input)} is newer than .next/BUILD_ID`;
  }
  return false;
}

function runBuild() {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(join(OUT, "commerce-build.log"));
    // Run npm's own entry point under this node: no shell, and no .cmd
    // (which Node refuses to spawn directly on Windows). Under `npm run`
    // npm_execpath names it; otherwise it sits next to the node binary.
    const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")].find(
      (p) => p && existsSync(p),
    );
    const child = npmCli
      ? spawn(process.execPath, [npmCli, "run", "build"], { cwd: root, windowsHide: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] })
      : spawn("npm run build", { cwd: root, shell: true, windowsHide: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    const tee = (stream) =>
      stream.on("data", (chunk) => {
        log.write(chunk);
        process.stdout.write(chunk);
      });
    tee(child.stdout);
    tee(child.stderr);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("npm run build took longer than 20 minutes"));
    }, 20 * 60_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      log.end();
      if (code === 0) resolve();
      else reject(new Error(`npm run build exited with ${code} (see .verify/commerce-build.log)`));
    });
  });
}

// ─── the site under test ─────────────────────────────────────────────────────

const children = new Set();

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    for (const c of children) killTree(c);
    process.exit(130);
  });
}
process.on("exit", () => {
  for (const c of children) killTree(c);
});

/** `next start` on `port` with EVERY commerce var set (Next also loads .env.local; the parent env wins). */
async function startSite(port, env, label) {
  const logPath = join(OUT, `commerce-site-${label}.log`);
  const log = createWriteStream(logPath);
  const tail = [];
  const lines = []; // everything the site printed, for assertions on its log
  const child = spawn(process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], {
    cwd: root,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const capture = (stream) =>
    stream.on("data", (chunk) => {
      log.write(chunk);
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        lines.push(line);
        tail.push(line);
        if (tail.length > 80) tail.shift();
      }
    });
  capture(child.stdout);
  capture(child.stderr);
  let exited = false;
  child.on("exit", () => {
    exited = true;
    children.delete(child);
    log.end();
  });

  const base = `http://127.0.0.1:${port}`;
  const ready = await waitFor(
    async () => {
      if (exited) return "exited";
      try {
        const res = await fetch(`${base}/`, { signal: AbortSignal.timeout(10_000) });
        return res.status < 500 ? "up" : null;
      } catch {
        return null;
      }
    },
    { timeout: 120_000, interval: 500 },
  );
  if (ready !== "up") {
    killTree(child);
    throw new Error(`site on ${port} did not come up (${ready ?? "timeout"}); last output:\n${tail.join("\n")}`);
  }
  return {
    base,
    port,
    label,
    logPath,
    tail: () => tail.slice(-40).join("\n"),
    /** The whole of the site's stdout + stderr so far. */
    output: () => lines.join("\n"),
    async stop() {
      killTree(child);
      await waitFor(() => exited, { timeout: 10_000, interval: 100 });
    },
  };
}

// ─── the shared buying flow ──────────────────────────────────────────────────

let eventCounter = 0;
function completedEvent(session) {
  eventCounter += 1;
  return {
    id: `evt_test_${eventCounter}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object: session },
  };
}

function signedWebhook(site, payload, secret = STRIPE_WEBHOOK_SECRET) {
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return http("POST", `${site.base}/api/webhooks/stripe`, {
    body: payload,
    headers: { "content-type": "application/json", "stripe-signature": signature },
  });
}

const sessionIdFromUrl = (url) => (typeof url === "string" ? url.split("/pay/")[1] ?? null : null);

const orderForSession = (mocks, sessionId) => mocks.state.tables.orders.find((o) => o.stripe_session_id === sessionId) ?? null;

/**
 * Buy one variant the way a customer does: /api/checkout, Hosted Checkout
 * "pays" (as `buyer`), Stripe delivers checkout.session.completed, the webhook
 * finishes its deferred work (processed_at set) or 15 s pass. `until(order)`
 * replaces the processed_at wait for scenarios where it must never be set.
 */
async function purchase(site, mocks, variantId, { quantity = 1, buyer = BUYER, until } = {}) {
  const checkout = await http("POST", `${site.base}/api/checkout`, { json: { variantId, quantity } });
  const sessionId = sessionIdFromUrl(checkout.data?.url);
  if (!sessionId || !mocks.state.stripe.sessions.has(sessionId)) {
    return { checkout, sessionId, session: null, payload: null, hook: null, order: null, processed: false, settled: false };
  }
  const session = mocks.markPaid(sessionId, buyer);
  const payload = JSON.stringify(completedEvent(session));
  const hook = await signedWebhook(site, payload);
  const settled = await waitFor(() => {
    const row = orderForSession(mocks, sessionId);
    return row && (until ? until(row) : Boolean(row.processed_at));
  });
  const order = orderForSession(mocks, sessionId);
  return { checkout, sessionId, session, payload, hook, order, processed: Boolean(order?.processed_at), settled: Boolean(settled) };
}

const eventsFor = (mocks, orderId) => mocks.state.tables.order_events.filter((e) => e.order_id === orderId);
const eventTypes = (mocks, orderId) => eventsFor(mocks, orderId).map((e) => e.type);
const eventOf = (mocks, orderId, type) => eventsFor(mocks, orderId).find((e) => e.type === type) ?? null;
const itemsFor = (mocks, orderId) => mocks.state.tables.order_items.filter((i) => i.order_id === orderId);
const orderRow = (mocks, orderId) => mocks.state.tables.orders.find((o) => o.id === orderId) ?? null;

/** The PATCH /rest/v1/orders rows the PostgREST mock saw for one order, in order. */
const orderPatches = (mocks, orderId) =>
  mocks.requests.supabase.filter((r) => r.method === "PATCH" && r.path === "/rest/v1/orders" && r.query.id === `eq.${orderId}`);
/** fulfilment.ts claim(): pod_provider set only where nobody holds the order and no provider id exists; the matched rows come back. */
const claimPatch = (mocks, orderId, provider) =>
  orderPatches(mocks, orderId).find(
    (r) =>
      r.query.pod_order_id === "is.null" &&
      r.query.pod_provider === "is.null" &&
      r.query.select === "id" &&
      /return=representation/.test(r.headers.prefer ?? "") &&
      deepEqual(r.body, { pod_provider: provider }),
  ) ?? null;
/** fulfilment.ts release(): the claim undone after a provider failure, only while no provider id was recorded. */
const releasePatch = (mocks, orderId) =>
  orderPatches(mocks, orderId).find((r) => r.query.pod_order_id === "is.null" && !("pod_provider" in r.query) && deepEqual(r.body, { pod_provider: null })) ?? null;

/** Printful's external_id rule as the adapter applies it: the Stripe id when it fits 32 chars of [A-Za-z0-9_-], else the order uuid without dashes. */
const expectedExternalId = (sessionId, orderId) => (/^[A-Za-z0-9_-]{1,32}$/.test(sessionId) ? sessionId : orderId.replace(/-/g, ""));

/** The catalog item Printful should receive for one of our variants, straight from src/config/printful.ts. */
function expectedCatalogItem(variantId, quantity = 1) {
  const found = printfulCatalogVariant(variantId);
  if (!found) return null;
  const item = {
    variant_id: found.catalogVariantId,
    quantity,
    files: found.blueprint.placements.map((p) => ({ type: p.placement, url: new URL(p.file, SITE_URL).toString() })),
  };
  if (found.blueprint.options?.length) item.options = found.blueprint.options;
  return item;
}

const pfOrderPosts = (mocks) => mocks.requests.printful.filter((r) => r.method === "POST" && r.path === "/orders");
const pyOrderPosts = (mocks) => mocks.requests.printify.filter((r) => r.method === "POST" && /\/orders\.json$/.test(r.path));

// ─── run 1: Printful (the UK primary) ────────────────────────────────────────

async function printfulRun(mocks, site) {
  const R = "printful";
  const check = (route, name, ok, detail) => record(R, route, name, ok, detail);

  // 1. live mode, provider configured, no self-check in live mode
  const status = await http("GET", `${site.base}/api/commerce/status`);
  check("/api/commerce/status", "200 live, stripe+supabase+pod, no email", status.status === 200 && status.data?.mode === "live" && status.data.stripe === true && status.data.supabase === true && status.data.pod === true && status.data.email === false, short(status.data));
  check("/api/commerce/status", "no selfcheck in live mode", status.data && !("selfcheck" in status.data));

  // 2. the first purchase: a hoodie, mapped through the Printful catalog blueprint
  const hoodie = findVariant("hoodie-black-m");
  const first = await purchase(site, mocks, "hoodie-black-m");
  check("/api/checkout", "200 with the mock Checkout url", first.checkout.status === 200 && first.sessionId && first.checkout.data.url === `${mocks.urls.stripe}/pay/${first.sessionId}`, short(first.checkout.data));
  const stripeReq = mocks.requests.stripe.find((r) => r.method === "POST" && r.path === "/v1/checkout/sessions");
  const sp = stripeReq?.body ?? {};
  check("/api/checkout", "Stripe request authenticated with the mock key", stripeReq?.auth.ok === true);
  check("/api/checkout", "mode=payment, managed_payments[enabled]=false", sp.mode === "payment" && sp.managed_payments?.enabled === "false", short({ mode: sp.mode, managed_payments: sp.managed_payments }));
  check("/api/checkout", "shipping_address_collection GB only", deepEqual(sp.shipping_address_collection?.allowed_countries, [...SHIPPING.countries]), short(sp.shipping_address_collection));
  check("/api/checkout", "phone_number_collection enabled", sp.phone_number_collection?.enabled === "true");
  check("/api/checkout", "metadata kind/variantId/quantity", sp.metadata?.kind === "merch" && sp.metadata?.variantId === "hoodie-black-m" && sp.metadata?.quantity === "1" && sp.metadata?.productId === "hoodie", short(sp.metadata));
  check("/api/checkout", "line item price and shipping rate from products.ts", sp.line_items?.[0]?.price_data?.unit_amount === String(hoodie.product.pricePence) && sp.line_items?.[0]?.quantity === "1" && sp.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount === String(SHIPPING.ukPence), short({ unit_amount: sp.line_items?.[0]?.price_data?.unit_amount, shipping: sp.shipping_options?.[0]?.shipping_rate_data?.fixed_amount }));
  // The site is hit on 127.0.0.1:3202 while NEXT_PUBLIC_SITE_URL is the live site (the print
  // files need it): the customer must still come back to THIS host (origin.ts).
  check("/api/checkout", `success_url returns to ${site.base}/checkout/success, not NEXT_PUBLIC_SITE_URL`, sp.success_url === `${site.base}/checkout/success?session_id={CHECKOUT_SESSION_ID}` && sp.cancel_url === `${site.base}/store?cancelled=1`, short({ success_url: sp.success_url, cancel_url: sp.cancel_url }));

  check("/api/webhooks/stripe", "200 handled, not a duplicate, with orderId", first.hook?.status === 200 && first.hook.data?.handled === true && first.hook.data?.duplicate === false && /^[0-9a-f-]{36}$/.test(first.hook.data?.orderId ?? ""), short(first.hook?.data ?? first.hook?.text));
  check("orders", "processed_at set within 15 s", first.processed, first.order ? `status=${first.order.status}` : "no order row");
  const o1 = first.order;
  const pf1 = [...mocks.state.printful.orders.values()].find((o) => o.external_id === (o1 ? expectedExternalId(first.sessionId, o1.id) : "-"));
  check("orders", "status submitted, pod_provider printful, pod_order_id = the Printful id", o1?.status === "submitted" && o1?.pod_provider === "printful" && pf1 && o1?.pod_order_id === String(pf1.id), short(o1 && { status: o1.status, pod_provider: o1.pod_provider, pod_order_id: o1.pod_order_id, mock: pf1?.id }));
  check("orders", "row carries the buyer, address and totals", o1?.email === BUYER.email && o1?.name === BUYER.name && o1?.address?.postalCode === BUYER.address.postal_code && o1?.address?.country === "GB" && o1?.amount_pence === hoodie.product.pricePence + SHIPPING.ukPence && o1?.stripe_payment_intent?.startsWith("pi_test_"), short(o1 && { email: o1.email, name: o1.name, address: o1.address, amount_pence: o1.amount_pence, pi: o1.stripe_payment_intent }));
  const items1 = o1 ? itemsFor(mocks, o1.id) : [];
  check("order_items", "exactly one row: hoodie-black-m x1 at the list price", items1.length === 1 && items1[0].variant_id === "hoodie-black-m" && items1[0].product_id === "hoodie" && items1[0].quantity === 1 && items1[0].unit_pence === hoodie.product.pricePence, short(items1));
  const types1 = o1 ? eventTypes(mocks, o1.id) : [];
  check("order_events", "stripe.checkout.session.completed, pod_submitted, email_confirmation_skipped", ["stripe.checkout.session.completed", "pod_submitted", "email_confirmation_skipped"].every((t) => types1.includes(t)), types1.join(", "));
  const submitted1 = o1 ? eventsFor(mocks, o1.id).find((e) => e.type === "pod_submitted") : null;
  check("order_events", "pod_submitted says sentToProduction true", submitted1?.payload?.sentToProduction === true && submitted1?.payload?.providerOrderId === o1?.pod_order_id, short(submitted1?.payload));

  const posts = pfOrderPosts(mocks);
  const post1 = posts[0];
  check("printful POST /orders", "exactly one order created, authenticated, for store 1001", posts.length === 1 && post1?.auth.ok === true && post1.headers["x-pf-store-id"] === PF.storeId, short({ posts: posts.length, store: post1?.headers["x-pf-store-id"] }));
  check("printful POST /orders", "external_id = the Stripe session id (fits Printful's 32-char rule)", o1 && post1?.body?.external_id === expectedExternalId(first.sessionId, o1.id) && post1?.body?.external_id === first.sessionId, short(post1?.body?.external_id));
  const rcp = post1?.body?.recipient ?? {};
  check("printful POST /orders", "recipient: UK address, zip, name, email, phone", rcp.country_code === "GB" && rcp.zip === BUYER.address.postal_code && rcp.address1 === BUYER.address.line1 && rcp.city === "London" && rcp.name === BUYER.name && rcp.email === BUYER.email && rcp.phone === BUYER.phone && !("address2" in rcp) && !("state_code" in rcp), short(rcp));
  check("printful POST /orders", "shipping STANDARD", post1?.body?.shipping === "STANDARD");
  const expectedItem = expectedCatalogItem("hoodie-black-m");
  check("printful POST /orders", "items[0] = catalog variant + print file + thread colours from src/config/printful.ts", post1?.body?.items?.length === 1 && deepEqual(post1.body.items[0], expectedItem), short({ got: post1?.body?.items?.[0], want: expectedItem }, 600));
  const files1 = post1?.body?.items?.[0]?.files ?? [];
  check("printful POST /orders", `print-file URLs stay on NEXT_PUBLIC_SITE_URL (${SITE_URL}/print/...), not this localhost`, files1.length > 0 && files1.every((f) => typeof f.url === "string" && f.url.startsWith(`${SITE_URL}/print/`)), short(files1.map((f) => f.url)));
  const afterPost = post1 ? mocks.requests.printful.slice(mocks.requests.printful.indexOf(post1) + 1) : [];
  check("printful POST /orders/{id}/confirm", "draft confirmed right after creation", pf1 && afterPost[0]?.method === "POST" && afterPost[0]?.path === `/orders/${pf1.id}/confirm` && pf1.status === "pending", short(afterPost.map((r) => `${r.method} ${r.path}`)));
  // fulfilment.ts claims the row before the provider is called: a conditional PATCH that
  // returns the matched rows (an array; [] when another run already holds the order).
  const claim1 = o1 ? claimPatch(mocks, o1.id, "printful") : null;
  const claimIndex = claim1 ? mocks.requests.supabase.indexOf(claim1) : -1;
  const postAt = post1 ? new Date(post1.at).getTime() : 0;
  check("supabase PATCH orders (claim)", "order claimed (pod_provider=printful where pod_order_id is null and pod_provider is null, return=representation, select=id) BEFORE Printful was called", claim1 && claimIndex >= 0 && new Date(claim1.at).getTime() <= postAt, short(claim1 ? { query: claim1.query, prefer: claim1.headers.prefer, body: claim1.body, at: claim1.at, printfulPostAt: post1?.at } : orderPatches(mocks, o1?.id).map((r) => r.query)));
  check("orders", "the submitted row keeps pod_provider printful (the claim was never released)", o1?.pod_provider === "printful" && (o1 ? !releasePatch(mocks, o1.id) : false), short({ pod_provider: o1?.pod_provider, released: Boolean(o1 && releasePatch(mocks, o1.id)) }));

  // 3. signature checks and Stripe's retry of the same event
  const unsigned = await http("POST", `${site.base}/api/webhooks/stripe`, { body: first.payload, headers: { "content-type": "application/json" } });
  check("/api/webhooks/stripe", "unsigned delivery → 400", unsigned.status === 400, short(unsigned.data));
  const wrongSecret = await signedWebhook(site, first.payload, "whsec_someone_else");
  check("/api/webhooks/stripe", "wrong signing secret → 400", wrongSecret.status === 400, short(wrongSecret.data));
  const ordersBefore = mocks.state.tables.orders.length;
  const again = await signedWebhook(site, first.payload);
  await sleep(400);
  check("/api/webhooks/stripe", "same event again → 200 duplicate:true", again.status === 200 && again.data?.duplicate === true && again.data?.orderId === o1?.id, short(again.data));
  check("/api/webhooks/stripe", "retry created no second order and no second Printful order", mocks.state.tables.orders.length === ordersBefore && pfOrderPosts(mocks).length === 1 && mocks.state.printful.orders.size === 1, `orders=${mocks.state.tables.orders.length} printful posts=${pfOrderPosts(mocks).length}`);

  // 4. a cap: store ids from POD_IDS_JSON win over the catalog blueprint
  const cap = await purchase(site, mocks, "cap-black");
  const capPost = pfOrderPosts(mocks).find((r) => r.body?.external_id === (cap.order ? expectedExternalId(cap.sessionId, cap.order.id) : "-"));
  check("printful POST /orders", "cap-black orders the sync variant { sync_variant_id: 90001, quantity: 1 }", cap.processed && cap.order?.status === "submitted" && deepEqual(capPost?.body?.items, [{ sync_variant_id: 90001, quantity: 1 }]), short(capPost?.body?.items ?? cap.order));

  // 5. the provider is down: the order stays paid, the webhook still said 200
  await http("POST", `${mocks.urls.printful}/__fail/next`);
  const down = await purchase(site, mocks, "hoodie-black-l");
  const downTypes = down.order ? eventTypes(mocks, down.order.id) : [];
  check("/api/webhooks/stripe", "provider 500: webhook still 200", down.hook?.status === 200 && down.hook.data?.handled === true, short(down.hook?.data));
  check("orders", "provider 500: order stays paid with pod_failed, processed_at set", down.processed && down.order?.status === "paid" && down.order?.pod_order_id === null && downTypes.includes("pod_failed"), `${down.order?.status}; ${downTypes.join(", ")}`);
  const downExt = down.order ? expectedExternalId(down.sessionId, down.order.id) : null;
  check("printful GET /orders/@{external_id}", "provider 500: adapter looked for an existing order before giving up", mocks.requests.printful.some((r) => r.method === "GET" && r.path === `/orders/@${downExt}`), short(mocks.requests.printful.filter((r) => r.method === "GET").map((r) => r.path)));
  const failed = down.order ? eventOf(mocks, down.order.id, "pod_failed") : null;
  check("order_events", "pod_failed carries Printful's message", failed?.payload?.provider === "printful" && /500/.test(failed?.payload?.message ?? ""), short(failed?.payload));
  check("supabase PATCH orders (release)", "provider 500: the claim was taken, then released (row pod_provider back to null, pod_failed in order_events)", down.order && claimPatch(mocks, down.order.id, "printful") && releasePatch(mocks, down.order.id) && down.order.pod_provider === null && downTypes.includes("pod_failed"), short({ pod_provider: down.order?.pod_provider, patches: down.order ? orderPatches(mocks, down.order.id).map((r) => r.body) : [] }));

  // 6. rate limited once: Retry-After honoured, exactly one retry
  await http("POST", `${mocks.urls.printful}/__429/next`);
  const limited = await purchase(site, mocks, "ls-white-m");
  const limitedExt = limited.order ? expectedExternalId(limited.sessionId, limited.order.id) : null;
  const limitedPosts = pfOrderPosts(mocks).filter((r) => r.body?.external_id === limitedExt);
  check("printful POST /orders", "429 then success: two POSTs for the order, order submitted", limited.processed && limited.order?.status === "submitted" && limitedPosts.length === 2, `posts=${limitedPosts.length} status=${limited.order?.status}`);
  const lsItem = limitedPosts[0]?.body?.items?.[0];
  check("printful POST /orders", "long-sleeve is a DTG catalog item with back + sleeve files and no options", deepEqual(lsItem, expectedCatalogItem("ls-white-m")) && lsItem?.files?.length === 2 && !("options" in (lsItem ?? {})), short(lsItem, 400));

  // 7. the provider stored the order but we never saw the 200: recovered by @external_id, never
  //    printed twice — and, with PRINTFUL_CONFIRM on, the recovered draft is confirmed too
  mocks.state.stripe.longIds = true; // a realistic 66-char cs_test_… id, so external_id falls back to the order uuid
  await http("POST", `${mocks.urls.printful}/__fail/after-store`);
  const recovered = await purchase(site, mocks, "hoodie-black-s");
  mocks.state.stripe.longIds = false;
  const recExt = recovered.order ? expectedExternalId(recovered.sessionId, recovered.order.id) : null;
  const recPf = [...mocks.state.printful.orders.values()].find((o) => o.external_id === recExt);
  check("printful", "realistic Stripe id → external_id is the order uuid without dashes", recovered.sessionId?.length > 32 && recExt === recovered.order?.id.replace(/-/g, "") && recPf?.external_id === recExt, short({ sessionId: recovered.sessionId, external_id: recPf?.external_id }));
  const recGetIndex = mocks.requests.printful.findIndex((r) => r.method === "GET" && r.path === `/orders/@${recExt}`);
  const recConfirmIndex = recPf ? mocks.requests.printful.findIndex((r) => r.method === "POST" && r.path === `/orders/${recPf.id}/confirm`) : -1;
  check("orders", "500 after store: recovered via GET /orders/@{external_id}, submitted with that id", recovered.processed && recovered.order?.status === "submitted" && recPf && recovered.order?.pod_order_id === String(recPf.id) && recGetIndex >= 0, short({ status: recovered.order?.status, pod_order_id: recovered.order?.pod_order_id, mock: recPf?.id }));
  check("printful POST /orders/{id}/confirm", "the recovered draft was confirmed AFTER the GET /orders/@{external_id} (Printful status pending)", recGetIndex >= 0 && recConfirmIndex > recGetIndex && recPf?.status === "pending", short(mocks.requests.printful.slice(Math.max(0, recGetIndex)).map((r) => `${r.method} ${r.path}`)));
  const recEvent = recovered.order ? eventOf(mocks, recovered.order.id, "pod_submitted") : null;
  check("order_events", "pod_submitted notes the recovery + confirmation, sentToProduction true, no pod_draft_unconfirmed", /recovered existing order by external_id .*; confirmed/.test(recEvent?.payload?.note ?? "") && recEvent?.payload?.sentToProduction === true && recovered.order && !eventTypes(mocks, recovered.order.id).includes("pod_draft_unconfirmed"), short(recEvent?.payload));

  // 8. the draft is created but confirm fails (no billing method on the Printful account yet):
  //    paid, submitted, held as a draft, and flagged for the admin page
  await http("POST", `${mocks.urls.printful}/__confirm/fails`);
  const unconfirmed = await purchase(site, mocks, "hoodie-black-xl");
  await http("POST", `${mocks.urls.printful}/__confirm/ok`);
  const uncExt = unconfirmed.order ? expectedExternalId(unconfirmed.sessionId, unconfirmed.order.id) : null;
  const uncPf = [...mocks.state.printful.orders.values()].find((o) => o.external_id === uncExt);
  const uncSubmitted = unconfirmed.order ? eventOf(mocks, unconfirmed.order.id, "pod_submitted") : null;
  const uncDraft = unconfirmed.order ? eventOf(mocks, unconfirmed.order.id, "pod_draft_unconfirmed") : null;
  check("orders", "confirm fails: order still submitted with the draft's id, processed_at set, Printful copy still a draft", unconfirmed.processed && unconfirmed.order?.status === "submitted" && uncPf && unconfirmed.order?.pod_order_id === String(uncPf.id) && uncPf.status === "draft", short({ status: unconfirmed.order?.status, pod_order_id: unconfirmed.order?.pod_order_id, printful: uncPf?.status }));
  check("order_events", "confirm fails: pod_submitted.sentToProduction false, then pod_draft_unconfirmed { provider, providerOrderId, note with the failure }", uncSubmitted?.payload?.sentToProduction === false && uncDraft?.payload?.provider === "printful" && uncDraft?.payload?.providerOrderId === unconfirmed.order?.pod_order_id && /confirm failed: 400|billing method/.test(uncDraft?.payload?.note ?? ""), short({ submitted: uncSubmitted?.payload, draft: uncDraft?.payload }, 500));

  // 9. the webhook's final "done" update fails once: processed_at stays null, and Stripe's
  //    redelivery (or a Dashboard resend) RESUMES the order without a second Printful order
  await http("POST", `${mocks.urls.supabase}/__db/fail-next-patch`);
  const resumed = await purchase(site, mocks, "ls-white-l", { until: (row) => eventTypes(mocks, row.id).includes("fulfilment_deferred_failed") });
  const resExt = resumed.order ? expectedExternalId(resumed.sessionId, resumed.order.id) : null;
  const resPostsBefore = pfOrderPosts(mocks).filter((r) => r.body?.external_id === resExt).length;
  const resTypesBefore = resumed.order ? eventTypes(mocks, resumed.order.id) : [];
  check("orders", "processed_at update 500: pod_submitted recorded, fulfilment_deferred_failed appended, processed_at still null", resumed.settled && resumed.order?.status === "submitted" && resumed.order?.pod_order_id && resumed.order?.processed_at === null && resTypesBefore.includes("pod_submitted") && resTypesBefore.includes("fulfilment_deferred_failed"), short({ processed_at: resumed.order?.processed_at, events: resTypesBefore }));
  const replay = await signedWebhook(site, resumed.payload);
  const resumedDone = await waitFor(() => Boolean(resumed.order && orderRow(mocks, resumed.order.id)?.processed_at));
  const resRow = resumed.order ? orderRow(mocks, resumed.order.id) : null;
  const resTypesAfter = resumed.order ? eventTypes(mocks, resumed.order.id) : [];
  // stripe.ts processPaidSession returns duplicate: !isNew, so a resumed delivery reports
  // duplicate:true (the row already existed); the .resumed event is what distinguishes it.
  check("/api/webhooks/stripe", "same event again → 200 handled, duplicate:true (stripe.ts: !isNew) with the same orderId, and the work resumed", replay.status === 200 && replay.data?.handled === true && replay.data?.duplicate === true && replay.data?.orderId === resumed.order?.id, short(replay.data));
  check("order_events", "stripe.checkout.session.completed.resumed appended on the redelivery", resTypesAfter.includes("stripe.checkout.session.completed.resumed") && resTypesAfter.filter((t) => t === "stripe.checkout.session.completed").length === 1, resTypesAfter.join(", "));
  check("orders", "resumed: processed_at now set, still submitted with the SAME pod_order_id, exactly one Printful POST /orders for the session", Boolean(resumedDone) && resRow?.status === "submitted" && resRow?.pod_order_id === resumed.order?.pod_order_id && resRow?.pod_provider === "printful" && resPostsBefore === 1 && pfOrderPosts(mocks).filter((r) => r.body?.external_id === resExt).length === 1, short({ processed_at: resRow?.processed_at, pod_order_id: resRow?.pod_order_id, posts: pfOrderPosts(mocks).filter((r) => r.body?.external_id === resExt).length }));

  // 10. quantity 2: Stripe, the row, the item and Printful all carry it; the unit price is what was charged
  const ls = findVariant("ls-white-xl");
  const two = await purchase(site, mocks, "ls-white-xl", { quantity: 2 });
  const twoStripe = mocks.requests.stripe.find((r) => r.method === "POST" && r.path === "/v1/checkout/sessions" && r.body?.metadata?.variantId === "ls-white-xl");
  const twoItems = two.order ? itemsFor(mocks, two.order.id) : [];
  const twoExt = two.order ? expectedExternalId(two.sessionId, two.order.id) : null;
  const twoPost = pfOrderPosts(mocks).find((r) => r.body?.external_id === twoExt);
  check("/api/checkout", "quantity 2: line_items[0][quantity]=2 and metadata.quantity \"2\"", twoStripe?.body?.line_items?.[0]?.quantity === "2" && twoStripe?.body?.metadata?.quantity === "2" && twoStripe?.body?.line_items?.[0]?.price_data?.unit_amount === String(ls.product.pricePence), short({ quantity: twoStripe?.body?.line_items?.[0]?.quantity, metadata: twoStripe?.body?.metadata }));
  check("order_items", "quantity 2: one row, quantity 2, unit_pence = amount_subtotal / 2 = the list price; amount_pence = 2 x price + shipping", two.processed && twoItems.length === 1 && twoItems[0].quantity === 2 && twoItems[0].unit_pence === ls.product.pricePence && two.session?.amount_subtotal === 2 * ls.product.pricePence && two.order?.amount_pence === 2 * ls.product.pricePence + SHIPPING.ukPence, short({ items: twoItems, amount_pence: two.order?.amount_pence, amount_subtotal: two.session?.amount_subtotal }));
  check("printful POST /orders", "quantity 2: items[0].quantity === 2 (the long-sleeve catalog item), order submitted", two.order?.status === "submitted" && deepEqual(twoPost?.body?.items, [expectedCatalogItem("ls-white-xl", 2)]) && twoPost?.body?.items?.[0]?.quantity === 2, short(twoPost?.body?.items, 400));

  // 11. a realistic 66-char Stripe id on the HAPPY path: external_id is the order uuid, and confirm follows
  mocks.state.stripe.longIds = true;
  const longId = await purchase(site, mocks, "cap-stone");
  mocks.state.stripe.longIds = false;
  const longExt = longId.order ? expectedExternalId(longId.sessionId, longId.order.id) : null;
  const longPost = pfOrderPosts(mocks).find((r) => r.body?.external_id === longExt);
  const longPf = [...mocks.state.printful.orders.values()].find((o) => o.external_id === longExt);
  const afterLongPost = longPost ? mocks.requests.printful.slice(mocks.requests.printful.indexOf(longPost) + 1) : [];
  check("printful POST /orders", "realistic Stripe id, happy path: external_id = order uuid without dashes (32 hex chars), order submitted", longId.processed && longId.sessionId?.length > 32 && longId.order?.status === "submitted" && longPost?.body?.external_id === longId.order?.id.replace(/-/g, "") && /^[0-9a-f]{32}$/.test(longPost?.body?.external_id ?? ""), short({ sessionId: longId.sessionId, external_id: longPost?.body?.external_id }));
  check("printful POST /orders/{id}/confirm", "realistic Stripe id, happy path: confirm followed the POST, sentToProduction true", longPf && afterLongPost[0]?.method === "POST" && afterLongPost[0]?.path === `/orders/${longPf.id}/confirm` && longPf.status === "pending" && (longId.order ? eventOf(mocks, longId.order.id, "pod_submitted")?.payload?.sentToProduction === true : false), short(afterLongPost.map((r) => `${r.method} ${r.path}`)));

  // 12. a one-word customer name is sent to Printful as typed (not "Prince Prince")
  const prince = await purchase(site, mocks, "hoodie-black-m", { buyer: { ...BUYER, name: "Prince" } });
  const princeExt = prince.order ? expectedExternalId(prince.sessionId, prince.order.id) : null;
  const princePost = pfOrderPosts(mocks).find((r) => r.body?.external_id === princeExt);
  check("printful POST /orders", "single-word name: recipient.name === \"Prince\", row name \"Prince\", order submitted", prince.processed && prince.order?.status === "submitted" && prince.order?.name === "Prince" && princePost?.body?.recipient?.name === "Prince", short({ row: prince.order?.name, recipient: princePost?.body?.recipient?.name }));

  // Every paid session so far: all but the provider-500 one reached Printful (one only after a
  // 429 retry, one only via recovery, one left as a draft). Never two Printful orders for one session.
  const bought = [first, cap, down, limited, recovered, unconfirmed, resumed, two, longId, prince];
  const expectSubmitted = bought.length - 1;
  const rows = mocks.state.tables.orders;
  const submittedRows = rows.filter((o) => o.pod_order_id);
  const pfOrders = [...mocks.state.printful.orders.values()];
  const pfExternalIds = pfOrders.map((o) => o.external_id);
  check("printful", `one Printful order per submitted order (${expectSubmitted} of ${bought.length}), none for the failed one, no duplicate external_id`, rows.length === bought.length && submittedRows.length === expectSubmitted && pfOrders.length === expectSubmitted && new Set(pfExternalIds).size === expectSubmitted && submittedRows.every((o) => pfOrders.some((p) => String(p.id) === o.pod_order_id && p.external_id === expectedExternalId(o.stripe_session_id, o.id))) && rows.filter((o) => !o.pod_order_id).every((o) => !pfExternalIds.includes(expectedExternalId(o.stripe_session_id, o.id))), `orders=${rows.length} submitted=${submittedRows.length} printful=${pfOrders.length}`);

  // 13. Printful webhooks (v1: unsigned, so ?secret= and the store id are the gate)
  const podUrl = (secret) => `${site.base}/api/webhooks/pod${secret ? `?secret=${encodeURIComponent(secret)}` : ""}`;
  const shipped = {
    type: "package_shipped",
    created: Math.floor(Date.now() / 1000),
    retries: 0,
    store: Number(PF.storeId),
    data: {
      shipment: { id: 1, carrier: "Royal Mail", service: "Tracked 48", tracking_number: "RM123", tracking_url: "https://track.example/RM123" },
      order: { id: pf1?.id, external_id: pf1?.external_id, status: "fulfilled" },
    },
  };
  const noSecret = await http("POST", podUrl(null), { json: shipped });
  check("/api/webhooks/pod", "no ?secret → 401", noSecret.status === 401, short(noSecret.data));
  const badSecret = await http("POST", podUrl("not-the-secret"), { json: shipped });
  check("/api/webhooks/pod", "wrong secret → 401", badSecret.status === 401, short(badSecret.data));
  const ship = await http("POST", podUrl(PF.secret), { json: shipped });
  const o1Shipped = o1 ? orderRow(mocks, o1.id) : null;
  check("/api/webhooks/pod", "package_shipped → 200 matched, order shipped", ship.status === 200 && ship.data?.matched === true && ship.data?.status === "shipped" && o1Shipped?.status === "shipped", short(ship.data));
  check("orders", "tracking saved from the shipment", deepEqual(o1Shipped?.tracking, { carrier: "Royal Mail", number: "RM123", url: "https://track.example/RM123" }), short(o1Shipped?.tracking));
  check("order_events", "pod_webhook:package_shipped + email_shipped_skipped", o1 && eventTypes(mocks, o1.id).includes("pod_webhook:package_shipped") && eventTypes(mocks, o1.id).includes("email_shipped_skipped"), o1 ? eventTypes(mocks, o1.id).slice(-3).join(", ") : "");
  const lateUpdate = await http("POST", podUrl(PF.secret), {
    json: { type: "order_updated", created: Math.floor(Date.now() / 1000), retries: 0, store: Number(PF.storeId), data: { order: { id: pf1?.id, external_id: pf1?.external_id, status: "inprocess" } } },
  });
  check("/api/webhooks/pod", "late order_updated (inprocess) → 200, status never regresses from shipped", lateUpdate.status === 200 && lateUpdate.data?.matched === true && lateUpdate.data?.logged === true && orderRow(mocks, o1?.id)?.status === "shipped", short(lateUpdate.data));
  const eventsBefore = mocks.state.tables.order_events.length;
  const otherStore = await http("POST", podUrl(PF.secret), { json: { ...shipped, store: 9999, data: { ...shipped.data, order: { id: cap.order?.pod_order_id, status: "fulfilled" } } } });
  check("/api/webhooks/pod", "body for another store → ignored, nothing changes", otherStore.status === 200 && otherStore.data?.ignored === true && orderRow(mocks, cap.order?.id)?.status === "submitted" && mocks.state.tables.order_events.length === eventsBefore, short(otherStore.data));

  // 14. a tracking_url that is not http(s) is dropped (the success page renders it as a link)
  const limitedPf = [...mocks.state.printful.orders.values()].find((o) => o.external_id === limitedExt);
  const hostile = await http("POST", podUrl(PF.secret), {
    json: { ...shipped, data: { shipment: { id: 2, carrier: "Royal Mail", service: "Tracked 48", tracking_number: "RM777", tracking_url: "javascript:alert(1)" }, order: { id: limitedPf?.id, external_id: limitedPf?.external_id, status: "fulfilled" } } },
  });
  const limitedShipped = limited.order ? orderRow(mocks, limited.order.id) : null;
  check("/api/webhooks/pod", "package_shipped with tracking_url javascript:alert(1) → shipped, tracking.number RM777, tracking.url null", hostile.status === 200 && hostile.data?.status === "shipped" && limitedShipped?.status === "shipped" && deepEqual(limitedShipped?.tracking, { carrier: "Royal Mail", number: "RM777", url: null }), short({ res: hostile.data, tracking: limitedShipped?.tracking }));

  // 15. order_updated (status fulfilled) arrives BEFORE package_shipped: shipped once, emailed once, tracking filled in later
  const fulfilledFirst = await http("POST", podUrl(PF.secret), {
    json: { type: "order_updated", created: Math.floor(Date.now() / 1000), retries: 0, store: Number(PF.storeId), data: { order: { id: recPf?.id, external_id: recPf?.external_id, status: "fulfilled" } } },
  });
  const recAfterUpdate = recovered.order ? orderRow(mocks, recovered.order.id) : null;
  const shippedEmails = () => (recovered.order ? eventTypes(mocks, recovered.order.id).filter((t) => t.startsWith("email_shipped_")) : []);
  check("/api/webhooks/pod", "order_updated fulfilled first → 200 matched, order shipped, email_shipped_skipped (no Resend), no tracking yet", fulfilledFirst.status === 200 && fulfilledFirst.data?.matched === true && fulfilledFirst.data?.status === "shipped" && recAfterUpdate?.status === "shipped" && recAfterUpdate?.tracking === null && deepEqual(shippedEmails(), ["email_shipped_skipped"]), short({ res: fulfilledFirst.data, tracking: recAfterUpdate?.tracking, emails: shippedEmails() }));
  const thenShipped = await http("POST", podUrl(PF.secret), {
    json: { ...shipped, data: { shipment: { id: 3, carrier: "Royal Mail", service: "Tracked 48", tracking_number: "RM555", tracking_url: "https://track.example/RM555" }, order: { id: recPf?.id, external_id: recPf?.external_id, status: "fulfilled" } } },
  });
  const recAfterShipped = recovered.order ? orderRow(mocks, recovered.order.id) : null;
  check("/api/webhooks/pod", "then package_shipped → 200 logged (no status change), tracking filled in, STILL one email_shipped_* event", thenShipped.status === 200 && thenShipped.data?.matched === true && thenShipped.data?.logged === true && recAfterShipped?.status === "shipped" && deepEqual(recAfterShipped?.tracking, { carrier: "Royal Mail", number: "RM555", url: "https://track.example/RM555" }) && shippedEmails().length === 1, short({ res: thenShipped.data, tracking: recAfterShipped?.tracking, emails: shippedEmails() }));

  // 16. the success page reads the order back
  const success = await http("GET", `${site.base}/checkout/success?session_id=${encodeURIComponent(first.sessionId)}`);
  check("/checkout/success", "200 with the order, item, status label and total", success.status === 200 && success.text.includes("Order received") && success.text.includes(hoodie.product.name) && success.text.includes("Shipped.") && success.text.includes("58.99") && success.text.includes("RM123"), `status ${success.status}; has Order received=${success.text.includes("Order received")} Shipped.=${success.text.includes("Shipped.")} total=${success.text.includes("58.99")}`);
  const capPage = await http("GET", `${site.base}/checkout/success?session_id=${encodeURIComponent(cap.sessionId)}`);
  check("/checkout/success", "a submitted order shows 'Paid. Sent to the maker.'", capPage.status === 200 && capPage.text.includes("Paid. Sent to the maker.") && capPage.text.includes("Kitty Cap"), `status ${capPage.status}`);
  const draftPage = await http("GET", `${site.base}/checkout/success?session_id=${encodeURIComponent(unconfirmed.sessionId)}`);
  check("/checkout/success", "an unconfirmed draft (status submitted) still shows 'Paid. Sent to the maker.'", draftPage.status === 200 && draftPage.text.includes("Paid. Sent to the maker.") && draftPage.text.includes(hoodie.product.name), `status ${draftPage.status}`);
  const noOrder = await http("GET", `${site.base}/checkout/success?session_id=cs_test_doesnotexist`);
  check("/checkout/success", "unknown session → page without an order, no crash", noOrder.status === 200 && !noOrder.text.includes("Order received"), `status ${noOrder.status}`);

  // 17. this is a production build (next start): the harness URL overrides point at 127.0.0.1,
  //     so env.ts must honour them — the mocks received the traffic and nothing was logged as ignored
  const ignoredLines = site.output().split("\n").filter((l) => /ignored in production/.test(l));
  check("site log", "no 'ignored in production' for STRIPE_API_BASE / PRINTFUL_API_URL (they point at 127.0.0.1); the mocks saw the traffic", ignoredLines.length === 0 && mocks.requests.stripe.some((r) => r.path === "/v1/checkout/sessions") && pfOrderPosts(mocks).length > 0 && mocks.requests.supabase.length > 0, ignoredLines.length ? short(ignoredLines) : `stripe=${mocks.requests.stripe.length} printful=${mocks.requests.printful.length} supabase=${mocks.requests.supabase.length} requests`);
}

// ─── run 2: Printify (the fallback) ──────────────────────────────────────────

async function printifyRun(mocks, site) {
  const R = "printify";
  const check = (route, name, ok, detail) => record(R, route, name, ok, detail);

  const status = await http("GET", `${site.base}/api/commerce/status`);
  check("/api/commerce/status", "200 live with pod true", status.status === 200 && status.data?.mode === "live" && status.data.pod === true, short(status.data));

  const hoodie = await purchase(site, mocks, "hoodie-black-m");
  const post = pyOrderPosts(mocks)[0];
  check("/api/webhooks/stripe", "200 handled", hoodie.hook?.status === 200 && hoodie.hook.data?.handled === true, short(hoodie.hook?.data));
  check("printify POST orders.json", "authenticated, shop 777, line item from POD_IDS_JSON, UK address", post?.auth.ok === true && post.path === `/v1/shops/${PY.shopId}/orders.json` && deepEqual(post.body?.line_items, [{ product_id: "p1", variant_id: 4321, quantity: 1 }]) && post.body?.address_to?.country === "GB" && post.body?.address_to?.zip === BUYER.address.postal_code && post.body?.external_id === hoodie.sessionId, short(post?.body, 400));
  const py1 = [...mocks.state.printify.orders.values()][0];
  const afterPost = post ? mocks.requests.printify.slice(mocks.requests.printify.indexOf(post) + 1) : [];
  check("printify POST send_to_production.json", "sent to production right after creation", py1 && afterPost[0]?.method === "POST" && afterPost[0]?.path === `/v1/shops/${PY.shopId}/orders/${py1.id}/send_to_production.json` && py1.status === "sending-to-production", short(afterPost.map((r) => `${r.method} ${r.path}`)));
  check("orders", "submitted with pod_provider printify and the Printify id", hoodie.processed && hoodie.order?.status === "submitted" && hoodie.order?.pod_provider === "printify" && py1 && hoodie.order?.pod_order_id === py1.id, short(hoodie.order && { status: hoodie.order.status, pod_provider: hoodie.order.pod_provider, pod_order_id: hoodie.order.pod_order_id }));
  const submitted = hoodie.order ? eventsFor(mocks, hoodie.order.id).find((e) => e.type === "pod_submitted") : null;
  check("order_events", "pod_submitted sentToProduction true", submitted?.payload?.sentToProduction === true, short(submitted?.payload));

  // Printify has no catalog fallback: a variant without store ids is left for the owner
  const cap = await purchase(site, mocks, "cap-black");
  const capTypes = cap.order ? eventTypes(mocks, cap.order.id) : [];
  check("orders", "cap-black (no Printify ids): pod_unmapped, stays paid, no Printify call", cap.processed && cap.order?.status === "paid" && capTypes.includes("pod_unmapped") && pyOrderPosts(mocks).length === 1, `${cap.order?.status}; ${capTypes.join(", ")}; printify posts=${pyOrderPosts(mocks).length}`);
  const unmapped = cap.order ? eventsFor(mocks, cap.order.id).find((e) => e.type === "pod_unmapped") : null;
  check("order_events", "pod_unmapped names the variant", deepEqual(unmapped?.payload?.unmapped, ["cap-black"]) && unmapped?.payload?.provider === "printify", short(unmapped?.payload));

  // Printify webhooks are HMAC-signed
  const body = JSON.stringify({
    id: "evt_py_1",
    type: "order:shipment:created",
    created_at: new Date().toISOString(),
    resource: { id: py1?.id, type: "order", data: { shop_id: Number(PY.shopId), shipments: [{ carrier: "Royal Mail", number: "RM9", url: "https://track.example/RM9", delivered_at: null }] } },
  });
  const sign = (secret) => `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  const bad = await http("POST", `${site.base}/api/webhooks/pod`, { body, headers: { "content-type": "application/json", "x-pfy-signature": sign("wrong") } });
  check("/api/webhooks/pod", "wrong X-Pfy-Signature → 401", bad.status === 401, short(bad.data));
  const none = await http("POST", `${site.base}/api/webhooks/pod`, { body, headers: { "content-type": "application/json" } });
  check("/api/webhooks/pod", "missing X-Pfy-Signature → 401", none.status === 401, short(none.data));
  const good = await http("POST", `${site.base}/api/webhooks/pod`, { body, headers: { "content-type": "application/json", "x-pfy-signature": sign(PY.secret) } });
  const shipped = hoodie.order ? orderRow(mocks, hoodie.order.id) : null;
  check("/api/webhooks/pod", "order:shipment:created → 200 matched, shipped with tracking", good.status === 200 && good.data?.matched === true && good.data?.status === "shipped" && shipped?.status === "shipped" && deepEqual(shipped?.tracking, { carrier: "Royal Mail", number: "RM9", url: "https://track.example/RM9" }), short({ res: good.data, tracking: shipped?.tracking }));

  // Printify stored the order but answered 500: recovered through GET orders.json?limit=50, never ordered twice
  await http("POST", `${mocks.urls.printify}/__fail/after-store`);
  const recovered = await purchase(site, mocks, "hoodie-black-m");
  const recPy = [...mocks.state.printify.orders.values()].find((o) => o.external_id === recovered.sessionId);
  const recList = mocks.requests.printify.find((r) => r.method === "GET" && r.path === `/v1/shops/${PY.shopId}/orders.json` && r.query.limit === "50");
  const recPosts = pyOrderPosts(mocks).filter((r) => r.body?.external_id === recovered.sessionId);
  const recEvent = recovered.order ? eventOf(mocks, recovered.order.id, "pod_submitted") : null;
  check("printify GET orders.json?limit=50", "500 after store: the adapter listed recent orders and found the stored one by external_id", Boolean(recList) && Boolean(recPy) && recPosts.length === 1, short({ listed: Boolean(recList), stored: recPy?.id, posts: recPosts.length }));
  check("orders", "500 after store: submitted with the stored Printify id; pod_submitted notes the recovery", recovered.processed && recovered.order?.status === "submitted" && recPy && recovered.order?.pod_order_id === recPy.id && /recovered existing order by external_id/.test(recEvent?.payload?.note ?? ""), short({ status: recovered.order?.status, pod_order_id: recovered.order?.pod_order_id, note: recEvent?.payload?.note }));
  // The stored copy is "pending" (never sent to production), so the adapter reports sentToProduction
  // false and fulfilment flags it for the admin page's Confirm button rather than sending it itself.
  check("order_events", "recovered Printify order is pending: sentToProduction false + pod_draft_unconfirmed for the admin Confirm button", recEvent?.payload?.sentToProduction === false && recovered.order && eventTypes(mocks, recovered.order.id).includes("pod_draft_unconfirmed") && recPy?.status === "pending", short({ sentToProduction: recEvent?.payload?.sentToProduction, events: recovered.order ? eventTypes(mocks, recovered.order.id) : [] }));
  // The unmapped scenario above still holds: one Printify order per mapped purchase, none for the cap.
  check("printify", "two Printify orders in all (the two hoodies, two POSTs), none for the unmapped cap", mocks.state.printify.orders.size === 2 && pyOrderPosts(mocks).length === 2 && !cap.order?.pod_order_id && cap.order?.status === "paid", `printify orders=${mocks.state.printify.orders.size} posts=${pyOrderPosts(mocks).length}`);
}

// ─── run 3: the harness overrides are refused when they point off this machine ─

async function overridesRun(mocks, site) {
  const R = "overrides";
  const check = (route, name, ok, detail) => record(R, route, name, ok, detail);

  // Demo mode (no Stripe key), so /api/commerce/status attaches the self-check.
  const status = await http("GET", `${site.base}/api/commerce/status`);
  const checks = status.data?.selfcheck?.checks ?? [];
  const overrides = checks.find((c) => c.name === "env.noHarnessOverrides");
  check("/api/commerce/status", "200 demo with a selfcheck", status.status === 200 && status.data?.mode === "demo" && Array.isArray(checks) && checks.length > 0, short({ mode: status.data?.mode, checks: checks.length }));
  check("/api/commerce/status", "selfcheck env.noHarnessOverrides fails and names STRIPE_API_BASE, PRINTFUL_API_URL, PRINTIFY_API_URL, POD_IDS_JSON", overrides?.ok === false && ["STRIPE_API_BASE", "PRINTFUL_API_URL", "PRINTIFY_API_URL", "POD_IDS_JSON"].every((n) => (overrides?.detail ?? "").includes(n)), short(overrides));
  const out = site.output();
  const ignored = ["STRIPE_API_BASE", "PRINTFUL_API_URL", "PRINTIFY_API_URL"].filter((n) => out.includes(`${n} is set but not local; ignored in production`));
  check("site log", "each non-local override logged once as 'is set but not local; ignored in production'", ignored.length === 3 && ["STRIPE_API_BASE", "PRINTFUL_API_URL", "PRINTIFY_API_URL"].every((n) => out.split("\n").filter((l) => l.includes(`${n} is set but not local`)).length === 1), short(ignored));
  const reached = ["stripe", "printful", "printify"].filter((name) => mocks.requests[name].some((r) => !r.path.startsWith("/__")));
  check("mocks", "neither the Stripe, Printful nor Printify mock received a request from this run", reached.length === 0, short(Object.fromEntries(Object.entries(mocks.requests).map(([k, v]) => [k, v.length]))));
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  const started = Date.now();
  const reason = buildReason();
  if (reason) {
    console.log(`\n── production build (${reason}) ──`);
    await runBuild();
  } else {
    console.log("\n── using the existing production build in .next ──");
  }

  const mocks = await startMocks({
    stripePort: PORTS.stripe,
    supabasePort: PORTS.supabase,
    printfulPort: PORTS.printful,
    printifyPort: PORTS.printify,
    stripeKey: STRIPE_KEY,
    supabaseKey: SUPABASE_KEY,
    printful: { token: PF.token, storeId: PF.storeId },
    printify: { token: PY.token, shopId: PY.shopId },
  });
  console.log(`mocks: stripe ${mocks.urls.stripe}, supabase ${mocks.urls.supabase}, printful ${mocks.urls.printful}, printify ${mocks.urls.printify}`);

  // Every commerce var set on purpose: `next start` also reads .env.local, and
  // the real token in there must never reach a run. "" reads as unset.
  const BASE_ENV = {
    STRIPE_SECRET_KEY: STRIPE_KEY,
    STRIPE_WEBHOOK_SECRET,
    STRIPE_API_BASE: mocks.urls.stripe,
    NEXT_PUBLIC_SUPABASE_URL: mocks.urls.supabase,
    SUPABASE_SERVICE_ROLE_KEY: SUPABASE_KEY,
    RESEND_API_KEY: "",
    EMAIL_FROM: "",
    NEXT_PUBLIC_SITE_URL: SITE_URL,
    PRINTFUL_API_TOKEN: "",
    PRINTFUL_STORE_ID: "",
    PRINTFUL_WEBHOOK_SECRET: "",
    PRINTFUL_API_URL: "",
    PRINTFUL_CONFIRM: "",
    PRINTIFY_API_TOKEN: "",
    PRINTIFY_SHOP_ID: "",
    PRINTIFY_WEBHOOK_SECRET: "",
    PRINTIFY_API_URL: "",
    PRINTIFY_SEND_TO_PRODUCTION: "",
    POD_IDS_JSON: "",
  };
  const runs = [
    {
      name: "printful",
      port: PORTS.printfulSite,
      fn: printfulRun,
      env: {
        ...BASE_ENV,
        PRINTFUL_API_TOKEN: PF.token,
        PRINTFUL_STORE_ID: PF.storeId,
        PRINTFUL_WEBHOOK_SECRET: PF.secret,
        PRINTFUL_API_URL: mocks.urls.printful,
        PRINTFUL_CONFIRM: "1",
        POD_IDS_JSON: JSON.stringify(POD_IDS_PRINTFUL),
      },
    },
    {
      name: "printify",
      port: PORTS.printifySite,
      fn: printifyRun,
      env: {
        ...BASE_ENV,
        PRINTIFY_API_TOKEN: PY.token,
        PRINTIFY_SHOP_ID: PY.shopId,
        PRINTIFY_WEBHOOK_SECRET: PY.secret,
        // The override replaces the whole https://api.printify.com/v1 base.
        PRINTIFY_API_URL: `${mocks.urls.printify}/v1`,
        PRINTIFY_SEND_TO_PRODUCTION: "1",
        POD_IDS_JSON: JSON.stringify(POD_IDS_PRINTIFY),
      },
    },
    {
      // A production build with the overrides pointing OFF this machine: env.ts must ignore
      // them (and say so) — a stray variable in Vercel can never redirect keys or addresses.
      // Demo mode on purpose: no Stripe key means nothing could reach api.stripe.com, and
      // /api/commerce/status then carries the self-check that names the overrides.
      name: "overrides",
      port: PORTS.overridesSite,
      fn: overridesRun,
      env: {
        ...BASE_ENV,
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
        STRIPE_API_BASE: "http://10.0.0.1:1",
        PRINTFUL_API_URL: "http://10.0.0.1:1",
        PRINTIFY_API_URL: "http://10.0.0.1:1/v1",
        POD_IDS_JSON: JSON.stringify(POD_IDS_PRINTFUL),
      },
    },
  ].filter((r) => !args.only || args.only === r.name);

  try {
    for (const run of runs) {
      console.log(`\n── ${run.name}: next start -p ${run.port} ──`);
      mocks.reset();
      let site = null;
      try {
        site = await startSite(run.port, run.env, run.name);
        await run.fn(mocks, site);
      } catch (err) {
        record(run.name, "-", "run completed", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
        if (site) console.log(`\n--- last site output (${site.logPath}) ---\n${site.tail()}\n---`);
      } finally {
        if (site) await site.stop();
      }
    }
  } finally {
    await mocks.stop();
  }

  const failed = results.filter((r) => !r.ok);
  writeFileSync(
    join(OUT, "commerce-results.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        durationMs: Date.now() - started,
        build: reason ? `rebuilt (${reason})` : "existing .next",
        passed: results.length - failed.length,
        total: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; details in .verify/commerce-results.json`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.run} ${f.route} — ${f.check}${f.detail ? `: ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
