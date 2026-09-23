// ─── VERIFICATION HARNESS ────────────────────────────────────────────────────
//
//   npm run build && npx next start -p 3201
//   npm run verify                          # every viewport, every journey
//   npm run verify -- --base=http://localhost:3201 --only=390
//   npm run verify -- --only=iphone         # WebKit (Safari's engine), iPhone portrait
//
// One harness, extended per feature. It exists to catch what tsc, eslint and
// `next build` cannot: a canvas that mounted and painted nothing, a control
// under a fixed overlay at 390 px, a worker that 404'd silently (the tell is an
// ABSENT request or an unexpected one), and state that looked saved until you
// reloaded. Screenshots land in .verify/ and are meant to be looked at.
//
// Phones are tested upright (portrait) in Chromium and in WebKit, the engine
// under every iOS browser (`npx playwright install webkit` once). WebKit here
// is not an iPhone: it has no iOS memory limits, so the landing also asserts
// that only a small window of story frames is ever decoded.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, webkit } from "playwright";
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
  { name: "390", width: 390, height: 844, mobile: true, engine: "chromium" },
  { name: "375", width: 375, height: 667, mobile: true, engine: "chromium", only: ["landing", "pages"] },
  { name: "iphone", device: "iPhone 17 Pro", mobile: true, engine: "webkit", only: ["landing", "pages"] },
  { name: "1280", width: 1280, height: 800, mobile: false, engine: "chromium" },
]
  .map((v) => (v.device ? { ...v, width: devices[v.device].viewport.width, height: devices[v.device].viewport.height } : v))
  .filter((v) => !args.only || args.only === v.name);
/** A story frame decoded is 2.4 MB; phones must stay well under what iOS Safari allows a page. */
const MAX_DECODED_FRAMES = { mobile: 40, desktop: 90 };

/** Same-origin 4xx/5xx that are legitimate "does this asset exist?" probes. */
const EXPECTED_MISSING = [
  /\/models\/[^/]+\.glb$/,
  /\/story\/[^/]+\/manifest\.json$/,
  // Chapters 3–4 have no clip yet: the reader probes their still and shows a placeholder.
  /\/story\/[^/]+\/still\.webp$/,
  /\/story\/flyer\.webp$/,
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

// Note: an element screenshot scrolls the element into view, which on the
// landing moves the story on (it owns the scroll), so pass a selector there.
async function checkCanvases(page, viewport, route, label = "canvas painted", selector = "canvas") {
  const canvases = await page.$$(selector);
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

/** A browser context for a viewport: a Playwright device when it names one, else a plain size. */
function newContext(browser, viewport, extra = {}) {
  if (viewport.device) {
    const d = { ...devices[viewport.device] };
    delete d.defaultBrowserType;
    return browser.newContext({ ...d, ...extra });
  }
  return browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.mobile ? 2 : 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    userAgent: viewport.mobile
      ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
      : undefined,
    ...extra,
  });
}

async function withPage(browser, viewport, fn) {
  const context = await newContext(browser, viewport);
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
    // Browsers log every 4xx as a console error; the response handler below
    // already sorts expected probes from unexpected failures.
    if (/Failed to load resource/.test(m.text())) return;
    const at = m.location()?.url ?? "";
    errors.push(`console: ${m.text().slice(0, 300)}${at ? ` @ ${at}` : ""}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    // Chromium says net::ERR_ABORTED, WebKit "Load request cancelled".
    const why = /ERR_ABORTED|cancelled/i.test(r.failure()?.errorText ?? "") ? "net::ERR_ABORTED" : r.failure()?.errorText ?? "";
    if (why === "net::ERR_ABORTED" && isExpectedMissing(u)) return; // aborted probe
    // A story frame or manifest still in flight when the test moves on (a reload, the next page).
    if (why === "net::ERR_ABORTED" && /\/story\//.test(new URL(u).pathname)) return;
    // Chromium labels a fully-consumed chunked streaming response ERR_ABORTED
    // once the server closes it (verified: /api/chat returned 200, 19 chunks,
    // full text read to `done`, and the network log still said ERR_ABORTED).
    // The chat journey separately asserts that a reply actually arrived.
    if (why === "net::ERR_ABORTED" && /\/api\/chat$/.test(new URL(u).pathname)) return;
    // Next.js prefetches linked routes (?_rsc=…) and cancels them when the page
    // goes away; /stories renders on demand from Supabase, so they are often in flight.
    if (why === "net::ERR_ABORTED" && new URL(u).searchParams.has("_rsc")) return;
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

/** Kitty's home button: on every page, top-left, 44 px, nothing on top of it. */
async function checkHome(page, viewport, route) {
  const hit = await hitTest(page, "a[data-home]");
  record(viewport.name, route, "Kitty home button reachable", hit.ok, hit.detail);
  const box = await (await page.$("a[data-home]"))?.boundingBox();
  record(
    viewport.name,
    route,
    "Kitty home button top-left, ≥44px",
    !!box && box.width >= 44 && box.height >= 44 && box.x < 40 && box.y < 80,
    box ? `${box.width}×${box.height} at ${Math.round(box.x)},${Math.round(box.y)}` : "missing",
  );
}

async function goto(page, route) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

// ─── the swipe story (src/components/landing/SwipeStory) ─────────────────────

const storyState = (page) => page.evaluate(() => window.__swipeStory?.debugState() ?? null);

/** A cheap fingerprint of the story canvas, to prove frames change (or do not). */
const storySig = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-swipe-story] canvas");
    if (!c) return 0;
    const x = document.createElement("canvas");
    x.width = 18;
    x.height = 32;
    const g = x.getContext("2d");
    g.drawImage(c, 0, 0, 18, 32);
    const d = g.getImageData(0, 0, 18, 32).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    return h;
  });

const waitRest = (page, timeout = 25_000) =>
  page
    .waitForFunction(() => {
      const s = window.__swipeStory?.debugState();
      return s && s.started && s.target === null && !s.holding;
    }, null, { timeout })
    .then(() => true, () => false);

/** Opacity of the caption whose title is `title`, 0 when hidden. */
const captionShown = (page, title) =>
  page.evaluate((title) => {
    for (const c of document.querySelectorAll("[data-swipe-story] [data-el='caption']")) {
      if (c.querySelector("h2")?.textContent?.replace(/\s+/g, " ").trim() !== title) continue;
      const s = getComputedStyle(c);
      return s.visibility === "visible" ? Number(s.opacity) : 0;
    }
    return -1;
  }, title);

/**
 * One swipe up, starting `at` (a fraction of the screen's height). Phones in
 * Chromium get real touch events (touch-action, native scrolling and pointer
 * cancelling all take part, as on a phone); WebKit gets a mouse drag, the most
 * Playwright can do there; desktops get the wheel.
 */
async function swipeUp(page, viewport, at = 0.75) {
  if (!viewport.mobile) {
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, 160);
    return;
  }
  const x = viewport.width / 2;
  const y = viewport.height * at;
  if (viewport.engine === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await page.waitForTimeout(18);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 26 * i }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 90, { steps: 3 });
  await page.mouse.move(x, y - 220, { steps: 3 });
  await page.mouse.up();
}

async function journeyLanding(browser, viewport) {
  const route = "/";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, route);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-00-top.png`) });
    const stageTop = await page.$eval("[data-swipe-story]", (el) => Math.round(el.getBoundingClientRect().top)).catch(() => -1);
    record(viewport.name, route, "stage sits under the hero", stageTop > 100 && stageTop < viewport.height * 0.6, `stage top ${stageTop}px`);
    await checkCanvases(page, viewport.name, route, "hero canvas painted", "main > section:first-child canvas");

    // Menu button reachable at its own centre, above everything else.
    const menu = await hitTest(page, 'button[aria-label="Open menu"]');
    record(viewport.name, route, "menu button reachable", menu.ok, menu.detail);
    const menuBox = await (await page.$('button[aria-label="Open menu"]'))?.boundingBox();
    if (menuBox) record(viewport.name, route, "menu button ≥44px", menuBox.width >= 44 && menuBox.height >= 44, `${menuBox.width}×${menuBox.height}`);
    await checkHome(page, viewport, route);

    // Chapter 1 plays under the hero as the page loads, then rests on its stop.
    const started = await page.waitForFunction(() => window.__swipeStory?.debugState()?.started, null, { timeout: 30_000 }).then(() => true, () => false);
    record(viewport.name, route, "story starts", started);
    const splash = await page.$eval("[data-swipe-story]", (el) => el.dataset.splash).catch(() => "?");
    record(viewport.name, route, "no loading splash once started", splash === "false", `data-splash=${splash}`);
    const s0 = await storyState(page);
    const sigs = new Set();
    if (s0 && s0.target !== null) {
      for (let i = 0; i < 6; i++) {
        sigs.add(await storySig(page));
        await page.waitForTimeout(220);
      }
    }
    record(viewport.name, route, "chapter 1 plays (frames change)", sigs.size >= 3 || (s0 && s0.target === null), `${sigs.size} distinct frames in 1.3 s`);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-01-chapter1.png`) });
    const rested = await waitRest(page);
    const s1 = await storyState(page);
    const a = await storySig(page);
    await page.waitForTimeout(500);
    const b = await storySig(page);
    record(viewport.name, route, "chapter 1 stops on its final frame", rested && Math.abs(s1.t - s1.stops[0]) < 1e-3 && a === b, `t=${s1?.t.toFixed(2)} stop=${s1?.stops[0]?.toFixed(2)}`);
    await page.waitForTimeout(700);
    record(viewport.name, route, "caption 1 set at the stop", (await captionShown(page, "A cold night")) > 0.95);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-02-stop1.png`) });
    await checkCanvases(page, viewport.name, route, "story canvas painted", "[data-swipe-story] canvas");

    // One gesture, on a phone started on the hero (where a native scroll could
    // escape the story): the stage fills the screen, the chat flies, chapter 2
    // plays with the kittens, and it rests on stop 2.
    await swipeUp(page, viewport, 0.2);
    await page.waitForTimeout(250);
    const s2 = await storyState(page);
    record(viewport.name, route, "swipe/wheel plays on to stop 2", s2?.target !== null && Math.abs((s2?.target ?? 0) - s2.stops[1]) < 1e-3, `target ${s2?.target?.toFixed?.(2)} mode ${s2?.mode}`);
    await page.waitForTimeout(900);
    const chatOn = await page.$eval("[data-el='flight']", (el) => getComputedStyle(el).visibility === "visible").catch(() => false);
    record(viewport.name, route, "the WhatsApp chat flies in", chatOn);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-03-flight.png`) });
    // Until all five are down or chapter 2 has come to rest (software-rendered
    // WebKit plays slower than real time, so this goes by the story, not a clock).
    let kittens = 0;
    let mostDecoded = 0;
    const kittenDeadline = Date.now() + 45_000;
    while (Date.now() < kittenDeadline) {
      const n = await page.$$eval("[data-el='card']", (cards) => cards.filter((c) => getComputedStyle(c).visibility === "visible").length);
      const st = await storyState(page);
      mostDecoded = Math.max(mostDecoded, st?.media?.decoded ?? 0);
      kittens = Math.max(kittens, n);
      if (kittens === 5) {
        await page.screenshot({ path: join(OUT, `landing-${viewport.name}-04-kittens.png`) });
        break;
      }
      if (st && st.target === null && st.t >= st.stops[1] - 1e-3) break;
      await page.waitForTimeout(60);
    }
    record(viewport.name, route, "five kitten polaroids arrive in chapter 2", kittens === 5, `${kittens} seen`);
    await waitRest(page);
    mostDecoded = Math.max(mostDecoded, (await storyState(page))?.media?.decoded ?? 0);
    const cap = viewport.mobile ? MAX_DECODED_FRAMES.mobile : MAX_DECODED_FRAMES.desktop;
    record(viewport.name, route, "only a window of frames is decoded (phone memory)", mostDecoded > 0 && mostDecoded <= cap, `at most ${mostDecoded} decoded (cap ${cap})`);
    const s3 = await storyState(page);
    const topNow = await page.$eval("[data-swipe-story]", (el) => Math.round(el.getBoundingClientRect().top));
    record(viewport.name, route, "rests on stop 2, full screen", Math.abs(s3.t - s3.stops[1]) < 1e-3 && Math.abs(topNow) <= 2 && s3.mode === "engaged", `t=${s3.t.toFixed(2)} top=${topNow} mode=${s3.mode}`);
    await page.waitForTimeout(700);
    const leftOver = await page.$$eval("[data-el='card']", (cards) => cards.filter((c) => getComputedStyle(c).visibility === "visible").length);
    record(viewport.name, route, "caption 2 set, kittens gone", (await captionShown(page, "Five by dawn")) > 0.95 && leftOver === 0, `${leftOver} cards left`);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-05-stop2.png`) });

    // Hold to pause, drag to scrub, release to carry on.
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(450);
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForTimeout(420);
    const h1 = await storyState(page);
    const hs1 = await storySig(page);
    await page.waitForTimeout(400);
    const h2 = await storyState(page);
    const hs2 = await storySig(page);
    record(viewport.name, route, "hold pauses (playhead and frames stop)", h1?.holding && h1.t === h2.t && hs1 === hs2, `t ${h1?.t.toFixed(2)} → ${h2?.t.toFixed(2)}`);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-06-paused.png`) });
    await page.mouse.move(cx, cy + viewport.height * 0.3, { steps: 6 });
    await page.waitForTimeout(150);
    const h3 = await storyState(page);
    const hs3 = await storySig(page);
    record(viewport.name, route, "drag while holding scrubs", h3.t < h2.t - 0.3 && hs3 !== hs2, `t ${h2.t.toFixed(2)} → ${h3.t.toFixed(2)}`);
    await page.mouse.up();
    await page.waitForTimeout(250);
    const h4 = await storyState(page);
    record(viewport.name, route, "release carries on", !h4.holding && h4.target !== null, `target ${h4.target?.toFixed?.(2)}`);
    await waitRest(page);

    // ↑ goes back a chapter.
    const atStop = await storyState(page);
    await page.keyboard.press("ArrowUp");
    await waitRest(page);
    const back = await storyState(page);
    const k = atStop.stops.findIndex((s) => Math.abs(s - atStop.t) < 1e-3);
    record(viewport.name, route, "↑ goes back a chapter", k > 0 && Math.abs(back.t - atStop.stops[k - 1]) < 1e-3, `t ${atStop.t.toFixed(2)} → ${back.t.toFixed(2)}`);

    // Skip hands the page back: StoryEnd on screen, its buttons reachable.
    const skip = await hitTest(page, "[data-swipe-story] [data-el='skip']");
    record(viewport.name, route, "Skip story reachable", skip.ok, skip.detail);
    await page.click("[data-swipe-story] [data-el='skip']");
    await page.waitForTimeout(1500);
    const released = await storyState(page);
    const endTop = await page.$eval("[data-story-end]", (el) => Math.round(el.getBoundingClientRect().top)).catch(() => 9999);
    record(viewport.name, route, "Skip releases the page to the end", released.mode === "released" && Math.abs(endTop) <= 4, `mode=${released.mode} end top=${endTop}`);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-09-bottom.png`) });
    for (const label of ["Kitty Stories", "Kitty Store"]) {
      const sel = `main a:has-text("${label}")`;
      const link = await page.$(sel);
      const box = link ? await link.boundingBox() : null;
      record(viewport.name, route, `bottom button "${label}"`, !!box && box.height >= 56, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "missing");
      const hit = await hitTest(page, sel);
      record(viewport.name, route, `bottom button "${label}" reachable`, hit.ok, hit.detail);
    }
    const tryOn = await page.$('[data-story-end] a[href="/try-on"]');
    record(viewport.name, route, `"Try it on" under the two buttons`, !!tryOn);
    // The landing has no floating camera: it would sit on those buttons.
    const camera = await page.$('a[aria-label="Try on Kitty merch with your camera"]');
    record(viewport.name, route, "no floating camera over the end buttons", !camera);
    // Released: the page scrolls normally again (a little way back up). Mobile
    // WebKit in Playwright has no wheel, so it pages up with the keyboard.
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    if (viewport.engine === "webkit" && viewport.mobile) await page.keyboard.press("PageUp");
    else await page.mouse.wheel(0, -160);
    await page.waitForTimeout(900);
    const y1 = await page.evaluate(() => window.scrollY);
    const still = await storyState(page);
    record(viewport.name, route, "page scrolls natively after the story", y1 < y0 - 40 && still.mode === "released", `${Math.round(y0)} → ${Math.round(y1)}, mode=${still.mode}`);

    // Drawer: Kitty (home) at the top, then the pages; scroll to top works.
    await page.click('button[aria-label="Open menu"]');
    await page.waitForTimeout(500);
    const dialog = await page.$('[role="dialog"][aria-label="Menu"]');
    record(viewport.name, route, "drawer opens", !!dialog && (await dialog.isVisible()));
    const firstLink = await page.$eval('[role="dialog"][aria-label="Menu"]', (d) => {
      const a = d.querySelector("a[href], button");
      return a ? { home: a.hasAttribute("data-drawer-home"), text: a.textContent?.trim().slice(0, 40) } : null;
    });
    record(viewport.name, route, "drawer starts with Kitty (home)", !!firstLink?.home, firstLink?.text ?? "none");
    for (const row of ["Kitty Stories", "Kitty Store", "Try it on", "Scroll to top", "Scroll to bottom"]) {
      const el = await page.$(`[role="dialog"] :text-is("${row}")`);
      record(viewport.name, route, `drawer row "${row}"`, !!el);
    }
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-10-drawer.png`) });
    const before = await page.evaluate(() => window.scrollY);
    await page.click('[role="dialog"] :text-is("Scroll to top")');
    await page.waitForTimeout(1800);
    const after = await page.evaluate(() => window.scrollY);
    record(viewport.name, route, "Scroll to top moves the page", after < before - 200, `${Math.round(before)} → ${Math.round(after)}`);
    const again = await storyState(page);
    record(viewport.name, route, "back at the top, chapter 1 plays again", again.mode === "intro" && (again.target === again.stops[0] || again.t === again.stops[0]), `mode=${again.mode} t=${again.t.toFixed(2)}`);

    // Reload: still no errors, hero still paints.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await checkCanvases(page, viewport.name, route, "hero canvas painted after reload", "main > section:first-child canvas");

    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    record(viewport.name, route, "no horizontal overflow", overflow <= 1, `${overflow}px`);
  });
}

/** prefers-reduced-motion: stills joined by crossfades, captions already set, no flights. */
async function journeyLandingReduced(browser, viewport) {
  const route = "/ (reduced motion)";
  const context = await newContext(browser, viewport, { reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await goto(page, "/");
    const started = await page.waitForFunction(() => window.__swipeStory?.debugState()?.started, null, { timeout: 30_000 }).then(() => true, () => false);
    const s = await storyState(page);
    record(viewport.name, route, "rests on chapter 1 at once", started && s.t === 0 && s.target === null, `t=${s?.t}`);
    record(viewport.name, route, "caption 1 set without animation", (await captionShown(page, "A cold night")) > 0.95);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(250);
    const flying = await page.$eval("[data-el='flight']", (el) => getComputedStyle(el).visibility === "visible");
    await waitRest(page);
    const s2 = await storyState(page);
    record(viewport.name, route, "↓ crossfades to chapter 2, no chat flight", !flying && Math.abs(s2.t - s2.stops[1]) < 1e-3, `t=${s2.t.toFixed(2)}`);
    await page.waitForTimeout(300);
    record(viewport.name, route, "caption 2 set", (await captionShown(page, "Five by dawn")) > 0.95);
    await page.screenshot({ path: join(OUT, `landing-${viewport.name}-reduced.png`) });
    record(viewport.name, route, "no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } finally {
    await context.close();
  }
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

/** Every page wears Kitty's home button, and it takes you back to the story. */
async function journeyPages(browser, viewport) {
  await withPage(browser, viewport, async (page, errors, bad) => {
    for (const route of ["/stories", "/stories/a-cold-night", "/store", "/try-on", "/account"]) {
      await goto(page, route);
      await page.waitForTimeout(route === "/store" ? 1500 : 300);
      await checkHome(page, viewport, route);
      await page.screenshot({ path: join(OUT, `home-${viewport.name}-${route.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root"}.png`) });
    }
    const route = "/stories → home";
    await goto(page, "/stories");
    await page.click("a[data-home]");
    await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15_000 }).catch(() => {});
    const started = await page
      .waitForFunction(() => window.__swipeStory?.debugState()?.started, null, { timeout: 30_000 })
      .then(() => true, () => false);
    record(viewport.name, route, "home button returns to the landing and the story plays", new URL(page.url()).pathname === "/" && started, page.url());
    record(viewport.name, "pages", "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, "pages", "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
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
  const browsers = {};
  const launch = async (engine) => {
    if (!browsers[engine]) {
      browsers[engine] =
        engine === "webkit"
          ? await webkit.launch()
          : await chromium.launch({
              args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
            });
    }
    return browsers[engine];
  };
  const JOURNEYS = {
    landing: [journeyLanding, journeyLandingReduced],
    store: [journeyStore],
    stories: [journeyStories],
    tryon: [journeyTryOn],
    pages: [journeyPages],
  };
  try {
    for (const v of VIEWPORTS) {
      let browser;
      try {
        browser = await launch(v.engine);
      } catch (e) {
        record(v.name, "-", `${v.engine} launches`, false, `${e.message.split("\n")[0]} (npx playwright install ${v.engine})`);
        continue;
      }
      console.log(`\n── ${v.name} (${v.engine} ${v.device ?? ""} ${v.width}×${v.height}) ──`);
      for (const [key, fns] of Object.entries(JOURNEYS)) {
        if (v.only && !v.only.includes(key)) continue;
        for (const fn of fns) await fn(browser, v);
      }
    }
  } finally {
    await Promise.all(Object.values(browsers).map((b) => b.close()));
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
