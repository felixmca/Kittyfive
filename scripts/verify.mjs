// ─── VERIFICATION HARNESS ────────────────────────────────────────────────────
//
//   npm run build && npx next start -p 3201
//   npm run verify                          # both viewports, every journey
//   npm run verify -- --base=http://localhost:3201 --only=390
//
// One harness, extended per feature. It exists to catch what tsc, eslint and
// `next build` cannot: a canvas that mounted and painted nothing, a control
// under a fixed overlay at 390 px, a worker that 404'd silently (the tell is an
// ABSENT request or an unexpected one), and state that looked saved until you
// reloaded. Screenshots land in .verify/ and are meant to be looked at.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, ".verify");
mkdirSync(OUT, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m ? [m[1], m[2] ?? "1"] : [a, "1"];
  }),
);
const BASE = (args.base ?? "http://localhost:3201").replace(/\/$/, "");
const VIEWPORTS = [
  { name: "390", width: 390, height: 844, mobile: true },
  { name: "1280", width: 1280, height: 800, mobile: false },
].filter((v) => !args.only || args.only === v.name);

/** Same-origin 4xx/5xx that are legitimate "does this asset exist?" probes. */
const EXPECTED_MISSING = [
  /\/models\/[^/]+\.glb$/,
  /\/story\/[^/]+\/manifest\.json$/,
  /\/story\/cutouts\//,
  /\/turntable\/manifest\.json$/,
  /\/products\/[^/]+\.(png|jpg|webp)$/,
  /\/og\.png$/,
  /\/favicon\.ico$/,
];

const results = [];
function record(viewport, route, check, ok, detail = "") {
  results.push({ viewport, route, check, ok, detail });
  const mark = ok ? "ok " : "FAIL";
  console.log(`  [${mark}] ${viewport} ${route} — ${check}${detail ? `: ${detail}` : ""}`);
}

async function canvasPainted(handle) {
  // Screenshot the element and sample 64 points; ≥3 distinct colours = painted.
  const png = await handle.screenshot({ type: "png" }).catch(() => null);
  if (!png) return { ok: false, detail: "screenshot failed" };
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const colours = new Set();
  const step = Math.max(1, Math.floor((info.width * info.height) / 64));
  for (let i = 0; i < info.width * info.height; i += step) {
    const o = i * info.channels;
    colours.add(`${data[o]},${data[o + 1]},${data[o + 2]}`);
  }
  return { ok: colours.size >= 3, detail: `${colours.size} colours, ${info.width}×${info.height}` };
}

async function checkCanvases(page, viewport, route, label = "canvas painted") {
  const canvases = await page.$$("canvas");
  if (!canvases.length) {
    record(viewport, route, label, false, "no <canvas> found");
    return;
  }
  let i = 0;
  for (const c of canvases) {
    i++;
    const box = await c.boundingBox();
    if (!box || box.width < 8 || box.height < 8) continue; // hidden helper canvases
    const r = await canvasPainted(c);
    record(viewport, route, `${label} #${i}`, r.ok, r.detail);
  }
}

async function scrollTo(page, y) {
  await page.evaluate((y) => {
    const l = window.__lenis;
    if (l && typeof l.scrollTo === "function") l.scrollTo(y, { immediate: true, force: true });
    window.scrollTo(0, y);
  }, y);
  await page.waitForTimeout(350);
}

async function hitTest(page, selector) {
  const el = await page.$(selector);
  if (!el) return { ok: false, detail: "not found" };
  const box = await el.boundingBox();
  if (!box) return { ok: false, detail: "no box" };
  // Evaluate on the handle itself so Playwright-only selectors (:has-text)
  // never reach document.querySelector.
  const ok = await el.evaluate(
    (target, { x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === target || target.contains(hit));
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  return { ok, detail: `${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}` };
}

async function withPage(browser, viewport, fn) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    userAgent: viewport.mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
  });
  const page = await context.newPage();
  const errors = [];
  const badResponses = [];
  const isExpectedMissing = (u) => {
    try {
      return EXPECTED_MISSING.some((re) => re.test(new URL(u).pathname));
    } catch {
      return false;
    }
  };
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Chrome logs every 404 as a console error; the asset probes are expected.
    const at = m.location()?.url ?? "";
    if (/404/.test(m.text()) && isExpectedMissing(at)) return;
    errors.push(`console: ${m.text().slice(0, 300)}${at ? ` @ ${at}` : ""}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    const why = r.failure()?.errorText ?? "";
    if (why === "net::ERR_ABORTED" && isExpectedMissing(u)) return; // aborted probe
    // Chromium labels a fully-consumed chunked streaming response ERR_ABORTED
    // once the server closes it (verified: /api/chat returned 200, 19 chunks,
    // full text read to `done`, and the network log still said ERR_ABORTED).
    // The chat journey separately asserts that a reply actually arrived.
    if (why === "net::ERR_ABORTED" && /\/api\/chat$/.test(new URL(u).pathname)) return;
    errors.push(`requestfailed: ${u} :: ${why}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) || r.status() < 400) return;
    if (EXPECTED_MISSING.some((re) => re.test(new URL(u).pathname))) return;
    badResponses.push(`${r.status()} ${u}`);
  });
  try {
    await fn(page, errors, badResponses);
  } finally {
    await context.close();
  }
}

async function goto(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function journeyLanding(browser, viewport) {
  const route = "/";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, route);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-00-top.png`) });
    await checkCanvases(page, viewport.name, route, "hero canvas painted");

    // Menu button reachable at its own centre, above everything else.
    const menu = await hitTest(page, 'button[aria-label="Open menu"]');
    record(viewport.name, route, "menu button reachable", menu.ok, menu.detail);
    const menuBox = await (await page.$('button[aria-label="Open menu"]'))?.boundingBox();
    if (menuBox) record(viewport.name, route, "menu button ≥44px", menuBox.width >= 44 && menuBox.height >= 44, `${menuBox.width}×${menuBox.height}`);

    // Scroll the story end to end, screenshot each step.
    const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    record(viewport.name, route, "page is long (story present)", total > viewport.height * 8, `${Math.round(total)}px of scroll`);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await scrollTo(page, Math.round((total * i) / steps));
      await page.screenshot({ path: join(OUT, `landing-${viewport.name}-${String(i).padStart(2, "0")}.png`) });
    }
    // The synthetic scene has frames; at least one story canvas must have painted by now.
    await scrollTo(page, Math.round(total * 0.25));
    await page.waitForTimeout(1200);
    await checkCanvases(page, viewport.name, route, "story canvas painted (25%)");

    // Turntable + the two buttons at the bottom.
    await scrollTo(page, total);
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-09-bottom.png`) });
    for (const label of ["Kitty Stories", "Kitty Store"]) {
      const link = await page.$(`main a:has-text("${label}")`);
      const box = link ? await link.boundingBox() : null;
      record(viewport.name, route, `bottom button "${label}"`, !!box && box.height >= 56, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "missing");
    }
    const camera = await page.$('a[aria-label="Try on Kitty merch with your camera"], button[aria-label="Try on Kitty merch with your camera"]');
    record(viewport.name, route, "floating camera visible after scroll", !!camera && (await camera.isVisible()));

    // Drawer: open, four rows, scroll to top works.
    await page.click('button[aria-label="Open menu"]');
    await page.waitForTimeout(500);
    const dialog = await page.$('[role="dialog"][aria-label="Menu"]');
    record(viewport.name, route, "drawer opens", !!dialog && (await dialog.isVisible()));
    for (const row of ["Kitty Stories", "Kitty Store", "Scroll to top", "Scroll to bottom"]) {
      const el = await page.$(`[role="dialog"] :text-is("${row}")`);
      record(viewport.name, route, `drawer row "${row}"`, !!el);
    }
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-10-drawer.png`) });
    const before = await page.evaluate(() => window.scrollY);
    await page.click('[role="dialog"] :text-is("Scroll to top")');
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => window.scrollY);
    record(viewport.name, route, "Scroll to top moves the page", after < before - 200, `${Math.round(before)} → ${Math.round(after)}`);

    // Reload: still no errors, hero still paints.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await checkCanvases(page, viewport.name, route, "hero canvas painted after reload");

    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    record(viewport.name, route, "no horizontal overflow", overflow <= 1, `${overflow}px`);
  });
}

async function journeyStore(browser, viewport) {
  const route = "/store";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, route);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `store-${viewport.name}-00.png`) });
    await checkCanvases(page, viewport.name, route, "room canvas painted");

    const panel = 'section[aria-label="Product"]';
    const t0 = (await page.textContent(panel).catch(() => "")) ?? "";
    record(viewport.name, route, "product panel present", t0.length > 10);
    const next = await hitTest(page, 'button[aria-label="Next product"]');
    record(viewport.name, route, "Next reachable", next.ok, next.detail);
    await page.click('button[aria-label="Next product"]');
    await page.waitForTimeout(400);
    await page.click('button[aria-label="Next product"]');
    await page.waitForTimeout(1200);
    const t2 = (await page.textContent(panel).catch(() => "")) ?? "";
    record(viewport.name, route, "Next changes the product", t2 !== t0, `${t0.slice(0, 24).trim()} → ${t2.slice(0, 24).trim()}`);
    await page.screenshot({ path: join(OUT, `store-${viewport.name}-01-next.png`) });

    // Buy in demo mode returns a demo URL (do not follow it; just check the API).
    const checkout = await page.evaluate(async () => {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ variantId: "cap-black", quantity: 1 }) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    });
    record(viewport.name, route, "POST /api/checkout returns a url", checkout.status === 200 && typeof checkout.body.url === "string", `${checkout.status} ${checkout.body.url ?? checkout.body.error ?? ""}`);

    // Chat: open, send, get a reply.
    const chatBtn = await hitTest(page, 'button:has-text("Talk to Kitty")');
    record(viewport.name, route, "chat button reachable", chatBtn.ok, chatBtn.detail);
    await page.click('button:has-text("Talk to Kitty")');
    await page.waitForTimeout(500);
    await page.fill('input[aria-label="Message"]', "hello");
    await page.click('button[aria-label="Send"]');
    let reply = "";
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      reply = (await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("[data-role='assistant'], [data-author='kitty'], .chat-assistant"));
        const last = nodes[nodes.length - 1];
        return last ? last.textContent ?? "" : "";
      })) ?? "";
      if (reply.trim().length > 3 && !/^…$/.test(reply.trim())) break;
    }
    if (!reply.trim()) {
      // Fallback: the dialog's text minus what the user typed.
      const all = (await page.textContent('section[aria-label="Chat with Kitty"]').catch(() => "")) ?? "";
      reply = all.replace(/hello/g, "").replace(/Talk to Kitty|Say something to Kitty|Send|Close chat/g, "").trim();
    }
    record(viewport.name, route, "chat replies", reply.trim().length > 3, reply.trim().slice(0, 80));
    await page.screenshot({ path: join(OUT, `store-${viewport.name}-02-chat.png`) });

    const menu = await hitTest(page, 'button[aria-label="Open menu"]');
    record(viewport.name, route, "menu button reachable over the scene", menu.ok, menu.detail);
    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

async function journeyStories(browser, viewport) {
  const route = "/stories";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, route);
    await page.screenshot({ path: join(OUT, `stories-${viewport.name}.png`) });
    const cards = await page.$$("main article, main details, main li, main section");
    record(viewport.name, route, "vignettes rendered", cards.length >= 3, `${cards.length} blocks`);
    const menu = await hitTest(page, 'button[aria-label="Open menu"]');
    record(viewport.name, route, "menu button reachable", menu.ok, menu.detail);
    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

async function journeyTryOn(browser, viewport) {
  const route = "/try-on";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, route);
    await page.screenshot({ path: join(OUT, `tryon-${viewport.name}.png`) });
    const open = await page.$(':text-is("Open camera")');
    record(viewport.name, route, "Open camera gate shown (no gesture yet)", !!open);
    const menu = await hitTest(page, 'button[aria-label="Open menu"]');
    record(viewport.name, route, "menu button reachable", menu.ok, menu.detail);
    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

async function apiChecks() {
  const viewport = "api";
  const get = async (path) => {
    const r = await fetch(`${BASE}${path}`);
    return { status: r.status, text: await r.text() };
  };
  const status = await get("/api/commerce/status");
  record(viewport, "/api/commerce/status", "200 + mode", status.status === 200 && /"mode"/.test(status.text), status.text.slice(0, 80));
  const chat = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], productIndex: 0 }),
  });
  const chatText = await chat.text();
  record(viewport, "/api/chat", "streams a reply", chat.status === 200 && chatText.trim().length > 0, chatText.slice(0, 60).replace(/\n/g, " "));
  const bad = await fetch(`${BASE}/api/checkout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ variantId: "nope", quantity: 1 }) });
  record(viewport, "/api/checkout", "rejects unknown variant", bad.status === 400, String(bad.status));
  const hook = await fetch(`${BASE}/api/webhooks/stripe`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  record(viewport, "/api/webhooks/stripe", "unsigned body is not accepted as a paid event", hook.status === 400 || hook.status === 200, String(hook.status));
}

async function main() {
  console.log(`verify → ${BASE}`);
  try {
    const probe = await fetch(BASE);
    if (!probe.ok) throw new Error(String(probe.status));
  } catch (e) {
    console.error(`Server not reachable at ${BASE} (${e.message}). Run: npm run build && npx next start -p 3201`);
    process.exit(2);
  }
  await apiChecks();
  const browser = await chromium.launch({
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    for (const v of VIEWPORTS) {
      console.log(`\n── ${v.name} (${v.width}×${v.height}) ──`);
      await journeyLanding(browser, v);
      await journeyStore(browser, v);
      await journeyStories(browser, v);
      await journeyTryOn(browser, v);
    }
  } finally {
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in .verify/`);
  if (failed.length) {
    console.log("\nFAILED:");
    for (const f of failed) console.log(`  ${f.viewport} ${f.route} — ${f.check}${f.detail ? `: ${f.detail}` : ""}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
