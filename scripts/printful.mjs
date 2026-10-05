#!/usr/bin/env node
/**
 * printful.mjs — the Printful operator CLI for Kitty's store.
 *
 *   node scripts/printful.mjs <command> [args] [--json]     (also: npm run printful -- <command>)
 *
 *   status                 token scopes, stores on the token, the configured store, its
 *                          webhook, product count and whether our three products exist
 *   catalog                every blueprint variant against the Printful catalog: catalog
 *                          variant id, colour, size, USD base price, UK stock; the placements
 *                          and item options the product offers. Exit 1 on a missing id or a
 *                          variant that is not in_stock for the UK.
 *   printfiles             print-area size (px, dpi, inches) for every placement we use (needs a store)
 *   products sync [--dry-run] [--allow-http]
 *                          create or update the three sync products in the store from
 *                          src/config/printful.ts and write src/config/pod-ids.json. Idempotent:
 *                          a second run is an update with the same ids. --dry-run prints the
 *                          exact request bodies and writes nothing.
 *   webhooks list | register <public site url> | clear
 *                          register needs PRINTFUL_WEBHOOK_SECRET; the URL is printed with the
 *                          secret masked
 *   orders list [--status=draft|pending|failed|canceled|inprocess|onhold|partial|fulfilled] [--full]
 *   orders get <id> [--full] | confirm <id> --yes | cancel <id> --yes
 *                          recipients are shown as name + city + country unless --full
 *   selftest               no network: blueprint coverage of src/config/products.ts, fitPosition
 *                          maths, the print files exist at the expected sizes
 *
 * Env (shell or .env.local): PRINTFUL_API_TOKEN (always), PRINTFUL_STORE_ID (everything that
 * touches the store), NEXT_PUBLIC_SITE_URL (products sync: Printful fetches the print files
 * from <site>/print/…), PRINTFUL_WEBHOOK_SECRET (webhooks register), PRINTFUL_API_URL
 * (base-URL override for the verify harness). The token is never printed. Every call has a
 * 20 s timeout and sends X-PF-Store-Id only when a store id is set. Exit code 1 on failure.
 *
 * Request and response shapes were checked against https://developers.printful.com/docs/
 * (Products API: sync_product / sync_variants[].files[].type,url,position / options;
 * Mockup Generator API: printfiles[], variant_printfiles[], available_placements;
 * Webhook API: { url, types }) and against the live API on 5 Oct 2026.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TIMEOUT_MS = 20_000;
const POD_IDS_PATH = join(ROOT, "src", "config", "pod-ids.json");
const NO_STORE_MSG =
  "no store id yet: in Printful go to Stores → Connect via API (a 'Manual order / API' store), then put its id in .env.local and Vercel as PRINTFUL_STORE_ID";

/** The events the store's webhook subscribes to; src/lib/commerce/pod/printful.ts maps them. */
export const WEBHOOK_TYPES = [
  "package_shipped",
  "package_returned",
  "order_created",
  "order_updated",
  "order_failed",
  "order_canceled",
  "order_put_hold",
  "order_remove_hold",
  "order_refunded",
];

/** Minimum pixel sizes of the print files (scripts/print-files.mjs writes them larger or equal). */
export const PRINT_FILE_MIN_PX = {
  "/print/kitty-face-embroidery.png": { width: 2000, height: 2000 },
  "/print/kitty-face-ink.png": { width: 1500, height: 1500 },
  "/print/missing-flyer-back.png": { width: 2400, height: 3394 },
};

class CliError extends Error {}

class PrintfulError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ── Minimal .env.local loader (same as pod-ids.mjs; no dotenv dependency) ────
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

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith("--") && arg.length > 2) {
      const eq = arg.indexOf("=");
      const key = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      flags[key] = eq === -1 ? true : arg.slice(eq + 1);
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

// ── The TypeScript config files ──────────────────────────────────────────────
// Node 24 strips TypeScript types natively, so src/config/printful.ts and
// src/config/products.ts import as they are (they use only erasable syntax and
// no path-alias imports). The one side effect is a MODULE_TYPELESS_PACKAGE_JSON
// warning because package.json has no "type"; it is filtered while importing.
async function importTs(relPath) {
  const original = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    const text = [warning, ...rest]
      .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? `${v.code ?? ""} ${v.message ?? ""}` : ""))
      .join(" ");
    if (/MODULE_TYPELESS_PACKAGE_JSON|Reparsing as ES module/.test(text)) return undefined;
    return original.call(process, warning, ...rest);
  };
  try {
    return await import(pathToFileURL(join(ROOT, relPath)).href);
  } catch (err) {
    throw new CliError(
      `could not import ${relPath} (Node ${process.version} strips types natively; the file must use only erasable TypeScript and no "@/..." imports): ${err.message}`,
    );
  } finally {
    process.emitWarning = original;
  }
}
const loadBlueprints = () => importTs("src/config/printful.ts");
const loadProducts = () => importTs("src/config/products.ts");
const loadSharp = async () => (await import("sharp")).default;

// ── Printful API v1 ──────────────────────────────────────────────────────────
function baseUrl() {
  return (process.env.PRINTFUL_API_URL || "https://api.printful.com").trim().replace(/\/+$/, "");
}

function storeId() {
  return (process.env.PRINTFUL_STORE_ID || "").trim();
}

function requireStoreId(what) {
  const id = storeId();
  if (!id) throw new CliError(`${what} needs a store — ${NO_STORE_MSG}`);
  return id;
}

function requireToken() {
  const token = (process.env.PRINTFUL_API_TOKEN || "").trim();
  if (!token) throw new CliError("PRINTFUL_API_TOKEN is not set (shell or .env.local): Printful → Settings → API → create a token");
  return token;
}

/**
 * One call. Returns `result` (or the whole envelope with `envelope: true`).
 * X-PF-Store-Id goes only when PRINTFUL_STORE_ID is set.
 */
async function api(method, path, { body, envelope = false } = {}) {
  const token = requireToken();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Kitty/1.0 (printful.mjs)" };
  const sid = storeId();
  if (sid) headers["X-PF-Store-Id"] = sid;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err?.name === "TimeoutError" ? `no response within ${TIMEOUT_MS / 1000} s` : (err?.cause?.message ?? err?.message ?? String(err));
    throw new PrintfulError(`${method} ${path}: ${why}`, 0, null);
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const code = typeof json?.code === "number" ? json.code : res.status;
  if (!res.ok || !json || code >= 400) {
    // Printful's 400s often quote the offending value; a rejected webhook URL would carry ?secret=.
    const detail = maskUrl(String(json?.error?.message ?? (typeof json?.result === "string" ? json.result : null) ?? text.slice(0, 300)));
    const hint =
      res.status === 401
        ? "token rejected: check PRINTFUL_API_TOKEN in .env.local"
        : res.status === 403
          ? "the token lacks the scope for this call"
          : res.status === 404
            ? "not found"
            : res.status === 429
              ? "rate limited by Printful: wait a minute, then run it again"
              : /store_id/i.test(String(detail))
                ? NO_STORE_MSG
                : "";
    throw new PrintfulError(`${method} ${path} → ${res.status}${hint ? ` (${hint})` : ""}: ${detail}`, res.status, json);
  }
  return envelope ? json : json.result;
}

async function apiOr404(method, path, opts) {
  try {
    return await api(method, path, opts);
  } catch (err) {
    if (err instanceof PrintfulError && err.status === 404) return null;
    throw err;
  }
}

// ── Small helpers ────────────────────────────────────────────────────────────
function maskUrl(url) {
  return typeof url === "string" ? url.replace(/([?&]secret=)[^&]*/i, "$1••••") : url;
}

function fmtDate(unixSeconds) {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 16) : String(unixSeconds ?? "");
}

function recipientSummary(recipient, full) {
  if (!recipient || typeof recipient !== "object") return recipient ?? null;
  if (full) return recipient;
  return { name: recipient.name, city: recipient.city, country_code: recipient.country_code };
}

/**
 * A public site URL, https unless `allowHttp` (the flag only exists on products
 * sync, where `hint` says so). `what` names the value in messages.
 */
function siteUrlFrom(value, { allowHttp = false, what = "NEXT_PUBLIC_SITE_URL", hint = "" } = {}) {
  const raw = (value || "").trim().replace(/\/+$/, "");
  if (!raw) throw new CliError(`${what} is not set`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new CliError(`${what} is not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new CliError(`${what} is ${url.protocol}// but Printful only fetches print files and posts webhooks over https${hint ? ` (${hint})` : ""}`);
  }
  return raw;
}

/**
 * Where a design sits in a placement's print area, for sync_variants[].files[].position.
 * `area` and `image` are in px; `fit` is the blueprint's fraction of the area's width or
 * height the design should fill (both: the tighter one wins; neither: contain 100%).
 * The design never spills past the area and is centred horizontally; vertically centred
 * unless fit.align is "top". All numbers are integers, as the API wants.
 */
export function fitPosition(area, image, fit = {}) {
  const aw = Math.round(area.width);
  const ah = Math.round(area.height);
  const ratio = image.width / image.height;
  const byHeight = typeof fit.height === "number" ? ah * fit.height : null;
  const byWidth = typeof fit.width === "number" ? aw * fit.width : null;
  let width;
  let height;
  if (byHeight !== null && byWidth !== null) {
    height = Math.min(byHeight, byWidth / ratio);
    width = height * ratio;
  } else if (byHeight !== null) {
    height = byHeight;
    width = height * ratio;
  } else if (byWidth !== null) {
    width = byWidth;
    height = width / ratio;
  } else if (aw / ah > ratio) {
    height = ah;
    width = ah * ratio;
  } else {
    width = aw;
    height = aw / ratio;
  }
  if (width > aw) {
    width = aw;
    height = aw / ratio;
  }
  if (height > ah) {
    height = ah;
    width = ah * ratio;
  }
  width = Math.round(width);
  height = Math.round(height);
  const left = Math.round((aw - width) / 2);
  const top = fit.align === "top" ? 0 : Math.round((ah - height) / 2);
  return { area_width: aw, area_height: ah, width, height, top, left, limit_to_print_area: true };
}

/** The print area for each placement a blueprint uses, from GET /mockup-generator/printfiles/{id}. */
function placementAreas(bp, pf) {
  const files = new Map((pf.printfiles ?? []).map((f) => [f.printfile_id, f]));
  const byVariant = new Map((pf.variant_printfiles ?? []).map((v) => [v.variant_id, v.placements ?? {}]));
  const available = Array.isArray(pf.available_placements) ? pf.available_placements : Object.keys(pf.available_placements ?? {});
  const areas = {};
  for (const p of bp.placements) {
    const ids = new Set();
    for (const catalogId of Object.values(bp.variants)) {
      const id = byVariant.get(catalogId)?.[p.placement];
      if (id !== undefined && id !== null) ids.add(id);
    }
    if (ids.size === 0) {
      throw new CliError(`${bp.name}: placement "${p.placement}" is not offered for our variants of catalog product ${bp.catalogProductId} (available: ${available.join(", ") || "none listed"})`);
    }
    if (ids.size > 1) {
      throw new CliError(`${bp.name}: placement "${p.placement}" uses different printfiles across our variants (${[...ids].join(", ")}); split the blueprint per variant group`);
    }
    const file = files.get([...ids][0]);
    if (!file) throw new CliError(`${bp.name}: printfile ${[...ids][0]} for "${p.placement}" is missing from printfiles[]`);
    areas[p.placement] = { width: file.width, height: file.height, dpi: file.dpi, fillMode: file.fill_mode, printfileId: file.printfile_id };
  }
  return areas;
}

function inches(px, dpi) {
  return dpi ? (px / dpi).toFixed(2) : "?";
}

// ── status ───────────────────────────────────────────────────────────────────
async function cmdStatus(flags) {
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const report = { apiBase: baseUrl(), scopes: [], stores: [], storeId: storeId() || null, store: null, webhook: null, storeProductCount: null, blueprints: [] };

  const scopes = await api("GET", "/oauth/scopes");
  report.scopes = (scopes?.scopes ?? []).map((s) => s.scope);
  say(`Printful ${report.apiBase}`);
  say(`token scopes: ${report.scopes.join(", ") || "(none reported)"}`);

  const stores = await api("GET", "/stores");
  report.stores = (Array.isArray(stores) ? stores : []).map((s) => ({ id: s.id, name: s.name, type: s.type }));
  say(`stores on this token: ${report.stores.length ? report.stores.map((s) => `${s.id} "${s.name}" (${s.type})`).join("; ") : "none"}`);

  if (!report.storeId) {
    say(`PRINTFUL_STORE_ID: ${NO_STORE_MSG}`);
    report.note = NO_STORE_MSG;
  } else {
    const store = await api("GET", "/store");
    report.store = { id: store.id, name: store.name, type: store.type, currency: store.currency ?? null, website: store.website ?? null };
    say(`PRINTFUL_STORE_ID=${report.storeId}: "${store.name}" (${store.type}${store.currency ? `, ${store.currency}` : ""})`);
    if (!report.stores.some((s) => String(s.id) === report.storeId)) {
      say(`  WARNING: store ${report.storeId} is not in this token's store list`);
    }

    const wh = await apiOr404("GET", "/webhooks");
    report.webhook = wh && wh.url ? { url: maskUrl(wh.url), types: wh.types ?? [] } : null;
    say(report.webhook ? `webhook: ${report.webhook.url}\n  types: ${report.webhook.types.join(", ")}` : "webhook: none registered (node scripts/printful.mjs webhooks register <site url>)");

    const products = await api("GET", "/store/products?limit=1", { envelope: true });
    report.storeProductCount = products?.paging?.total ?? (Array.isArray(products?.result) ? products.result.length : 0);
    say(`store products: ${report.storeProductCount}`);

    const { PRINTFUL_BLUEPRINTS } = await loadBlueprints();
    for (const bp of PRINTFUL_BLUEPRINTS) {
      const found = await apiOr404("GET", `/store/products/@${bp.externalId}`);
      const entry = {
        externalId: bp.externalId,
        name: bp.name,
        present: Boolean(found),
        syncProductId: found ? String(found.sync_product.id) : null,
        variants: found ? (found.sync_variants ?? []).length : 0,
        wanted: Object.keys(bp.variants).length,
      };
      report.blueprints.push(entry);
      say(entry.present ? `  ${bp.externalId}: present, sync product ${entry.syncProductId}, ${entry.variants}/${entry.wanted} variants` : `  ${bp.externalId}: MISSING (node scripts/printful.mjs products sync)`);
    }
  }
  if (flags.json) console.log(JSON.stringify(report, null, 2));
}

// ── catalog ──────────────────────────────────────────────────────────────────
async function cmdCatalog(flags) {
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const { PRINTFUL_BLUEPRINTS } = await loadBlueprints();
  const report = [];
  let failed = false;
  const fail = (msg) => {
    failed = true;
    say(`  FAIL  ${msg}`);
  };

  for (const bp of PRINTFUL_BLUEPRINTS) {
    const { product, variants } = await api("GET", `/products/${bp.catalogProductId}`);
    const entry = { productId: bp.productId, externalId: bp.externalId, catalogProductId: bp.catalogProductId, title: product.title, technique: bp.technique, variants: [], placements: [], options: [] };
    report.push(entry);
    say(`${bp.name}  →  catalog ${product.id} ${product.title}${product.is_discontinued ? "  DISCONTINUED" : ""}`);
    const techniques = product.techniques ?? [];
    const tech = techniques.find((t) => t.key === bp.technique);
    say(`  technique ${bp.technique}: ${tech ? (tech.is_default ? "offered (default)" : "offered") : "NOT OFFERED"}  (product offers: ${techniques.map((t) => t.key).join(", ")})`);
    if (!tech) fail(`${bp.name}: technique ${bp.technique} not offered`);
    if (product.is_discontinued) fail(`${bp.name}: catalog product ${product.id} is discontinued`);

    for (const [ourId, catalogId] of Object.entries(bp.variants)) {
      const v = variants.find((x) => x.id === catalogId);
      if (!v) {
        entry.variants.push({ id: ourId, catalogVariantId: catalogId, found: false });
        fail(`${ourId}: catalog variant ${catalogId} is not in product ${product.id}`);
        continue;
      }
      const uk = (v.availability_status ?? []).find((s) => s.region === "UK")?.status ?? "not listed";
      const row = { id: ourId, catalogVariantId: catalogId, color: v.color, size: v.size, price: v.price, currency: product.currency ?? "USD", uk, inStock: v.in_stock };
      entry.variants.push(row);
      say(`  ${ourId.padEnd(16)} → ${String(catalogId).padEnd(6)} ${String(v.color).padEnd(8)} ${String(v.size).padEnd(9)} ${row.currency} ${String(v.price).padEnd(6)} UK ${uk}${uk === "in_stock" ? "" : "  FAIL"}`);
      if (uk !== "in_stock") failed = true;
    }

    const files = product.files ?? [];
    for (const p of bp.placements) {
      const f = files.find((x) => x.type === p.placement);
      const row = { placement: p.placement, file: p.file, offered: Boolean(f), additionalPrice: f?.additional_price ?? null };
      entry.placements.push(row);
      say(`  placement ${p.placement.padEnd(22)} ${f ? `offered${f.additional_price ? ` (+${f.additional_price})` : ""}  "${f.title}"` : "NOT OFFERED"}  ← ${p.file}`);
      if (!f) fail(`${bp.name}: placement ${p.placement} not offered (product has: ${files.map((x) => x.type).join(", ")})`);
    }

    const options = product.options ?? [];
    for (const opt of bp.options ?? []) {
      const o = options.find((x) => x.id === opt.id);
      const wanted = Array.isArray(opt.value) ? opt.value : [opt.value];
      const keys = o?.values && typeof o.values === "object" ? Object.keys(o.values) : null;
      const badValues = keys ? wanted.filter((w) => !keys.includes(String(w))) : [];
      const row = { id: opt.id, present: Boolean(o), title: o?.title ?? null, badValues };
      entry.options.push(row);
      if (!o) {
        say(`  option    ${opt.id.padEnd(22)} WARN not listed in product.options (${options.map((x) => x.id).join(", ")})`);
      } else if (badValues.length) {
        fail(`${bp.name}: option ${opt.id} value(s) not allowed: ${badValues.join(", ")}`);
      } else {
        say(`  option    ${opt.id.padEnd(22)} ok  "${o.title}"${keys ? `  ${wanted.length}/${keys.length} values valid` : ""}`);
      }
    }
    say();
  }
  if (flags.json) console.log(JSON.stringify({ ok: !failed, products: report }, null, 2));
  if (failed) {
    say("RESULT: FAIL — fix src/config/printful.ts before syncing products");
    process.exitCode = 1;
  } else {
    say("RESULT: PASS — every variant is in the catalog and in stock for the UK");
  }
}

// ── printfiles ───────────────────────────────────────────────────────────────
async function cmdPrintfiles(flags) {
  requireStoreId("printfiles");
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const { PRINTFUL_BLUEPRINTS } = await loadBlueprints();
  const report = [];
  for (const bp of PRINTFUL_BLUEPRINTS) {
    const pf = await api("GET", `/mockup-generator/printfiles/${bp.catalogProductId}`);
    const available = Array.isArray(pf.available_placements) ? pf.available_placements : Object.keys(pf.available_placements ?? {});
    const areas = placementAreas(bp, pf);
    // The option ids this endpoint lists are the ones sync products and orders
    // accept for the product (e.g. which thread_colors* id the front placement takes).
    const optionIds = (Array.isArray(pf.options) ? pf.options : []).map((o) => (o && typeof o === "object" ? o.id : o)).filter(Boolean);
    const optionGroups = (Array.isArray(pf.option_groups) ? pf.option_groups : []).map((g) => (g && typeof g === "object" ? (g.name ?? g.id) : g)).filter(Boolean);
    report.push({ externalId: bp.externalId, catalogProductId: bp.catalogProductId, available, areas, optionIds, optionGroups });
    say(`${bp.name}  (catalog ${bp.catalogProductId})  available placements: ${available.join(", ")}`);
    for (const [placement, a] of Object.entries(areas)) {
      say(`  ${placement.padEnd(22)} ${a.width} × ${a.height} px @ ${a.dpi} dpi  =  ${inches(a.width, a.dpi)} × ${inches(a.height, a.dpi)} in  (${a.fillMode}, printfile ${a.printfileId})`);
    }
    say(`  options offered: ${optionIds.join(", ") || "none listed"}${optionGroups.length ? `  (groups: ${optionGroups.join(", ")})` : ""}`);
    say(`  blueprint sends: ${(bp.options ?? []).map((o) => o.id).join(", ") || "none"}`);
  }
  if (flags.json) console.log(JSON.stringify(report, null, 2));
}

// ── products sync ────────────────────────────────────────────────────────────
async function cmdProductsSync(flags) {
  const sid = requireStoreId("products sync");
  const dryRun = Boolean(flags.dryRun);
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const site = siteUrlFrom(process.env.NEXT_PUBLIC_SITE_URL, { allowHttp: Boolean(flags.allowHttp), hint: "pass --allow-http for a local experiment" });

  const { PRINTFUL_BLUEPRINTS, PRINT_FILES } = await loadBlueprints();
  const { findProduct } = await loadProducts();
  const sharp = await loadSharp();

  // The print files: must exist locally (to measure them) and be deployed (for Printful to fetch).
  const images = {};
  for (const bp of PRINTFUL_BLUEPRINTS) {
    for (const p of bp.placements) {
      if (images[p.file]) continue;
      const local = join(ROOT, "public", ...p.file.split("/").filter(Boolean));
      if (!existsSync(local)) throw new CliError(`print file missing locally: public${p.file} — run: node scripts/print-files.mjs`);
      const meta = await sharp(local).metadata();
      images[p.file] = { width: meta.width, height: meta.height };
    }
  }
  say(`store ${sid}; print files from ${site}/print/… :`);
  for (const [file, dims] of Object.entries(images)) say(`  ${file}  ${dims.width} × ${dims.height} px`);
  say("  NOTE: Printful downloads these from the live site when the products are created and whenever an order is placed.");
  say("        They must be DEPLOYED (commit public/print, push, let Vercel build) or the sync fails with a file error.");
  say();

  const generated = { provider: "printful", storeId: sid, generatedAt: new Date().toISOString(), variants: {} };
  const requests = [];
  for (const bp of PRINTFUL_BLUEPRINTS) {
    const product = findProduct(bp.productId);
    if (!product) throw new CliError(`${bp.externalId}: no product "${bp.productId}" in src/config/products.ts`);
    const pf = await api("GET", `/mockup-generator/printfiles/${bp.catalogProductId}`);
    const areas = placementAreas(bp, pf);
    const existing = await apiOr404("GET", `/store/products/@${bp.externalId}`);
    const existingIds = new Map((existing?.sync_variants ?? []).map((v) => [v.external_id, v.id]));
    const retail = (product.pricePence / 100).toFixed(2);
    const body = {
      sync_product: { external_id: bp.externalId, name: bp.name, thumbnail: `${site}${PRINT_FILES.faceEmbroidery}` },
      sync_variants: Object.entries(bp.variants).map(([ourId, catalogId]) => ({
        ...(existingIds.has(ourId) ? { id: existingIds.get(ourId) } : {}),
        external_id: ourId,
        variant_id: catalogId,
        retail_price: retail,
        files: bp.placements.map((p) => ({
          type: p.placement,
          url: `${site}${p.file}`,
          position: fitPosition(areas[p.placement], images[p.file], p.fit),
        })),
        ...(bp.options?.length ? { options: bp.options } : {}),
      })),
    };
    const stale = [...existingIds.keys()].filter((ext) => !(ext in bp.variants));
    const method = existing ? "PUT" : "POST";
    const path = existing ? `/store/products/${existing.sync_product.id}` : "/store/products";
    requests.push({ method, path, body });
    say(`${bp.name}: ${method} ${path}${existing ? ` (exists as sync product ${existing.sync_product.id}; ${existingIds.size} variants)` : " (not in the store yet)"}`);
    if (stale.length) say(`  note: store variants not in the blueprint will be deleted by the PUT: ${stale.join(", ")}`);
    for (const sv of body.sync_variants) {
      const pos = sv.files.map((f) => `${f.type} ${f.position.width}×${f.position.height}@${f.position.left},${f.position.top} of ${f.position.area_width}×${f.position.area_height}`).join("; ");
      say(`  ${sv.external_id.padEnd(16)} variant_id ${sv.variant_id}  retail ${sv.retail_price}  ${sv.id ? `update ${sv.id}` : "create"}  ${pos}`);
    }
    if (dryRun) {
      if (!flags.json) say(JSON.stringify(body, null, 2));
      say();
      continue;
    }

    const written = await api(method, path, { body });
    const syncProductId = written?.id ?? existing?.sync_product?.id;
    if (syncProductId === undefined || syncProductId === null) throw new CliError(`${bp.externalId}: ${method} ${path} returned no sync product id: ${JSON.stringify(written).slice(0, 300)}`);
    const detail = await api("GET", `/store/products/${syncProductId}`);
    const seen = new Set();
    for (const sv of detail.sync_variants ?? []) {
      if (!(sv.external_id in bp.variants)) continue;
      generated.variants[sv.external_id] = { productId: String(detail.sync_product.id), variantId: sv.id };
      seen.add(sv.external_id);
    }
    const missing = Object.keys(bp.variants).filter((v) => !seen.has(v));
    if (missing.length) throw new CliError(`${bp.externalId}: sync product ${syncProductId} came back without variants for ${missing.join(", ")} (check external_id on the sync variants)`);
    say(`  → sync product ${detail.sync_product.id}, ${seen.size} variants mapped`);
    say();
  }

  if (dryRun) {
    if (flags.json) console.log(JSON.stringify({ dryRun: true, storeId: sid, requests }, null, 2));
    say("dry run: nothing was sent and nothing was written.");
    return;
  }
  writeFileSync(POD_IDS_PATH, JSON.stringify(generated, null, 2) + "\n");
  say(`wrote ${POD_IDS_PATH} (${Object.keys(generated.variants).length} variants, store ${sid}). Commit it; fulfilment uses these ids from the next deploy.`);
  if (flags.json) console.log(JSON.stringify(generated, null, 2));
}

// ── webhooks ─────────────────────────────────────────────────────────────────
async function cmdWebhooks(sub, rest, flags) {
  requireStoreId(`webhooks ${sub ?? ""}`.trim());
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const show = (wh) => {
    const out = wh && wh.url ? { url: maskUrl(wh.url), types: wh.types ?? [], params: wh.params ?? null } : null;
    if (flags.json) console.log(JSON.stringify(out, null, 2));
    else if (!out) say("no webhook registered for this store");
    else say(`url:   ${out.url}\ntypes: ${out.types.join(", ")}`);
  };
  if (sub === "list") {
    show(await apiOr404("GET", "/webhooks"));
    return;
  }
  if (sub === "register") {
    const secret = (process.env.PRINTFUL_WEBHOOK_SECRET || "").trim();
    if (!secret) throw new CliError("PRINTFUL_WEBHOOK_SECRET is not set: generate a long random string, put it in .env.local and Vercel, then run register again");
    const site = siteUrlFrom(rest[0], { what: "the site url (webhooks register <https://your-domain>)" });
    const url = `${site}/api/webhooks/pod?secret=${encodeURIComponent(secret)}`;
    say(`registering ${maskUrl(url)} for ${WEBHOOK_TYPES.join(", ")}`);
    show(await api("POST", "/webhooks", { body: { url, types: WEBHOOK_TYPES } }));
    return;
  }
  if (sub === "clear") {
    await api("DELETE", "/webhooks");
    say("webhook removed");
    if (flags.json) console.log(JSON.stringify({ cleared: true }));
    return;
  }
  throw new CliError("usage: webhooks list | register <public site url> | clear");
}

// ── orders ───────────────────────────────────────────────────────────────────
function orderSummary(o, full) {
  return {
    id: o.id,
    external_id: o.external_id ?? null,
    status: o.status,
    created: fmtDate(o.created),
    updated: fmtDate(o.updated),
    shipping: o.shipping ?? null,
    items: (o.items ?? []).map((it) => ({
      name: it.name,
      quantity: it.quantity,
      sync_variant_id: it.sync_variant_id ?? null,
      variant_id: it.variant_id ?? null,
      external_id: it.external_id ?? null,
      files: (it.files ?? []).map((f) => f.type),
      retail_price: it.retail_price ?? null,
    })),
    costs: o.costs ? { subtotal: o.costs.subtotal, shipping: o.costs.shipping, tax: o.costs.tax, vat: o.costs.vat, total: o.costs.total, currency: o.costs.currency } : null,
    recipient: recipientSummary(o.recipient, full),
    shipments: (o.shipments ?? []).map((s) => ({ carrier: s.carrier, service: s.service, tracking_number: s.tracking_number, tracking_url: s.tracking_url, shipped_at: fmtDate(s.shipped_at) })),
    dashboard_url: o.dashboard_url ?? null,
  };
}

async function cmdOrders(sub, rest, flags) {
  requireStoreId(`orders ${sub ?? ""}`.trim());
  const full = Boolean(flags.full);
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  if (sub === "list") {
    const status = typeof flags.status === "string" ? flags.status : "";
    const limit = Number.parseInt(String(flags.limit ?? "50"), 10) || 50;
    const envelope = await api("GET", `/orders?limit=${limit}${status ? `&status=${encodeURIComponent(status)}` : ""}`, { envelope: true });
    const orders = (envelope.result ?? []).map((o) => orderSummary(o, full));
    if (flags.json) {
      console.log(JSON.stringify({ total: envelope.paging?.total ?? orders.length, orders }, null, 2));
      return;
    }
    say(`${envelope.paging?.total ?? orders.length} order(s)${status ? ` with status ${status}` : ""}${orders.length < (envelope.paging?.total ?? 0) ? ` (showing ${orders.length})` : ""}`);
    for (const o of orders) {
      const who = o.recipient ? (full ? JSON.stringify(o.recipient) : `${o.recipient.name ?? "?"}, ${o.recipient.city ?? "?"} ${o.recipient.country_code ?? ""}`) : "no recipient";
      say(`  ${String(o.id).padEnd(10)} ${o.status.padEnd(10)} ${o.created}  ${o.items.length} item(s)  ${o.costs ? `${o.costs.total} ${o.costs.currency}` : ""}  ${who}  ext ${o.external_id ?? "-"}`);
    }
    return;
  }
  const id = rest[0];
  if (!id) throw new CliError(`usage: orders ${sub} <id>`);
  if (sub === "get") {
    const o = orderSummary(await api("GET", `/orders/${encodeURIComponent(id)}`), full);
    console.log(JSON.stringify(o, null, 2));
    return;
  }
  if (sub === "confirm") {
    // Confirming charges the Printful card on file: show what it is first and insist on --yes.
    const before = orderSummary(await api("GET", `/orders/${encodeURIComponent(id)}`), full);
    if (!flags.yes) {
      say(`order ${before.id}: status ${before.status}, ${before.items.length} item(s)${before.costs ? `, ${before.costs.total} ${before.costs.currency}` : ""}`);
      for (const it of before.items ?? []) say(`  ${JSON.stringify(it)}`);
      throw new CliError(`confirm charges the Printful card on file: re-run with --yes to confirm order ${id}`);
    }
    const o = await api("POST", `/orders/${encodeURIComponent(id)}/confirm`);
    say(`order ${o.id} confirmed: status ${o.status} (Printful now charges the card on file and starts fulfilment)`);
    if (flags.json) console.log(JSON.stringify(orderSummary(o, full), null, 2));
    return;
  }
  if (sub === "cancel") {
    if (!flags.yes) throw new CliError(`cancel is irreversible: re-run with --yes to cancel order ${id} (draft, pending or failed orders only)`);
    const o = await api("DELETE", `/orders/${encodeURIComponent(id)}`);
    say(`order ${o.id} cancelled: status ${o.status}`);
    if (flags.json) console.log(JSON.stringify(orderSummary(o, full), null, 2));
    return;
  }
  throw new CliError("usage: orders list [--status=] | get <id> | confirm <id> --yes | cancel <id> --yes");
}

// ── selftest (no network) ────────────────────────────────────────────────────
async function cmdSelftest(flags) {
  const say = flags.json ? () => {} : (s = "") => console.log(s);
  const results = [];
  let failed = 0;
  const check = (ok, label) => {
    results.push({ ok, label });
    if (!ok) failed++;
    say(`  ${ok ? "ok  " : "FAIL"}  ${label}`);
  };

  say("blueprint coverage (src/config/printful.ts vs src/config/products.ts)");
  const { PRINTFUL_BLUEPRINTS, PRINT_FILES, THREAD, printfulBlueprintFor, printfulCatalogVariant } = await loadBlueprints();
  const { PRODUCTS, findVariant } = await loadProducts();
  for (const product of PRODUCTS) {
    const bp = printfulBlueprintFor(product.id);
    check(Boolean(bp), `product ${product.id} has a blueprint`);
    for (const v of product.variants) {
      const hit = printfulCatalogVariant(v.id);
      check(Boolean(hit) && Number.isInteger(hit.catalogVariantId) && hit.blueprint.productId === product.id, `variant ${v.id} → catalog variant ${hit?.catalogVariantId ?? "?"}`);
    }
  }
  const externalIds = new Set();
  const printFileSet = new Set(Object.values(PRINT_FILES));
  const threadSet = new Set(Object.values(THREAD));
  for (const bp of PRINTFUL_BLUEPRINTS) {
    check(!externalIds.has(bp.externalId), `external id ${bp.externalId} is unique`);
    externalIds.add(bp.externalId);
    check(bp.placements.length > 0, `${bp.externalId} has at least one placement`);
    for (const v of Object.keys(bp.variants)) check(Boolean(findVariant(v)), `${bp.externalId} variant ${v} exists in products.ts`);
    for (const p of bp.placements) check(printFileSet.has(p.file), `${bp.externalId} ${p.placement} uses a PRINT_FILES path (${p.file})`);
    for (const o of bp.options ?? []) {
      if (!o.id.startsWith("thread_colors")) continue;
      const values = Array.isArray(o.value) ? o.value : [o.value];
      check(values.every((c) => threadSet.has(c)), `${bp.externalId} ${o.id} uses only THREAD colours`);
    }
  }

  say("fitPosition");
  const cases = [
    { label: "cap front 1200×525, square 2000², height .95 centre", area: { width: 1200, height: 525 }, image: { width: 2000, height: 2000 }, fit: { height: 0.95, align: "centre" }, want: { area_width: 1200, area_height: 525, width: 499, height: 499, top: 13, left: 351 } },
    { label: "hoodie chest 1200×1200, square 2000², width .62 centre", area: { width: 1200, height: 1200 }, image: { width: 2000, height: 2000 }, fit: { width: 0.62, align: "centre" }, want: { area_width: 1200, area_height: 1200, width: 744, height: 744, top: 228, left: 228 } },
    { label: "back 3600×4800, flyer 2400×3394, height .92 top", area: { width: 3600, height: 4800 }, image: { width: 2400, height: 3394 }, fit: { height: 0.92, align: "top" }, want: { area_width: 3600, area_height: 4800, width: 3123, height: 4416, top: 0, left: 239 } },
    { label: "clamp: tall area 525×1200, wide image 2000×1000, height 1", area: { width: 525, height: 1200 }, image: { width: 2000, height: 1000 }, fit: { height: 1 }, want: { area_width: 525, area_height: 1200, width: 525, height: 263, top: 469, left: 0 } },
    { label: "no fit: contain 2000² in 1200×525", area: { width: 1200, height: 525 }, image: { width: 2000, height: 2000 }, fit: undefined, want: { area_width: 1200, area_height: 525, width: 525, height: 525, top: 0, left: 338 } },
    { label: "both fractions: tighter wins (width .5 of 1200 vs height .9 of 525)", area: { width: 1200, height: 525 }, image: { width: 2000, height: 2000 }, fit: { width: 0.5, height: 0.9 }, want: { area_width: 1200, area_height: 525, width: 473, height: 473, top: 26, left: 364 } },
  ];
  for (const c of cases) {
    const got = fitPosition(c.area, c.image, c.fit);
    const want = { ...c.want, limit_to_print_area: true };
    const ok = Object.keys(want).every((k) => got[k] === want[k]) && Object.keys(got).length === Object.keys(want).length;
    check(ok, `${c.label}${ok ? "" : `  got ${JSON.stringify(got)}`}`);
  }

  say("print files (public/print)");
  const sharp = await loadSharp();
  for (const [file, min] of Object.entries(PRINT_FILE_MIN_PX)) {
    const local = join(ROOT, "public", ...file.split("/").filter(Boolean));
    if (!existsSync(local)) {
      check(false, `${file} exists (run: node scripts/print-files.mjs)`);
      continue;
    }
    const meta = await sharp(local).metadata();
    check(meta.width >= min.width && meta.height >= min.height, `${file} is ${meta.width}×${meta.height} (≥ ${min.width}×${min.height})`);
    check(Boolean(meta.hasAlpha), `${file} has an alpha channel`);
    if (file === PRINT_FILES.faceEmbroidery) {
      const { data } = await sharp(local).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const seen = new Set();
      for (let o = 0; o < data.length; o += 4) {
        if (data[o + 3] === 0) continue;
        seen.add("#" + [data[o], data[o + 1], data[o + 2]].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase());
      }
      const extra = [...seen].filter((c) => !threadSet.has(c));
      check(extra.length === 0 && seen.size === threadSet.size, `${file} colours are exactly the ${threadSet.size} thread colours (${[...seen].sort().join(" ")})`);
    }
  }

  const ok = failed === 0;
  if (flags.json) console.log(JSON.stringify({ ok, failed, results }, null, 2));
  say(ok ? `RESULT: PASS (${results.length} checks)` : `RESULT: FAIL (${failed} of ${results.length} checks)`);
  if (!ok) process.exitCode = 1;
}

// ── main ─────────────────────────────────────────────────────────────────────
function usage() {
  console.log(`usage: node scripts/printful.mjs <command> [args] [--json]

  status
  catalog
  printfiles
  products sync [--dry-run] [--allow-http]
  webhooks list | register <public site url> | clear
  orders list [--status=draft|pending|failed|canceled|inprocess|onhold|partial|fulfilled] [--full]
  orders get <id> [--full] | confirm <id> --yes | cancel <id> --yes
  selftest

env: PRINTFUL_API_TOKEN, PRINTFUL_STORE_ID, NEXT_PUBLIC_SITE_URL, PRINTFUL_WEBHOOK_SECRET (shell or .env.local)`);
}

async function main(argv) {
  loadEnvLocal();
  const { positional, flags } = parseArgs(argv);
  const [cmd, sub, ...rest] = positional;
  switch (cmd) {
    case "status":
      return cmdStatus(flags);
    case "catalog":
      return cmdCatalog(flags);
    case "printfiles":
      return cmdPrintfiles(flags);
    case "products":
      if (sub === "sync") return cmdProductsSync(flags);
      throw new CliError("usage: products sync [--dry-run] [--allow-http]");
    case "webhooks":
      return cmdWebhooks(sub, rest, flags);
    case "orders":
      return cmdOrders(sub, rest, flags);
    case "selftest":
      return cmdSelftest(flags);
    case undefined:
    case "help":
      usage();
      if (cmd === undefined) process.exitCode = 1;
      return undefined;
    default:
      usage();
      throw new CliError(`unknown command: ${positional.join(" ")}`);
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href.toLowerCase() === import.meta.url.toLowerCase();
if (isMain) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`\nFailed: ${maskUrl(String(err.message))}`);
    process.exitCode = 1;
  });
}
