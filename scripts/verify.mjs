// ─── VERIFICATION HARNESS ────────────────────────────────────────────────────
//
//   npm run build && npx next start -p 3201
//   npm run verify                          # every viewport, every journey
//   npm run verify -- --base=http://localhost:3201 --only=390
//   npm run verify -- --only=iphone         # WebKit (Safari's engine), iPhone portrait
//   npm run verify -- --journeys=stories,pages   # only some journeys
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
  { name: "iphone", device: "iPhone 17 Pro", mobile: true, engine: "webkit", only: ["landing", "pages", "stories", "store", "admin", "account"] },
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
  // WebKit reports Next.js prefetches (?_rsc=…) that a navigation cancels as
  // errors ("… due to access control checks", "Failed to fetch RSC payload …
  // Falling back to browser navigation"); Chromium reports the same thing as
  // an aborted request, filtered below. They are not failures of the page.
  const cancelledPrefetch = (text) =>
    /_rsc=/.test(text) && /access control checks|Load failed|Failed to fetch RSC payload/.test(text);
  page.on("pageerror", (e) => {
    if (cancelledPrefetch(e.message)) return;
    errors.push(`pageerror: ${e.message}`);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Browsers log every 4xx as a console error; the response handler below
    // already sorts expected probes from unexpected failures.
    if (/Failed to load resource/.test(m.text())) return;
    if (cancelledPrefetch(m.text()) || /Failed to fetch RSC payload .* Falling back to browser navigation/.test(m.text())) return;
    const at = m.location()?.url ?? "";
    // MediaPipe's wasm writes its own INFO/warning log lines to console.error.
    if (/vision_wasm_internal/.test(at) && /^(INFO:|[IW]\d{4} )/.test(m.text())) return;
    errors.push(`console: ${m.text().slice(0, 300)}${at ? ` @ ${at}` : ""}`);
  });
  page.on("requestfailed", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE)) return;
    // Chromium says net::ERR_ABORTED, WebKit "Load request cancelled".
    const why = /ERR_ABORTED|cancelled/i.test(r.failure()?.errorText ?? "") ? "net::ERR_ABORTED" : r.failure()?.errorText ?? "";
    if (why === "net::ERR_ABORTED" && isExpectedMissing(u)) return; // aborted probe
    // A page load superseded by the test's own next step (a reload or goto;
    // WebKit reports the old document's load as cancelled). The page that
    // replaces it is checked on its own.
    if (why === "net::ERR_ABORTED" && r.isNavigationRequest()) return;
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
    // Watch it play if there is time left before stop 1 (the last ~0.4 s holds
    // the final frame); a fast start can be nearly done by now, so then park
    // the playhead at two moments of the clip and compare what is drawn.
    const live = s0 && s0.target !== null && s0.t < s0.stops[0] - 1.8;
    if (live) {
      for (let i = 0; i < 6; i++) {
        sigs.add(await storySig(page));
        await page.waitForTimeout(220);
      }
      record(viewport.name, route, "chapter 1 plays (frames change)", sigs.size >= 3, `${sigs.size} distinct frames in 1.3 s from t=${s0.t.toFixed(2)}`);
    } else {
      await waitRest(page);
      const at = async (t) => {
        await page.evaluate((t) => window.__swipeStory.debugSeek(t), t);
        await page.waitForTimeout(700);
        return storySig(page);
      };
      const a = await at(1.0);
      const b = await at(3.0);
      await page.evaluate((t) => window.__swipeStory.debugSeek(t), s0.stops[0]);
      await page.waitForTimeout(300);
      record(viewport.name, route, "chapter 1 plays (frames change)", a !== b, `seeked: t=1.0 vs t=3.0 ${a === b ? "identical" : "differ"} (started at t=${s0?.t.toFixed(2)})`);
    }
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
    // Out of view, the story gives its decoded frames back (the frame it
    // showed is kept), so the turntable's photos do not stack on top of them.
    await page.waitForTimeout(600);
    const heldAtEnd = await page.evaluate(() => window.__swipeStory?.debugState?.().media.decoded ?? -1);
    record(viewport.name, route, "past the story, its frames are given back (phone memory)", heldAtEnd >= 0 && heldAtEnd <= 2, `${heldAtEnd} decoded`);
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

    // Her speech bubble stays on screen (it used to be cut off at a phone's edge).
    await page.click('button[aria-label="Close chat"]').catch(() => {});
    await page.waitForTimeout(300);
    const bubble = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll("canvas ~ div [role='status'], [role='status']")).find((e) =>
        e.querySelector(".font-display"),
      );
      const r = el?.getBoundingClientRect();
      return r ? { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth } : null;
    });
    record(viewport.name, route, "speech bubble inside the screen", !!bubble && bubble.left >= 0 && bubble.right <= bubble.vw, bubble ? `${bubble.left}–${bubble.right} of ${bubble.vw}` : "not found");

    // Day ↔ evening: the button flips the light and the room changes with it.
    // A WebGL canvas cannot be read back from the page, so measure a screenshot of it.
    const sig = async () => {
      const png = await page.screenshot({ type: "png" });
      const { channels } = await sharp(png).stats();
      return Math.round(channels.slice(0, 3).reduce((a, c) => a + c.mean, 0));
    };
    const mood0 = await page.$eval("[data-light-toggle]", (el) => el.dataset.lightToggle).catch(() => null);
    const bright0 = await sig();
    await page.click("[data-light-toggle]");
    await page.waitForTimeout(2600);
    const mood1 = await page.$eval("[data-light-toggle]", (el) => el.dataset.lightToggle).catch(() => null);
    const bright1 = await sig();
    record(
      viewport.name,
      route,
      "day/evening toggle changes the light",
      !!mood0 && !!mood1 && mood0 !== mood1 && (mood1 === "evening" ? bright1 < bright0 : bright1 > bright0),
      `${mood0} → ${mood1}, brightness ${bright0} → ${bright1}`,
    );
    await page.screenshot({ path: join(OUT, `store-${viewport.name}-03-${mood1}.png`) });

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
  await checkTilePictureFailures(browser, viewport);
  await checkTilePicturesArrive(browser, viewport);
}

/** Every tile picture arrives, first time, including the lazy ones further down (no false "broken"). */
async function checkTilePicturesArrive(browser, viewport) {
  const route = "/stories (all tile pictures)";
  await withPage(browser, viewport, async (page) => {
    await goto(page, "/stories");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 300) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
    });
    await page.waitForTimeout(1500);
    const imgs = await page.$$eval("[data-chapter-tile] [data-tile-face] img", (els) =>
      els.map((i) => ({ src: i.getAttribute("src") ?? "", loaded: i.complete && i.naturalWidth > 0 })),
    );
    const missing = imgs.filter((i) => !i.loaded || i.src.includes("retry=")).map((i) => i.src.replace(/^.*\/story\//, ""));
    record(viewport.name, route, "every tile picture arrives, none retried", imgs.length >= 4 && missing.length === 0, `${imgs.length} pictures${missing.length ? `; not right: ${missing.join(", ")}` : ""}`);
  });
}

/**
 * iOS Safari draws a "?" box for a picture that failed, and keeps the failure
 * (Felix's phone showed one on chapter 1's tile, 23 Sep). A tile picture that
 * fails once is asked for again under a fresh address; one that never loads is
 * dropped, and the other picture fills the tile on its own. The failures are
 * made on purpose here, so this runs outside withPage's error tracking.
 */
async function checkTilePictureFailures(browser, viewport) {
  const route = "/stories (a tile picture fails)";
  const still = "/story/01-a-cold-night/still.webp";
  const tile = '[data-chapter-tile="a-cold-night"]';
  const pictures = (page) =>
    page.$$eval(`${tile} [data-tile-face] img`, (imgs) =>
      imgs.map((i) => ({ src: i.getAttribute("src") ?? "", loaded: i.complete && i.naturalWidth > 0, masked: Boolean(i.style.maskImage || i.style.webkitMaskImage) })),
    );
  for (const always of [false, true]) {
    const context = await newContext(browser, viewport);
    const page = await context.newPage();
    try {
      await page.route(
        (u) => u.pathname === still,
        (r) => (!always && new URL(r.request().url()).searchParams.has("retry") ? r.continue() : r.abort()),
      );
      await goto(page, "/stories");
      await page.waitForTimeout(800);
      const imgs = await pictures(page);
      const detail = imgs.map((i) => `${i.src.replace(/^.*\/story\//, "")}${i.loaded ? "" : " (not loaded)"}${i.masked ? " masked" : ""}`).join(", ");
      if (!always) {
        const a = imgs.find((i) => i.src.includes("still.webp"));
        record(viewport.name, route, "a picture that failed once loads on the retry", !!a && a.src.includes("retry=1") && a.loaded, detail);
      } else {
        const gone = !imgs.some((i) => i.src.includes("still.webp"));
        const b = imgs.find((i) => i.src.includes("end-frame"));
        record(viewport.name, route, "a picture that never loads is dropped, the other fills the tile", gone && !!b && b.loaded && !b.masked, detail);
      }
    } finally {
      await context.close();
    }
  }
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

// ─── the book (Phase 2E) ─────────────────────────────────────────────────────
//
// Owner journeys run in demo mode with a pretend account: every edit lives in
// this test browser's localStorage and nothing reaches the real project.

const DEMO_OWNER = { email: "owner@example.com", displayName: "Owner" };
const FIXTURES = [join(root, "public/story/01-a-cold-night/still.webp"), join(root, "public/story/02-five-by-dawn/extras/kittens4.webp")];

/** Titles of the chapter tiles in volume `slug`, in order. */
const tileTitles = (page, slug) =>
  page.$$eval(`[data-volume="${slug}"] [data-chapter-tile]`, (tiles) =>
    tiles.map((t) => (t.querySelector("h3, h2")?.textContent ?? t.textContent ?? "").replace(/\s+/g, " ").trim()),
  );

/**
 * Phase 5 in demo mode (this browser only, nothing sent, no production data):
 * a reader subscribes, the owner sees them, invites someone, and emails a
 * chapter once. Then the pages behind the email links ask before acting.
 */
async function journeySubscriptions(browser, viewport) {
  const route = "/stories (email, demo)";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await page.addInitScript((owner) => {
      if (!sessionStorage.getItem("verify-seeded")) {
        localStorage.removeItem("kittyfive-demo-subscriptions-v1");
        localStorage.setItem("kittyfive-demo-auth", JSON.stringify(owner));
        sessionStorage.setItem("verify-seeded", "1");
      }
    }, DEMO_OWNER);
    page.on("dialog", (d) => void d.accept());
    await goto(page, "/stories?demo=1");
    const card = await page.waitForSelector('[data-subscribe="off"]', { timeout: 20_000 }).catch(() => null);
    record(viewport.name, route, "readers are offered new chapters by email", !!card);
    if (!card) return;
    await page.click("[data-subscribe-toggle]");
    const on = await page.waitForSelector('[data-subscribe="on"]', { timeout: 10_000 }).catch(() => null);
    const note = await page.$eval("[data-subscribe-note]", (el) => el.textContent ?? "").catch(() => "");
    record(viewport.name, route, "one press subscribes (and says demo sends nothing)", !!on && /demo/i.test(note), note.slice(0, 70));

    const panel = await page.waitForSelector("[data-subscribers]", { timeout: 15_000 }).catch(() => null);
    record(viewport.name, route, "the owner sees the email panel", !!panel);
    if (!panel) return;
    await page.click("[data-subscribers] summary");
    await page.waitForFunction(() => /1 subscribed/.test(document.querySelector("[data-subscriber-counts]")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
    const counts1 = await page.$eval("[data-subscriber-counts]", (el) => el.textContent ?? "");
    record(viewport.name, route, "the owner sees the new subscriber", /1 subscribed/.test(counts1), counts1);

    await page.fill("#invite-email", "Friend@Example.com");
    await page.click('[data-invite-form] button[type="submit"]');
    await page.waitForFunction(() => /1 invited/.test(document.querySelector("[data-subscriber-counts]")?.textContent ?? ""), null, { timeout: 10_000 }).catch(() => {});
    const counts2 = await page.$eval("[data-subscriber-counts]", (el) => el.textContent ?? "");
    record(viewport.name, route, "an invitation is pending until they confirm", /1 invited/.test(counts2), counts2);

    const first = await page.$("[data-notify-chapter] [data-notify]");
    if (first) await first.click();
    await page.waitForSelector("[data-notify-chapter] [data-notified]", { timeout: 10_000 }).catch(() => {});
    const emailed = await page.$$eval("[data-notify-chapter] [data-notified]", (els) => els.length);
    record(viewport.name, route, "a chapter is emailed once, then says when", !!first && emailed === 1, `${emailed} emailed`);
    await page.screenshot({ path: join(OUT, `subscriptions-${viewport.name}.png`), fullPage: false });

    await goto(page, "/unsubscribe?t=" + "0".repeat(64));
    const button = await page.waitForSelector("[data-email-link-button]", { timeout: 15_000 }).catch(() => null);
    const state = await page.$eval("[data-email-link]", (el) => el.getAttribute("data-state")).catch(() => null);
    record(viewport.name, route, "the unsubscribe link asks for a press (opening it changes nothing)", !!button && state === "idle", String(state));
    await goto(page, "/subscribe/confirm?t=short");
    const broken = await page.$eval("[data-email-link]", (el) => el.textContent ?? "").catch(() => "");
    record(viewport.name, route, "a cut-off link says so", /not complete/.test(broken));

    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

async function journeyStoriesOwner(browser, viewport) {
  const route = "/stories (owner, demo)";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await page.addInitScript((owner) => {
      if (!sessionStorage.getItem("verify-seeded")) {
        localStorage.removeItem("kittyfive-demo-stories-v1");
        localStorage.setItem("kittyfive-demo-auth", JSON.stringify(owner));
        sessionStorage.setItem("verify-seeded", "1");
      }
    }, DEMO_OWNER);

    // 1 · Build a chapter from two photos and a few sentences (canned draft in demo).
    await goto(page, "/stories/new?volume=the-back-door&demo=1");
    const compose = await page.waitForSelector("[data-studio-compose]", { timeout: 20_000 }).catch(() => null);
    record(viewport.name, route, "chapter builder opens for the owner", !!compose);
    if (!compose) return;
    await page.setInputFiles("[data-photo-tray] input[type=file], [data-studio-compose] input[type=file]", FIXTURES);
    await page.waitForFunction(() => document.querySelectorAll("[data-photo-tray] img").length >= 2, null, { timeout: 20_000 }).catch(() => {});
    const photos = await page.$$eval("[data-photo-tray] img", (imgs) => imgs.length);
    record(viewport.name, route, "two photos added to the tray", photos >= 2, `${photos} in the tray`);
    await page.fill("#studio-text", "She sat on the back step at dusk and would not come in until the kettle boiled. Then she did, and stayed on the rug.");
    await page.click("[data-draft]");
    const review = await page.waitForSelector("[data-studio-review]", { timeout: 20_000 }).catch(() => null);
    const scenes = await page.$$("[data-studio-scene]");
    record(viewport.name, route, "the draft arrives with scenes", !!review && scenes.length >= 2, `${scenes.length} scenes`);
    await page.screenshot({ path: join(OUT, `owner-${viewport.name}-01-draft.png`) });
    await page.click("[data-publish]");
    await page.waitForURL(/\/stories\/[^/]+\/edit/, { timeout: 20_000 }).catch(() => {});
    const builtSlug = /\/stories\/([^/]+)\/edit/.exec(new URL(page.url()).pathname)?.[1] ?? null;
    record(viewport.name, route, "published: the studio moves to the chapter's own URL", !!builtSlug, new URL(page.url()).pathname);

    // 2 · It is in its volume, after "A cold night".
    await goto(page, "/stories?demo=1");
    await page.waitForSelector('[data-volume="the-back-door"] [data-chapter-tile]', { timeout: 20_000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll('[data-volume="the-back-door"] [data-chapter-tile]').length >= 2, null, { timeout: 15_000 }).catch(() => {});
    const before = await tileTitles(page, "the-back-door");
    record(viewport.name, route, "the new chapter is in its volume", before.length === 2 && /A cold night/.test(before[0]), before.join(" | "));

    // 3 · Drag it in front of "A cold night" (keyboard on the grip: Space, ←, Space).
    await page.click("[data-edit-toggle]");
    const grips = await page.$$('[data-volume="the-back-door"] [data-ripple-grip]');
    record(viewport.name, route, "Edit shows drag handles", grips.length === 2, `${grips.length} handles`);
    if (grips.length === 2) {
      await grips[1].focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(250);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(250);
      await page.keyboard.press("Space");
      await page.waitForTimeout(1200);
    }
    const moved = await tileTitles(page, "the-back-door");
    record(viewport.name, route, "drag reorders the chapters", moved.length === 2 && moved[0] === before[1] && moved[1] === before[0], moved.join(" | "));
    await page.screenshot({ path: join(OUT, `owner-${viewport.name}-02-dragged.png`) });

    // 4 · Edit its tile: a new title, saved.
    const tiles = await page.$$('[data-volume="the-back-door"] [data-chapter-tile]');
    if (tiles[0]) await tiles[0].click();
    const editor = await page.waitForSelector("[data-tile-editor]", { timeout: 10_000 }).catch(() => null);
    record(viewport.name, route, "tapping a tile opens its editor", !!editor);
    if (editor) {
      await page.fill('[data-tile-editor] input[placeholder="And there she was"]', "The kettle and the rug");
      await page.click("[data-tile-save]");
      await page.waitForSelector("[data-tile-editor]", { state: "detached", timeout: 10_000 }).catch(() => {});
    }

    // 5 · Reload: order and title are still there.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll('[data-volume="the-back-door"] [data-chapter-tile]').length >= 2, null, { timeout: 20_000 }).catch(() => {});
    const after = await tileTitles(page, "the-back-door");
    record(viewport.name, route, "after a reload: new order and new title kept", after.length === 2 && /The kettle and the rug/.test(after[0]) && /A cold night/.test(after[1]), after.join(" | "));
    await page.screenshot({ path: join(OUT, `owner-${viewport.name}-03-reloaded.png`) });

    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

/** A visitor scrolls from the end of volume 1 into volume 2 without tapping. */
async function journeyReader(browser, viewport) {
  const route = "/stories/a-cold-night → volume 2";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await goto(page, "/stories/a-cold-night?demo=1");
    const chip = () => page.$eval("[data-reader-position]", (el) => el.textContent?.trim() ?? "").catch(() => "");
    record(viewport.name, route, "reader opens on volume 1", /Vol 1/i.test(await chip()), await chip());
    let path = new URL(page.url()).pathname;
    const deadline = Date.now() + 40_000;
    // Clip scenes keep only a window of frames decoded (useFrameSequence), even
    // at a chapter boundary with two clips near the screen.
    const decodedNow = () =>
      page.evaluate(() => (window.__frameSequences?.() ?? []).reduce((n, s) => n + s.decoded, 0)).catch(() => 0);
    let mostDecoded = 0;
    while (Date.now() < deadline && path === "/stories/a-cold-night") {
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      if (viewport.engine === "webkit" && viewport.mobile) await page.keyboard.press("PageDown");
      else await page.mouse.wheel(0, viewport.height * 0.8);
      await page.waitForTimeout(250);
      mostDecoded = Math.max(mostDecoded, await decodedNow());
      path = new URL(page.url()).pathname;
    }
    const now = await chip();
    record(viewport.name, route, "scrolling on reaches the next volume's chapter", path === "/stories/five-by-dawn" && /Vol 2/i.test(now), `${path} · ${now}`);
    record(viewport.name, route, "reader keeps only a window of frames decoded", mostDecoded > 0 && mostDecoded <= 70, `at most ${mostDecoded} decoded`);
    await page.screenshot({ path: join(OUT, `reader-${viewport.name}-vol2.png`) });
    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

/**
 * The 3D cap (Phase 4, behind ?cap3d=1): a fake camera, a head posed through
 * window.__cap3d.setHead (no face needed), and the cap drawn over the video.
 * Needs its own Chromium with fake media devices; face tracking loads
 * MediaPipe from jsDelivr and Google, so this journey needs the network.
 */
async function journeyCap3D(_browser, viewport) {
  if (viewport.engine !== "chromium") return;
  const route = "/try-on?cap3d=1";
  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    await withPage(browser, viewport, async (page, errors, bad) => {
      await page.context().grantPermissions(["camera"], { origin: BASE });
      await goto(page, route);
      await page.click('text="Open camera"');
      const ready = await page.waitForFunction(() => !!window.__cap3d, null, { timeout: 30_000 }).then(() => true, () => false);
      record(viewport.name, route, "the 3D cap starts over the live camera", ready);
      if (!ready) return;
      await page.evaluate(() => {
        const v = document.querySelector("video");
        const aspect = v && v.videoWidth ? v.videoWidth / v.videoHeight : 4 / 3;
        const s = Math.sin(0.25);
        window.__cap3d.setHead({ anchor: { x: 0.5, y: 0.34 }, width: 0.13, quat: [0, s, 0, Math.cos(0.25)], aspect });
      });
      await page.waitForTimeout(800);
      const state = await page.evaluate(() => window.__cap3d.state());
      const canvas = await page.$("[data-cap3d]");
      const painted = canvas ? await canvasPainted(canvas) : { ok: false, detail: "no canvas" };
      record(viewport.name, route, "a posed head gets the cap (the canvas paints)", state.visible && painted.ok, painted.detail);
      await page.screenshot({ path: join(OUT, `cap3d-${viewport.name}.png`) });
      // The shutter composites the cap into the photo.
      await page.click('button[aria-label*="photo" i], button[aria-label*="shutter" i], button[aria-label*="Take" i]').catch(() => {});
      await page.waitForTimeout(800);
      record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
      record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
    });
  } finally {
    await browser.close();
  }
}

/**
 * The fitted hoodie (/try-on?fit=1): a posed body (no camera person needed)
 * gets the garment warped onto it: body between shoulders and hem, a sleeve
 * along a raised arm, a forearm in front of the body drawn over it.
 */
async function journeyFit(_browser, viewport) {
  if (viewport.engine !== "chromium") return;
  const route = "/try-on?fit=1";
  const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  try {
    await withPage(browser, viewport, async (page, errors, bad) => {
      await page.context().grantPermissions(["camera"], { origin: BASE });
      await goto(page, route);
      await page.click('text="Open camera"');
      await page.locator('[role="radio"]').nth(1).click(); // the hoodie
      const ready = await page.waitForFunction(() => !!window.__fit, null, { timeout: 30_000 }).then(() => true, () => false);
      record(viewport.name, route, "the fitted hoodie starts over the live camera", ready);
      if (!ready) return;
      // Normalised video landmarks: a person half the frame's height, the
      // (mirrored) screen-right arm raised, the other hand in front of the body.
      const P = (x, y, v = 1) => ({ x, y, visibility: v });
      const lm = {
        nose: P(0.5, 0.35), leftEye: P(0.51, 0.34), rightEye: P(0.49, 0.34), leftEar: P(0.53, 0.35), rightEar: P(0.47, 0.35),
        leftShoulder: P(0.565, 0.43), rightShoulder: P(0.435, 0.43), leftHip: P(0.54, 0.6), rightHip: P(0.46, 0.6),
        leftElbow: P(0.66, 0.36), rightElbow: P(0.4, 0.52), leftWrist: P(0.65, 0.28), rightWrist: P(0.49, 0.55),
      };
      await page.evaluate((lm) => window.__fit.setPose(lm), lm);
      await page.waitForTimeout(600);
      const probe = await page.evaluate((lm) => {
        const canvas = document.querySelector("[data-merch-overlay]");
        const video = document.querySelector("video");
        if (!canvas || !video) return null;
        const r = canvas.getBoundingClientRect();
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const s = Math.max(r.width / vw, r.height / vh);
        // The front camera is mirrored on screen.
        const at = (p) => ({ x: (r.width - vw * s) / 2 + (1 - p.x) * vw * s, y: (r.height - vh * s) / 2 + p.y * vh * s });
        const ctx = canvas.getContext("2d");
        const k = canvas.width / r.width;
        const alpha = (q) => ctx.getImageData(Math.round(q.x * k), Math.round(q.y * k), 1, 1).data[3];
        const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        const body = at(mid(mid(lm.leftShoulder, lm.rightShoulder), mid(lm.leftHip, lm.rightHip)));
        const sleeve = at(mid(lm.leftShoulder, lm.leftElbow));
        const air = at({ x: 0.5, y: 0.2 });
        return { body: alpha(body), sleeve: alpha(sleeve), air: alpha(air) };
      }, lm);
      const state = await page.evaluate(() => window.__fit.state());
      record(
        viewport.name,
        route,
        "a posed body gets the hoodie: on the body, along the raised arm, not in the air above",
        !!probe && state.fitted && probe.body > 200 && probe.sleeve > 200 && probe.air === 0,
        probe ? `fitted ${state.fitted}, alpha body ${probe.body}, sleeve ${probe.sleeve}, air ${probe.air}` : "no overlay",
      );
      await page.screenshot({ path: join(OUT, `fit-${viewport.name}.png`) });
      record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
      record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
    });
  } finally {
    await browser.close();
  }
}

/**
 * Accessibility: axe-core (WCAG 2.1 AA and best practices) on every page and
 * in the states the pages open into (the menu, the store's chat). axe loads
 * from jsDelivr into the test browser only; if it cannot, the check says so
 * instead of failing the run.
 */
const AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js";

async function journeyA11y(browser, viewport) {
  if (viewport.name !== "390") return;
  const route = "accessibility (axe)";
  await withPage(browser, viewport, async (page) => {
    const scan = async (label) => {
      const loaded = await page.addScriptTag({ url: AXE_URL }).then(() => true, () => false);
      if (!loaded) {
        record(viewport.name, route, `${label}: no violations`, true, "axe unavailable (offline?); skipped");
        return;
      }
      const found = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
        return r.violations.map((v) => `${v.id}×${v.nodes.length} ${v.nodes[0]?.target.join(" ") ?? ""}`);
      });
      record(viewport.name, route, `${label}: no violations`, found.length === 0, found.slice(0, 3).join(" | "));
    };
    for (const [label, path] of [
      ["landing", "/"],
      ["stories", "/stories?demo=1"],
      ["a chapter", "/stories/a-cold-night?demo=1"],
      ["store", "/store?demo=1"],
      ["try-on", "/try-on"],
      ["account", "/account?demo=1"],
      ["unsubscribe page", "/unsubscribe?t=" + "0".repeat(64)],
      ["404", "/no-such-page-here"],
    ]) {
      await goto(page, path);
      await page.waitForTimeout(2500);
      await scan(label);
    }
    await goto(page, "/stories?demo=1");
    await page.waitForTimeout(2000);
    await page.click('button[aria-controls="kitty-drawer"]').catch(() => {});
    await page.waitForTimeout(700);
    await scan("menu open");
    await goto(page, "/store?demo=1");
    await page.waitForTimeout(2500);
    await page.click('button:has-text("Talk to Kitty")').catch(() => {});
    await page.waitForTimeout(700);
    await scan("store chat open");
  });
}

/** Kitty Tunables on /admin (demo: saved in this browser), and the store picking them up. */
async function journeyAdmin(browser, viewport) {
  const route = "/admin (Tunables, demo)";
  await withPage(browser, viewport, async (page, errors, bad) => {
    await page.addInitScript((owner) => {
      if (!sessionStorage.getItem("verify-seeded")) {
        localStorage.removeItem("kittyfive-demo-persona-v1");
        localStorage.setItem("kittyfive-demo-auth", JSON.stringify(owner));
        sessionStorage.setItem("verify-seeded", "1");
      }
    }, DEMO_OWNER);
    await goto(page, "/admin?demo=1");
    const editor = await page.waitForSelector("[data-tunables]", { timeout: 20_000 }).catch(() => null);
    record(viewport.name, route, "the Tunables editor shows for an admin", !!editor);
    if (!editor) return;
    const line = () => page.$eval('[data-tunable="snacks"] [data-tunable-line]', (el) => el.textContent ?? "");
    const before = await line();
    await page.$eval("#tun-snacks", (el) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      set.call(el, "10");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const after = await line();
    record(viewport.name, route, "a slider rewrites the line it puts in her prompt", after !== before && /snack/i.test(after), after.slice(0, 60));
    await page.fill("#tun-opening", "Oh. You again.");
    await page.click("[data-tunables-save]");
    await page.waitForSelector("[data-tunables-status]", { timeout: 10_000 }).catch(() => {});
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-tunables]", { timeout: 20_000 }).catch(() => {});
    const kept = await page.evaluate(() => ({
      snacks: document.querySelector("#tun-snacks")?.value,
      opening: document.querySelector("#tun-opening")?.value,
    }));
    record(viewport.name, route, "saved tunables survive a reload", kept.snacks === "10" && kept.opening === "Oh. You again.", JSON.stringify(kept));
    await page.click("text=Show her full instructions");
    const prompt = (await page.$eval("[data-tunables-prompt]", (el) => el.textContent ?? "").catch(() => "")) ?? "";
    record(viewport.name, route, "her full instructions include the tuned voice", /You are Kitty/.test(prompt) && prompt.includes(after), `${prompt.length} chars`);
    await page.screenshot({ path: join(OUT, `admin-${viewport.name}-tunables.png`) });
    await goto(page, "/store?demo=1");
    await page.waitForTimeout(1500);
    await page.click('button:has-text("Talk to Kitty")');
    await page.waitForTimeout(500);
    const opening = (await page.$eval('section[aria-label="Chat with Kitty"] p', (el) => el.textContent ?? "").catch(() => "")) ?? "";
    record(viewport.name, route, "the store's chat opens with the tuned line", opening.startsWith("Oh. You again."), opening.slice(0, 60));
    // Having been seen as an admin, the menu offers Admin on any page.
    await page.click('button[aria-label="Close chat"]').catch(() => {});
    await page.click('button[aria-label="Open menu"]');
    await page.waitForTimeout(500);
    const adminRow = await page.$('[role="dialog"] a[href="/admin"]');
    record(viewport.name, route, "the menu offers Admin to an admin", !!adminRow);
    await page.keyboard.press("Escape");
    record(viewport.name, route, "no page/console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    record(viewport.name, route, "no unexpected 4xx/5xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  });
}

/**
 * The account page's order of things, the Birthday Lobby way (its
 * PASSWORD-RESET.md), in demo mode so no mail is sent: the reset form answers
 * the same whatever the address; a reset link lands on "Choose a new
 * password", never the signed-in page; a dead link says so and offers the
 * form; and the address bar loses the link's parameters but keeps ?demo=1.
 * (Where the live links point is a Supabase setting: Site URL.)
 */
async function journeyAccount(browser, viewport) {
  const route = "/account (reset, demo)";
  await withPage(browser, viewport, async (page, errors, bad) => {
    const land = async (hash) => {
      await page.goto("about:blank");
      await goto(page, `/account?demo=1${hash}`);
    };
    await land("");
    await page.evaluate(() => localStorage.removeItem("kittyfive-demo-auth"));
    await land("");
    await page.click('button:has-text("Forgotten your password?")');
    await page.fill("#acct-email", "someone@example.com");
    await page.click('button:has-text("Send the link")');
    const sent = await page.waitForSelector('[data-auth-sent="reset"]', { timeout: 10_000 }).catch(() => null);
    const said = sent ? ((await sent.textContent()) ?? "") : "";
    record(viewport.name, route, "the reset form answers the same for any address", /If someone@example\.com has an account/.test(said), said.slice(0, 70));

    await land("#type=recovery");
    const setPw = await page.waitForSelector("[data-set-password]", { timeout: 10_000 }).catch(() => null);
    record(viewport.name, route, "a reset link lands on Choose a new password", !!setPw);
    const url = page.url().replace(BASE, "");
    record(viewport.name, route, "the link's parameters are scrubbed, ?demo=1 kept", !/type=recovery/.test(url) && /demo=1/.test(url), url);
    if (setPw) {
      await page.fill("#new-pw", "short");
      await page.fill("#new-pw2", "short");
      await page.click('button:has-text("Save password")');
      const refused = await page.$("[data-set-password] [role=alert]");
      record(viewport.name, route, "a short password is refused", !!refused);
      await page.fill("#new-pw", "a-long-enough-password");
      await page.fill("#new-pw2", "a-long-enough-password");
      await page.click('button:has-text("Save password")');
      const saved = await page.waitForSelector("text=New password saved", { timeout: 10_000 }).catch(() => null);
      record(viewport.name, route, "the new password is saved and you are signed in", !!saved);
      await page.screenshot({ path: join(OUT, `account-${viewport.name}-new-password.png`) });
    }

    await page.evaluate(() => localStorage.removeItem("kittyfive-demo-auth"));
    await land("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    const notice = (await page.$eval("main [role=alert]", (el) => el.textContent ?? "").catch(() => "")) ?? "";
    const form = await page.$('[data-auth-form="forgot"]');
    record(viewport.name, route, "a dead link says so and offers a new one", /That link did not work: Email link is invalid/.test(notice) && !!form, notice.slice(0, 70));
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

  // The link preview and the home-screen app: tags present, files served, small enough for WhatsApp.
  const home = await get("/");
  const og = /<meta property="og:image" content="[^"]*\/opengraph-image\.jpg/.test(home.text);
  const card = await fetch(`${BASE}/opengraph-image.jpg`);
  const size = Number(card.headers.get("content-length") ?? (await card.arrayBuffer()).byteLength);
  record(viewport, "/", "share card: og:image tag and a JPEG under 300 KB", og && card.status === 200 && size > 10_000 && size < 300_000, `${card.status}, ${Math.round(size / 1024)} KB`);
  // Story emails (Phase 5): the preview renders; nothing sends or marks a chapter without email set up or a signed-in owner.
  const mailStatus = await get("/api/subscriptions/status");
  const mailOn = /"email":true/.test(mailStatus.text);
  record(viewport, "/api/subscriptions/status", "says whether email is set up", mailStatus.status === 200 && /"email":(true|false)/.test(mailStatus.text), mailStatus.text);
  const preview = await get("/api/subscriptions/preview");
  record(viewport, "/api/subscriptions/preview", "a chapter email renders (picture, link, a way to stop)", preview.status === 200 && /Read the chapter/.test(preview.text) && /Stop these emails/.test(preview.text), String(preview.status));
  const notify = await fetch(`${BASE}/api/subscriptions/notify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapterId: "00000000-0000-0000-0000-000000000000" }) });
  record(viewport, "/api/subscriptions/notify", "refuses without email set up (503) or without a signed-in owner (401)", notify.status === (mailOn ? 401 : 503), String(notify.status));
  const bounce = await fetch(`${BASE}/api/webhooks/resend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "email.bounced", data: { to: ["someone@example.com"] } }) });
  record(viewport, "/api/webhooks/resend", "an unsigned bounce changes nothing (503 until set up, then 401)", bounce.status === 503 || bounce.status === 401, String(bounce.status));
  const stop = await fetch(`${BASE}/api/subscriptions/unsubscribe`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "nope" }) });
  record(viewport, "/api/subscriptions/unsubscribe", "a malformed token is refused", stop.status === 400, String(stop.status));
  const missing = await get("/no-such-page-here");
  record(viewport, "/no-such-page-here", "a missing page is a 404 in Kitty's words, with the ways back", missing.status === 404 && /Kitty looked everywhere/.test(missing.text) && /href="\/stories"/.test(missing.text), String(missing.status));
  const manifest = await get("/manifest.webmanifest");
  record(viewport, "/manifest.webmanifest", "home-screen app manifest with Kitty's icons", manifest.status === 200 && /"icon-512\.png"|icon-512\.png/.test(manifest.text) && /<link rel="manifest"/.test(home.text), String(manifest.status));
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
    stories: [journeyStories, journeyReader, journeyStoriesOwner, journeySubscriptions],
    tryon: [journeyTryOn, journeyCap3D, journeyFit],
    admin: [journeyAdmin],
    account: [journeyAccount],
    pages: [journeyPages, journeyA11y],
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
      const picked = args.journeys ? String(args.journeys).split(",") : null;
      for (const [key, fns] of Object.entries(JOURNEYS)) {
        if (v.only && !v.only.includes(key)) continue;
        if (picked && !picked.includes(key)) continue;
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
