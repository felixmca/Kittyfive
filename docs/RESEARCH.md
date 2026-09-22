# Kitty — Technical Research Report

Research performed 2026-09-21, adversarially verified 2026-09-22. Every option below carries a URL that was actually opened (browser pane, WebFetch, curl or npm registry) or a note saying it could not be. Where the verifier revised a recommendation, the revised version is what appears here.

**Currency note.** Vendors quote in GBP, USD and EUR. GBP figures marked "≈" were converted at an assumed £1 = US$1.30 = €1.17. That rate was not fetched; re-check on the day of purchase. Figures without "≈" were quoted in GBP by the vendor.

**Status labels used throughout:** *verified* (read on a primary page or measured locally), *corroborated* (two or more independent secondary sources, primary unreadable), *unverified* (single secondary source or inference), *refuted* (the original research said something the verifier showed to be wrong), *login-gated* / *bot-blocked* (primary page returned a login wall or HTTP 403 to the fetcher).

---

## TL;DR — the chosen stack

1. **Scroll engine:** native page scroll + `lenis@1.3.26` (syncTouch:false, RAF driven by `gsap.ticker`) + `gsap@3.15.0` ScrollTrigger (100% free incl. all plugins) owning every timeline; `@react-three/fiber@9.7.0` + `@react-three/drei@10.7.8` + `three@0.186.0` for one fixed full-viewport canvas fed by a per-scene `progress` ref; drei ScrollControls is not used on the mixed DOM+3D page.
2. **Story clips:** never `video.currentTime` on iOS. Each artta.ai clip becomes a 12 fps, 720×1280 WebP q80 frame folder (~1.5–4 MB per 5 s scene) drawn on one pinned canvas per scene with a sliding window of 12–16 decoded ImageBitmaps (≈45–60 MB), lazy-loaded per scene; 300 MB is the page-memory ceiling.
3. **Story generation:** artta.ai, Kling 3.0 with a "Kitty" Element (3–4 real Canon 750D photos) + first/last frame as the consistency engine, Veo 3.1 (10 credits / 8 s) for cheap establishing shots, Wan 2.7 (40 credits / 5 s) for bookended transitions; all 9:16, 5 s, 720p drafts. Budget on the **monthly** Pro plan ($39.90 ≈ £30.70 for 500 credits) or annual Pro ($238.80 ≈ £184 up front for 4,200 credits) — the $19.90/350 "monthly" price in the first draft was an annual-billing price.
4. **3D Kitty:** Quaternius CC0 cat from Poly Pizza (`qKICY6xla2`, 238,672 B, 2,448 tris, 16 joints, 8 baked clips), atlas repainted to tuxedo in Blender, gltf-transform compressed; clip names are prefixed `AnimalArmature|AnimalArmature|AnimalArmature|Walk` and must be renamed.
5. **Print-on-demand:** Printful, forcing its UK centre (Headway Road, Wolverhampton, opened 23 Mar 2022, marketed as "Birmingham", fulfils UK addresses only) for the embroidered cap, embroidered hoodie and Kornit water-based DTG long sleeve (explicitly not DTF). API v1 behind an adapter with v2 paths ready. Fallback Inkthreadable (Blackburn, polling-only API). A true screen print is only possible as a Stripe pre-order batch with a London printer (3rd Rail Clothing, SE16).
6. **Payments:** Stripe hosted Checkout Sessions (mode=payment, GBP, pre-created Prices, GB shipping, ≤5 flat shipping options, no `payment_method_types` so Apple Pay/Google Pay/Onelink appear without domain registration), fulfilment only from a signature-verified `checkout.session.completed` webhook in a Node-runtime Next.js 16 route handler, POD submission deferred with `after()`. `stripe@22.6.2` pins API `2026-08-26.dahlia`. £1 snack costs exactly 22p in fees (78p net).
7. **Backend/hosting:** Supabase Pro (London, $25 ≈ £19.25/mo — Free pauses after 7 idle days and would silently kill webhooks), Vercel Pro ($20 ≈ £15.40/seat/mo — Hobby forbids commercial use and caps crons at once per day), Functions region `lhr1`, Resend free tier (3,000 emails/mo) for tracking emails.
8. **Cat tracking:** Apple has no Find My read API and every real-AirTag route needs an iPhone plus a Mac on macOS ≤15. Near-term pick is a static-MAC iBeacon on the collar (BeaconZone E8 £24.58 or PC038 £15.05) + 3 identical ESPresense ESP32-C3/S3 nodes (£10–21) + Mosquitto and a Python zone-resolver on the Pi 4 writing to Supabase, browser subscribing via Realtime `postgres_changes`.
9. **Room scan:** Canon 750D photos → RealityScan 2.2 (free under US$1M revenue) for mesh, scale and its native COLMAP export (since 2.1.1) → LichtFeld Studio (NVIDIA RTX 20+) or Brush 0.3 (any GPU) for a Gaussian splat → SuperSplat 3.0 (WebGPU) cleanup → SOG → `@sparkjsdev/spark@2.2.0` in R3F with a 30–50k-tri RealityScan collider; Spark's own budgets: Android 1M, iOS 1.5M, desktop 2.5M splats.
10. **WebAR try-on:** no WebXR on iOS Safari in 2026, so MediaPipe Tasks Vision (Apache-2.0, pin `@mediapipe/tasks-vision@0.10.17` to match drei) inside the existing R3F canvas over a `getUserMedia` video: Face Landmarker matrix for the cap, Pose Landmarker torso for hoodie/long sleeve, One Euro smoothing, feet-derived floor plane for Kitty. Paid upgrade path: Snap Camera Kit Web (free, application-gated) for cloth-simulated garments.

**Recurring cost floor at launch:** Vercel Pro ≈ £15.40 + Supabase Pro ≈ £19.25 + artta Pro ≈ £30.70 (production months only) ≈ **£65/month**, plus Stripe 1.5% + 20p per UK card transaction and Printful per-order product + shipping. One-off hardware ≈ £30–50 for the tracker.

---

## 1. Viral scroll / 3D front-end libraries (`viral-js`)

### Decision
GSAP 3.15.0 + ScrollTrigger (with Flip, SplitText, Observer as needed) via `@gsap/react@2.1.2`, Lenis 1.3.26 for desktop wheel smoothing with `syncTouch:false` on iOS, React Three Fiber 9.7.0 + drei 10.7.8 + three 0.186.0 for real 3D, Motion 13.4.0 only where a copied Aceternity/Magic UI/ReactBits component needs it (capped with `LazyMotion`). Story clips are shipped as scroll-scrubbed WebP (AVIF optional) frame sequences on a pinned `<canvas>`. The 360° "swipe to spin Kitty" is a 36–72-frame photo turntable served through `@cloudimage/360-view@4.10.0` or a ~60-line canvas + `@use-gesture/react@10.3.1` drag hook.

Architecture: one RAF loop (`lenis.on('scroll', ScrollTrigger.update); gsap.ticker.add(t => lenis.raf(t*1000)); gsap.ticker.lagSmoothing(0)`), one fixed full-viewport R3F `<Canvas frameloop="demand">` behind the DOM, a `progress` ref per scene written in ScrollTrigger `onUpdate` and read in `useFrame`. On touch: `if (ScrollTrigger.isTouch === 1) { ScrollTrigger.normalizeScroll(true); ScrollTrigger.config({ ignoreMobileResize: true }); }`. Respect `prefers-reduced-motion` by swapping sequences for three stills per scene.

### Runner-up
Motion 13.4.0 `useScroll`/`useTransform` as the sole scroll engine (declarative, defers to native ScrollTimeline). Rejected as primary because it lacks pin/scrub/snap semantics for the frame-sequence scenes and every ScrollTrigger recipe (Apple AirPods pattern, OPTIKKA, swecflow) is what the verified case studies used.

### Comparison table

| Option | Version (npm, date) | Licence / price | Size (gz) | Verdict |
|---|---|---|---|---|
| GSAP + ScrollTrigger | 3.15.0 (2026-04-13) | Standard "no charge" licence, commercial OK, all plugins | core 28.3 KB, ScrollTrigger 18.0, Flip 9.7, SplitText 3.7 | **Pick** |
| Lenis | 1.3.26 (2026-09-18) | MIT | 5.5 KB | **Pick** (syncTouch:false) |
| R3F + drei + three | 9.7.0 / 10.7.8 / 0.186.0 | MIT | large; needed anyway | **Pick**; no ScrollControls on mixed page |
| Motion (framer-motion) | 13.4.0 (2026-09-16) | MIT | 34 KB full, 4.6 KB LazyMotion | Secondary, for registry components |
| Frame sequence on canvas | hand-rolled | none | 0 | **Pick** for story clips |
| ScrollyVideo.js | 0.0.24 (2025-03-07) | MIT | 5.3 KB | Desktop-Chrome hero only; iOS path is broken `<video>` |
| Aceternity UI (free tier) | copy-paste via shadcn CLI | free components MIT (via snippet); Pro $199 ≈ £153 lifetime | n/a | Use individual free components |
| Magic UI | shadcn registry | MIT; Pro $199 ≈ £153 | n/a | Marquee (CSS-only), mockups |
| ReactBits | shadcn/jsrepo | MIT + Commons Clause | n/a | ScrollStack, TiltedCard; not the unrelated npm `react-bits` |
| 21st.dev | registry | free 2 copies/day; from $6 ≈ £4.60/mo | n/a | Inspiration index only |
| @cloudimage/360-view | 4.10.0 (2026-08-26) | MIT | ≈43 KB | Turntable widget (or hand-roll ~3 KB) |
| react-parallax-tilt | 1.7.343 (2026-09-16) | MIT | 2.9 KB | Merch tilt cards, `gyroscope` after tap |
| react-fast-marquee | 1.6.5 (2024-07-01) | MIT | 2.4 KB | Unmaintained; prefer CSS marquee |
| ogl / curtains.js / gpu-curtains | 1.0.11 / 8.1.6 / 0.16.3 | Unlicense / MIT / MIT | 29 KB / 23.5 KB | Skip: second GL context next to R3F |
| Spline | react-spline 4.1.0, runtime 2.0.55 | Free = watermark; $12–60 ≈ £9–46/mo | multi-MB | Skip |
| Theatre.js | 0.7.2 (2024-05-19) | Apache-2.0 core, AGPL studio | n/a | Skip: frozen, private 1.0 |
| Rive | react-canvas 4.34.3 | MIT runtime; editor from $9 ≈ £7/seat | 52.7 KB | Optional 2D cartoon Kitty only |
| CSS scroll-driven animations | Safari 26+ | web platform | 0 | Cheap reveals with ScrollTrigger fallback |
| @sparkjsdev/spark | 2.2.0 (2026-09-11) | MIT | n/a | GLB/splat phase (see §4) |
| r3f-scroll-rig / react-scroll-parallax | 8.15.0 (2024-12) / 3.5.0 | ISC / MIT | 8.3 / 3 KB | Skip / optional |

### Verified facts
- GSAP is 100% free including SplitText and MorphSVG; the only prohibited use is inside no-code animation builders competing with Webflow; AI-generated GSAP code is explicitly allowed. https://gsap.com/standard-license/ , https://gsap.com/pricing/ , https://registry.npmjs.org/gsap/latest (3.15.0, timestamp = 2026-04-13).
- iOS `<video>` scrubbing needs `playsinline` + autoplay→`loadeddata`→pause priming (https://gsap.com/community/forums/topic/36208-scrub-video-on-scroll-ios/); ScrollyVideo's README says its WebCodecs path is Chrome-only, its `currentTime` fallback needs keyframe=1 encodes, and iOS battery saver blocks it with no workaround (https://raw.githubusercontent.com/dkaoster/scrolly-video/main/README.md); LICENSE is MIT.
- WebKit memory: decoded images evicted at the 65% "Strict" level, page reloads at 100%; budgets ≈300–350 MB (iPhone 8/X), 400–450 MB (iPhone 13/14), 1 GB+ (iPhone 15+). https://www.catchmetrics.io/blog/deep-dive-ram-internals-webkit . Total-canvas limit 384 MB on iOS 15, max canvas 4096² (https://pqina.nl/blog/total-canvas-memory-use-exceeds-the-maximum-limit/); 224 MB on iOS 12 (https://developer.apple.com/forums/thread/112218). 720×1280×4 = 3,686,400 B ≈ 3.7 MB per decoded frame.
- Shipped sequences: swecflow — 96 WebP q70 frames at 12 fps from an 8 s Veo clip = 4.8 MB, DPR cap 2, IntersectionObserver rootMargin 200%, stills below 810 px and for reduced motion (https://www.swecflow.com/blog/apple-style-scroll-animation-ai-images/). OPTIKKA — abandoned `<video>` for stutter/autoplay reasons, 880 mobile / 1,182 desktop WebP q80 frames, first 10 loaded then 5 ahead/behind (https://tympanus.net/codrops/2025/10/16/creating-smooth-scroll-synchronized-animation-for-optikka-from-html5-video-to-frame-sequences/). GSAP forum member: PNG→WebP took a hero sequence from 21 MB to 4 MB after iPhone crashes (https://gsap.com/community/forums/topic/25188-airpods-image-sequence-animation-using-scrolltrigger/).
- Lenis README: `syncTouch` default false ("can be unstable on iOS<16"), `autoRaf` default false, GSAP integration snippet as above (https://raw.githubusercontent.com/darkroomengineering/lenis/main/README.md). drei ScrollControls "create an HTML scroll container in front of the canvas" (https://drei.docs.pmnd.rs/controls/scroll-controls).
- Safari 26.0 (WebKit post dated 2025-09-15) shipped CSS scroll-driven animations, WebGPU, and completed WebCodecs by adding AudioEncoder/AudioDecoder (https://webkit.org/blog/17333/webkit-features-in-safari-26-0/). VideoDecoder has been in iOS Safari since 16.4 as "partial" WebCodecs (https://caniuse.com/webcodecs). AVIF: iOS 16.0 partial, 16.4 full (https://caniuse.com/avif). `requestVideoFrameCallback` since Safari 15.4 (https://caniuse.com/mdn-api_htmlvideoelement_requestvideoframecallback).
- Motion bundle sizes: full `<motion>` 34 KB, LazyMotion + `m` 4.6 KB + 15/25 KB feature packs (https://motion.dev/docs/react-reduce-bundle-size).
- Aceternity pricing: Annual $169 ≈ £130, Lifetime $199 ≈ £153, Team $1,590 ≈ £1,223 (https://ui.aceternity.com/pricing). Spline: Free watermarked, Hobby $12, Pro $25, Max $60 ≈ £9/£19/£46 per month (https://spline.design/pricing). Rive: Free, Cadet $9, Voyager $32, Enterprise $120 per seat/mo (https://rive.app/pricing). 21st.dev: free 2 copies/day, Builder $6–8/mo (https://21st.dev/pricing).

### Refuted or unsourced claims (do not repeat)
- "WebCodecs is Chrome-only" — false as a platform statement. Only ScrollyVideo gates its WebCodecs mode to Chrome; iOS Safari has had VideoDecoder since 16.4. A hand-rolled WebCodecs→canvas path is possible on iOS 16.4+ but not worth it (same memory budget, more edge cases).
- "Keyframe=1 MP4s are ~5× larger" and "frames appear tens of ms after `seeked`" — unsourced estimates; the qualitative conclusion (reject `<video>` scrubbing on iOS) stands on the ScrollyVideo README and GSAP forum 36208.
- "Practical page budget ≈300–350 MB on most iPhones" — that is the iPhone 8/X tier; the source says 300–450 MB for most devices in use. Designing to 300 MB is conservative and still correct.
- The catchmetrics URL originally cited (`understanding-ios-webkit-memory-limits-a-complete-guide`) is login-gated; cite the `deep-dive-ram-internals-webkit` article instead.
- "Safari 26.0 shipped full WebCodecs" — precisely, 26.0 added the audio half; video decode predates it.

### Unknowns still open
- artta.ai export specs (fps, codec, whether last-frame seeding/"extend" is offered) — not fetched; chaining plan assumes image-to-video from an uploaded still (see §8).
- Per-device kill thresholds vary widely (a 100 MB crash was measured in an extension context on iPhone SE 3); treat 300 MB as the ceiling until measured on the owner's phones.
- AVIF vs WebP decode speed on A12/A13 iPhones — undocumented; device test before choosing AVIF-first.
- Bundle sizes for ogl, react-parallax-tilt, react-fast-marquee, @cloudimage/360-view came from gzipping tarball dist files, not a tree-shaken Next.js build.
- react-fast-marquee / react-scroll-parallax compatibility with React 19.3 / Next 16.3 untested.
- Aceternity's free-component MIT status was confirmed via a search snippet, not a licence page. 21st.dev components carry per-author licences.
- Which Spline tier removes the watermark on a hosted `.splinecode` embedded via react-spline — untested; @splinetool/runtime has no licence field on npm.

### Cost (GBP)
- All picked libraries: £0.
- Optional: Aceternity Pro £153 one-off; Magic UI Pro £153 one-off; Spline Hobby ≈ £9/mo (not recommended); Rive editor from ≈ £7/seat/mo (only if a 2D cartoon Kitty is wanted).

---

## 2. UK print-on-demand for cap, hoodie, long sleeve (`pod-uk`)

### Decision
**Printful**, routed to its UK facility (Antar 2, 1 Headway Road, Wolverhampton WV10 6PZ; officially opened 23 March 2022; marketed on printful.com/uk as the "Birmingham" facility; fulfils UK-address orders only). It is the only provider covering cap embroidery, hoodie embroidery and a Kornit water-based DTG long sleeve from a UK factory while exposing variant, shipping-rate, order, confirm, webhook and mockup endpoints. Build against API v1 today behind an adapter, because the v2 docs urge migration and warn v1 "may be phased out in the future"; keep the v2 Open Beta paths ready. Select DTG placements explicitly — DTF is in the UK catalogue and Printful itself says DTF "has a slightly plasticky feel at first".

Products: Classic Dad Hat Yupoong 6245CM (embroidery) £12.25 verified; Gildan 18500 hoodie (embroidery collection) and Bella+Canvas 3501 long sleeve (DTG) — read prices from `GET /products/{id}` at build time, the £17.75 / £13.77 page figures could not be re-verified. UK shipping: hats £3.39 + £1.20 each extra, hoodies £5.19 + £1.85, tees/long sleeves £3.69 + £1.20.

**Screen print reality:** no UK POD screen prints on demand. Either accept water-based Kornit DTG on 100% cotton with a 1–2 colour vector design and no large solid fills, or run the long sleeve as a Stripe pre-order ("ships in ~4 weeks"), close at 25–50 units, and place one batch with 3rd Rail Clothing (SE16 4DU, water-based and discharge inks), Live Ink (Bristol, 20-unit minimum, GOTS water-based) or Fifth Column (Tottenham Hale). Cap and hoodie stay on Printful throughout.

### Runner-up
**Inkthreadable** (Blackburn). Better UK-native brand story and cheaper caps, all prices inclusive of VAT, Kornit Atlas Max water-based DTG, but its API is orders-only (SHA1 signature) with no webhook, catalogue or shipping-quote endpoint — poll `GET /api/orders.php?since_id=` on a Vercel cron. Ask support whether API items can reference dashboard-created embroidered products before adopting.

### Comparison table

| Provider | UK production | Cap embroidery | Hoodie embroidery | Long sleeve method | API quality | Verdict |
|---|---|---|---|---|---|---|
| Printful | Own Wolverhampton centre (2022) | Yes, £12.25 | Yes (price via API) | Kornit DTG (avoid DTF) | v1 stable + v2 beta, webhooks, mockups | **Primary** |
| Inkthreadable | Blackburn | Yes, £9.25–£21.11 | Yes, JH001 £19.10 | Kornit Atlas Max DTG, £15.93 | Orders-only, SHA1, no webhooks | **Fallback** |
| Printify (6 UK partners) | Partner-dependent | Unverifiable in UK | Unverifiable in UK | DTG | Best-documented, HMAC webhooks | Third option after catalog check |
| Teemill | Isle of Wight | POD caps exist; embroidery for sellers unverified | No embroidery evidence | DTG | JS-only docs, unreadable | Candidate for organic cap only |
| Gelato | Global; UK embroidery unverified | ? | ? | ? | docs 403 | Unverified |
| Prodigi | UK HQ | No caps | No embroidery | DTG | Clean v4 API + sandbox | Fails 2 of 3 products |
| Two Fifteen | Bispham | Caps page 404 | Not visible | DTG/DTF | Swagger JS-only | Unverified |
| Print Clever | Swindon | No embroidery listed | No | Not listed | No public docs | Not a fit |
| Printed.com | UK | No | No | n/a | None | Not a fit |
| Everpress | Campaign model | n/a | n/a | Screen print if ≥20 sales, else DTG | No API | Cannot sit behind own cart |
| 3rd Rail Clothing (SE16) | London | Yes (batch) | Yes (batch) | Water-based screen print (batch) | None (quote) | **Pre-order batch partner** |
| Live Ink (Bristol) | UK | Headwear listed | Yes | Screen print from 20 units, GOTS inks | Platform plugins only | Batch alternative |
| Fifth Column (N17) | London | Yes (batch) | Yes (batch) | Screen print (batch) | None | Batch alternative |
| Clothes2Order | Manchester | Yes | Yes | Screen print only 500–1,000+ pcs | Login-gated docs | Workwear-oriented; skip |

### Verified facts
- Printful UK facility opened 23 March 2022 (https://printwearandpromotion.co.uk/printful-officially-opens-wolverhampton-facility/); Printful pages call it the "Birmingham" facility with 2–5 business-day fulfilment (https://www.printful.com/uk/print-on-demand , https://www.printful.com/uk/dropshipping). Techniques: embroidery, DTG, DTF, sublimation, all-over print. Dad hat £12.25 from JSON-LD on https://www.printful.com/uk/custom/embroidered/dad-hats/classic-dad-cap-yupoong-6245cm . Shipping table https://www.printful.com/uk/shipping . Kornit water-based DTG and DTF "plasticky" remark: https://www.printful.com/blog/dtg-vs-dtf-printing .
- Printful API v1 (https://developers.printful.com/docs/): `GET /products/{id}`, `POST /shipping/rates`, `POST /orders`, `POST /orders/{id}/confirm`, `POST /webhooks` (14 types incl. package_shipped, order_failed, order_canceled), `POST /mockup-generator/create-task/{id}`, Bearer token + `X-PF-Store-Id`, 120 calls/min. v2 Open Beta (https://developers.printful.com/docs/v2-beta/): `/v2/catalog-products/{id}/catalog-variants`, `/v2/catalog-variants/{id}/prices`, `/v2/shipping-rates`, `/v2/orders`, `/v2/orders/{id}/confirm`, `/v2/webhooks` (HTTPS-only, signed), `/v2/mockup-tasks`; no GA date; text says migrate, v1 "may be phased out".
- Inkthreadable: caps £9.25–£21.11 incl. VAT (https://www.inkthreadable.co.uk/caps); AWDis College JH001 £19.10, AWDis Organic £29.40, Stanley/Stella Cruiser 2.0 £36.42 (https://www.inkthreadable.co.uk/hoodies); Stanley/Stella Creator 2.0 Long Sleeve £15.93 (https://www.inkthreadable.co.uk/t-shirts); Kornit Atlas Max (https://www.inkthreadable.co.uk/direct-to-garment); digitising £12.60 per design, 10×10 cm apparel, 12×5 cm caps, 6 colours, premium threads +£0.99 (https://help.inkthreadable.co.uk/en/articles/598083-embroidery-design-guidelines); shipping RM48 £2.88 / £3.78 / £6.29, RM24 £3.48 / £4.98 / £7.38, DX courier £11.99, 3–5 working days (https://www.inkthreadable.co.uk/shipping-costs); API endpoints `GET/POST/DELETE /api/orders.php`, `GET /api/order.php`, `GET /api/orders/count.php`, `AppId` + `Signature=SHA1(body+secret)` query params (https://help.inkthreadable.co.uk/en/articles/429293-api-request-endpoints).
- Printify UK partners: T-shirt and Sons, Print Clever, Harrier, Expert Workwear, Jondo, Colorway (https://printify.com/print-on-demand/uk/); embroidered hats "from $11.57", no provider names (https://printify.com/custom-embroidered-hats/); rate limits 600/min global, 100/min catalog; store type "API" under My Stores (https://developers.printify.com/ , https://developers.printify.com/docs/openapi.json).
- Prodigi catalogue has no caps/hats or embroidery (https://www.prodigi.com/products/); API reference https://www.prodigi.com/print-api/docs/reference/ .
- Everpress screen-print threshold: 20+ sales for one-colour front on the Classic Tee (https://everpress.com/creator-toolkit/how-many-sell-design-screen-printed/). Live Ink: 20-garment minimum for screen print, no API (https://live.ink/). Clothes2Order: "usually only ... over 500 pieces" and "only ... 1000 pieces or more" both appear (https://www.clothes2order.com/pages/screen-printing). 3rd Rail: https://3rdrailclothing.co.uk/london-t-shirt-printing/ . Fifth Column: https://fifthcolumn.co.uk/ .
- Teemill sells POD hats and caps (https://teemill.com/print-on-demand-hats/); a Teemill-hosted store carries an embroidered cap (https://tmill-swag-store.teemill.com/product/teemill-icon-cap/).

### Refuted claims (do not repeat)
- **"Printful's Wolverhampton centre opened March 2023"** — refuted; it opened 23 March 2022, and Printful markets it as its Birmingham facility.
- **"Printful hoodie £17.75 and long sleeve £13.77"** — unverifiable on re-fetch (pages rendered without price markup). Do not hard-code; read from the API. VAT treatment still unstated.
- **"Teemill has no caps"** — refuted; Teemill sells POD caps. Embroidery for third-party sellers remains unverified.
- **"Clothes2Order screen prints from ~500 pieces"** — understated; its page says both "over 500" and "1000 pieces or more".
- **"Print Clever lists screen printing"** — could not be reproduced; neither printclever.com nor its API page mentions any print method as of 2026-09-22.
- **"Inkthreadable free digitising"** — the "free digitising" page is an expired Sept-2021 promo; the current fee is £12.60 per design.
- **"Printful v1 has no deprecation notice"** — v1 has no sunset date, but the v2 docs contain a soft-deprecation warning.
- Printify store type is labelled "API", not "Custom integration", in Printify's own docs.

### Unknowns still open
- Whether any Printify UK-located provider embroiders cap/hoodie blueprints (needs an authenticated `GET /v1/catalog/blueprints/{id}/print_providers.json`).
- Whether Inkthreadable's API can order dashboard-created embroidered products; whether an undocumented webhook exists.
- Whether each Printful SKU is actually routed to Wolverhampton (stock-dependent) — place one draft order per SKU and inspect the response; help.printful.com was 403.
- Gelato UK embroidery inclusion and endpoint paths (dashboard docs 403). Two Fifteen API/auth/webhooks (Swagger JS-only). Teemill Orders API schema and embroidery access.
- VAT treatment of Printful UK base prices (Inkthreadable incl. VAT, Two Fifteen ex VAT).
- London batch screen-print pricing (3rd Rail, Fifth Column) is quote-only.
- Printify webhook `X-Pfy-Signature` (`sha256=` HMAC-SHA256 hex of raw body) is corroborated by a docs snippet and a third-party implementation, not read from the official page — test against a real event.

### Cost (GBP)
- Printful base: cap £12.25; hoodie and long sleeve TBD via API (page showed £17.75 / £13.77, unverified). Shipping £3.39 / £5.19 / £3.69 first item. Digitisation free (Printful). No subscription.
- Inkthreadable base: cap £11.56–£15.22 (Beechfield Ultimate 5-Panel / Flexfit Snapback), JH001 hoodie £19.10, Creator 2.0 long sleeve £15.93, all incl. VAT; digitising £12.60 per design one-off; RM48 from £2.88.
- Screen-print batch: quote-only (3rd Rail, Fifth Column); Live Ink one-off DTG from £11.25 tee / £24.72 hoodie incl. VAT for reference.

---

## 3. Cat tracking: AirTag, Find My and room-level presence (`airtag`)

### Decision
**Do not build on AirTag.** Apple publishes no API for reading AirTag/Find My item locations, and every real-AirTag route requires an iPhone to pair, an Apple ID with 2FA, an anisette server, and a Mac on macOS ≤15 to export keys (macOS 26 blocked). Near-term (~£30–50, no Apple/Google accounts):

1. Collar: static-MAC iBeacon — BeaconZone E8 (£24.58, 8 g, 5 mm) or PC038 (£15.05 / £11.99 without battery) from beaconzone.co.uk, or Blue Charm BC021 via Amazon/eBay UK (~$19.45 ≈ £15; Blue Charm no longer ships internationally under 500 pcs). Advertise at 300–500 ms, 0 dBm; silicone AirTag-style sleeve because cats dunk collars.
2. Scanners: 3 identical ESP32-C3/S3 boards flashed with ESPresense v4.0.6 via browser flasher (Pi Hut ESP32-C3 Zero £3.40, sold out at fetch; Tinkerverse ESP32-C3 SuperMini £6.99 per snippet); living room, kitchen, garden door; the Pi 4's own Bluetooth is a free fourth sensor. Same model, same batch (clones differ by several dB).
3. Pi 4: Mosquitto + Python zone-resolver (paho-mqtt) subscribing to `espresense/devices/<id>/<room>`, nearest-node with hysteresis (~1 m lead for ~10 s), "outside" after 60 s silence, "asleep" when RSSI flat 20+ min; upsert `kitty_state {zone, confidence, per_node_rssi, updated_at}` and insert `kitty_positions` via PostgREST with a service-role key in the Pi's env. Write on zone change + 30 s heartbeat.
4. Web: R3F room scene maps zone → anchor Vector3 in the scanned GLB; client subscribes to `postgres_changes` on `kitty_state` (anon RLS read policy); `/api/kitty` cached fallback if the 200 free Realtime connections saturate.
5. Click-not-code alternative: Home Assistant Container on Raspberry Pi OS + ESPHome `bluetooth_proxy` + Bermuda + `rest_command` to Supabase.

### Runner-up
Real AirTag via **hass-FindMy** (PR #53 merged 21 Sep 2026: local rolling-key matching of real AirTags through ESPHome proxies, plus 15-min Find My cloud polling). Only if the owner has BOTH an iPhone and a Mac on macOS ≤15; budget for Apple auth breakages (early-Sept 2026 GSA 503 block, fixed in FindMy.py v0.10.2 on 14 Sep 2026). Airpinpoint is the same key-export mechanism sold as a service at $11.99–14.99 ≈ £9.20–11.50/tag/month with a calculator floor of ~$750 ≈ £577/month.

### Comparison table

| Option | What it gives | Requirements | Cost | Verdict |
|---|---|---|---|---|
| Apple Find My (official) | Nothing programmatic; Share Item Location is auth-gated, lost-item-only, 7-day expiry | — | AirTag 2 £29 | No API |
| Airpinpoint | Hosted REST/webhooks for own AirTags | Mac on macOS 11–14.x for BeaconStore export | $11.99–14.99/tag/mo ≈ £9.20–11.50; ~$750/mo floor | Skip |
| FindMy.py 0.10.2 | Decrypt real-AirTag reports on the Pi | iPhone + Mac ≤15 for key export, Apple ID 2FA, anisette | Free | Only with Apple hardware |
| hass-FindMy (PR #53) | Local BLE identification of real AirTags + cloud fixes | Same + Home Assistant | Free | Runner-up |
| OpenHaystack | Custom beacons only; Mail plugin dead on macOS 14+ | Mac | Free | Dead |
| macless-haystack | Custom ESP32/nRF beacons, no Apple hardware | Docker, Apple ID SMS 2FA | Free | Outdoor only, not rooms |
| ESPresense 4.0.6 | Per-node distance to MQTT | 3× ESP32 + broker | £10–21 boards | **Pick** |
| Bermuda (HA) | Area sensors from ESPHome proxies | Home Assistant | Free | Alternative UI |
| BeaconZone E8 / PC038 | Collar iBeacon | — | £24.58 / £15.05 | **Pick** |
| Tractive CAT 6 Mini | GPS device_tracker via reverse-engineered aiotractive | Subscription mandatory | £59 + £4.50/mo (2-yr Basic) or £7/mo (1-yr) | Later "roaming" beat only |
| Weenect XS | GPS via community aioweenect | Subscription | £39.99 + £4.59/mo (2-yr) or £6.67/mo (1-yr), £13 monthly | Later only |
| Pawfit | Reverse-engineered, one ban report, Feb-2026 API hardening | — | n/a | Avoid |
| Google FMDN (GoogleFindMyTools) | Experimental; no ARM auth | Google account | Free | Not for rooms |

### Verified facts
- https://developer.apple.com/find-my/ offers only MFi enrolment. Share Item Location: expires after seven days, disabled when reunited, recipient must authenticate (https://www.apple.com/newsroom/2024/11/apples-find-my-enables-sharing-location-of-lost-items-with-third-parties/).
- Airpinpoint troubleshooting requires macOS 11.0–14.x, Full Disk Access, Xcode tools, BeaconStore keychain item and `~/Library/com.apple.icloud.searchpartyd/OwnedBeacons` (https://airpinpoint.com/docs/troubleshooting); "every check requests all reports Apple holds for the tag's keys over the past 7 days" (https://airpinpoint.com/guides/airtag-location-history); pricing https://airpinpoint.com/pricing ; "Official Apple AirTag API Platform" branding and $750/month calculator at https://airpinpoint.com/airtag-api .
- FindMy.py: "no Mac needed" to query; key export `python3 -m findmy decrypt` on macOS ≤14, beaconstorekey-extractor on 15, macOS 26 protects the key (https://docs.mikealmel.ooo/FindMy.py/getstarted/02-fetching , https://github.com/malmeloo/FindMy.py/issues/177). v0.10.2 (14 Sep 2026) reports client as `akd` to avoid 503 (https://github.com/malmeloo/FindMy.py/releases).
- hass-FindMy PR #53 merged 21 Sep 2026, tested on HA 2026.8.2 with real AirTags, ±12 h candidate window, 15-min default cloud polling (https://github.com/malmeloo/hass-FindMy/pull/53 , https://github.com/malmeloo/hass-FindMy).
- AirTag adverts: 0x004C, type 0x12, len 0x19; BLE address = first 6 key bytes; separated mode every 2 s, key rotates at 04:00 daily (https://adamcatley.com/AirTag.html); nearby keys rotate every 15 min, "latch separated" state (https://thebinaryhick.blog/2026/03/22/old-dog-new-tricks-lost-apples-2-0/). ESPresense "known to not work" list includes AirTags (https://espresense.com/devices); Bermuda unsupported without the key (https://github.com/agittins/bermuda/wiki/Supported-devices).
- ESPresense hardware guidance and v4.0.6 (https://espresense.com/hardware , https://github.com/ESPresense/ESPresense/releases). BeaconZone catalogue https://www.beaconzone.co.uk/allbeacons . Blue Charm BC021 https://www.bluecharmbeacons.com (product page).
- Tractive: CAT 6 Mini £59, 32 g, subscription 1-yr Basic £7/mo, 2-yr Basic £4.50/mo, 5-yr Premium £4/mo (https://tractive.com/en/pd/gps-tracker-cat); HA integration requires premium, `aiotractive==1.0.3` reverse-engineered (https://www.home-assistant.io/integrations/tractive/ , https://github.com/zhulik/aiotractive). Weenect XS £39.99, 27 g, monthly £13, 1-yr £6.67, 2-yr £4.59, 5-yr £3.67 (https://www.weenect.com/uk/en/gps-cat-tracker/).
- Supabase Realtime `postgres_changes` setup and Free tier limits (200 concurrent connections, 2M messages/mo, pause after 1 week idle) — https://supabase.com/docs/guides/realtime/postgres-changes , https://supabase.com/pricing .

### Refuted claims (do not repeat)
- **"Tractive from £4/month on a 2-year plan"** — refuted; £4/month is the 5-year Premium plan; 2-year Basic is £4.50/month, 1-year Basic £7/month.
- **"Weenect from £4.16/month"** — refuted; the UK page lists £13 monthly, £6.67 (1-yr), £4.59 (2-yr), £3.67 (5-yr).
- **"Pawfit bans accounts within 24 hours"** — unverified; the thread has one ban report (Sept 2025) with no timing and a temporary breakage (Feb 2026).
- **"Apple's block started ~11 Sep 2026"** — slightly late; it began in early September (AltServer fix shipped 11 Sep).
- Airpinpoint's page does not literally say "exports private keys" — that is a well-founded inference from the BeaconStore/OwnedBeacons requirement. Its "Official Apple" wording is marketing, not an Apple endorsement.
- The "SIP-disabling doesn't help on macOS 26" statement is from the FindMy.py docs and find-my-timeline README, not issue #177 itself.

### Unknowns still open
- Whether the owner has an iPhone and/or a Mac on macOS ≤15 — decides feasibility of any real-AirTag route.
- UK prices for ESPresense's recommended M5 Atom S3 Lite / M5 Stamp C3 Mate (Pi Hut URLs 404'd); Tinkerverse £6.99 from a snippet (page 403).
- Whether the chosen collar beacon uses a static MAC (vendor pages silent; ESPresense/Bermuda key on UUID/major/minor regardless).
- RSSI reliability under sofas/in cupboards; garden node weatherproofing; whether "outside" is inferred from silence or a dedicated node.
- Airpinpoint free tier (button exists, no tier listed); longevity of FindMy.py's `akd` workaround.
- Whether Weenect's and Tractive's undocumented APIs stay open; aioweenect base URL not verified.
- Exact nearby-mode advert length (spec 4 key bytes, observed 6); AirTag 2 DULT mode duty cycle when the owner's iPhone is home.

### Cost (GBP)
- Collar beacon £12–25 (E8 £24.58, PC038 £15.05); CR2032 replacements ~£1.
- Three ESP32-C3 boards £10–21 (Pi Hut £3.40 each if in stock; Tinkerverse £6.99 each).
- Pi 4, Mosquitto, ESPresense, Python: £0 (owned/free).
- Total near-term: **≈ £30–50 one-off, £0/month.**
- Not chosen: AirTag 2 £29; Airpinpoint ≈ £9.20–11.50/tag/mo; Tractive £59 + £4.50–7/mo; Weenect £39.99 + £4.59–13/mo.

---

## 4. Living room + garden scan → walkable web scene (`scan`)

### Decision
Canon 750D photos → **RealityScan 2.2** desktop (free under US$1M annual revenue) as the single alignment hub: control-point scale, Mask Images for glass/sky, textured GLB export (up to 65,536 px single texture side), plus its **native COLMAP export** (added in 2.1.1, 31 Mar 2026: standard directory layout, FULL_OPENCV camera model) → **LichtFeld Studio** (GPLv3; NVIDIA CC 7.5+, i.e. GTX 16/RTX 20 or newer; build from source since Windows prebuilts are paid via the portal) or **Brush v0.3.0** (Apache-2.0, released 14 Sep 2025, any GPU incl. AMD/Intel) → **SuperSplat Editor 3.0** (MIT, WebGPU-only editing browser) for cropping and SOG (or SPZ v4) export → **Spark 2.2.0** (MIT, peer `three >=0.180.0`) in R3F via `<primitive object={splatMesh}/>` with a 30–50k-triangle UV-stripped RealityScan mesh as the three-mesh-bvh collider, and a KTX2/ETC1S-compressed textured GLB as the device fallback. Use Spark's first-party LOD budgets (Android 1M, iOS 1.5M, desktop 2.5M splats) and prebuild a Spark `.RAD` LOD tree if the garden pushes past them (runtime LoD build costs 1–3 s per 1M splats).

Capture protocol (verified against RealityScan help, Agisoft DSLR guide, pix-pro case): EF-S 10–18 at 12–14 mm (or 18–55 at 18 mm with 1.5–2× more frames), manual f/8, ISO 100 tripod / 200–400 handheld, 1/125 s handheld or 0.5–2 s tripod, manual focus taped at ~1.2 m, IS off on tripod, RAW+JPEG developed with one flat batch profile and no lens correction, custom Kelvin WB, lights on, blinds closed, overcast/dusk, 70–80% overlap, ≤30° between neighbours, three heights (0.6 / 1.4 / 2.0 m), perimeter + inner loop + centre orbit + floor pass + object orbits + doorway "tunnels" (frame every 0.3 m, 15° per frame), 1 m tape or AprilTags for scale; cover mirrors, screens and glass with matte paper; mask sky in the garden; 400–600 frames for a ~25 m² room at 12–14 mm.

### Runner-up
Postshot 1.1.69 Indie (€17 ≈ £14.50/month or €204 ≈ £174/year) for the highest-quality trainer with a documented RealityScan import — Free tier is watermarked, non-commercial and cannot export splats at all, so it is paid-only for any web deliverable. Phone apps are preview-only: Polycam Free exports glTF only (150 images), KIRI 3DGS is Pro-only ($17.99 ≈ £13.80/mo), Scaniverse Free and Plus have no commercial rights (Pro $50 ≈ £38.50/mo), Luma's capture line is being sunset.

### Comparison table

| Tool | Version / date | Licence / price | Role | Verdict |
|---|---|---|---|---|
| RealityScan desktop | 2.2, 25 Jun 2026 | Free < US$1M revenue; $1,250 ≈ £962/seat/yr above | Alignment, mesh, COLMAP export | **Pick** (Windows; AMD RDNA3/4 + NVIDIA) |
| RealityScan Mobile | 1.8, Nov 2025 | Free | Small props | Optional |
| Polycam | Free / Basic $150 ≈ £115/yr / Business $400 / Enterprise $1,200 | Free = glTF only, 150 images | Phone fallback mesh | Preview only |
| Scaniverse | 5.2.8 | Free / Plus $20 / Pro $50 ≈ £38.50/mo; commercial rights Pro+ | SPZ/PLY test splats | Preview only |
| Luma 3D Capture | 1.3.14, 14 Jan 2026 | Free | Second opinion | Being sunset; do not build on |
| KIRI Engine | 4.x | Basic free (no 3DGS) / Pro $17.99 ≈ £13.80/mo | Props | Preview only |
| Meshroom | 2025.1.0, 19 Aug 2025 | MPL-2.0 | OSS photogrammetry | Backup if RealityScan licence is a concern |
| COLMAP + OpenMVS | 4.2.0 / 2.4.0 | Apache-2.0 | Poses + textured mesh | Backup |
| Postshot | 1.1.69, Jul 2026 | Free = no export; Indie €17 ≈ £14.50/mo | Splat trainer | Runner-up (paid) |
| LichtFeld Studio | current | GPLv3; Windows binaries paid via portal | Splat trainer (NVIDIA CC 7.5+) | **Pick** if RTX 20+ |
| Brush | 0.3.0, 14 Sep 2025 | Apache-2.0 | Splat trainer (any GPU) | **Pick** otherwise |
| Nerfstudio Splatfacto | current | Apache-2.0 | Scriptable trainer | Alternative |
| SuperSplat Editor | 3.0, announced 9 Sep 2026 | MIT; needs WebGPU | Cleanup, SOG/SPZ export, collision GLB via splat-transform | **Pick** |
| @sparkjsdev/spark | 2.2.0 | MIT, peer three >=0.180 | Renderer | **Pick** |
| @mkkellogg/gaussian-splats-3d | — | MIT | Renderer | Superseded (author recommends Spark; COOP/COEP conflicts) |
| gsplat.js / Zappar splat / drei `<Splat>` | — | MIT | Lightweight renderers | `.splat` only, no SPZ/SOG; skip |

### Verified facts
- RealityScan 2.2 release/licence: https://www.cgchannel.com/2026/06/epic-games-releases-realityscan-2-2-with-amd-gpu-support/ ; 2.1 XMP/OpenCV export: https://www.cgchannel.com/2025/11/epic-games-releases-realityscan-2-1/ ; export formats and texture sides 512–65,536: https://rshelp.capturingreality.com/en-US/tools/export.htm ; 2.1.1 native COLMAP export: https://radiancefields.com/realityscan-releases-v2.1.1-with-colmap-updates and https://digitalproduction.com/2026/04/06/realityscan-2-1-1-adds-better-colmap-support-and-new-xmp-export-options/ . The pricing page https://www.realityscan.com/en-US/pricing 302-redirects to an Epic login (login-gated) — confirm licence text in the Epic Games Launcher.
- Postshot tiers: https://radiancefields.com/platforms/postshot , https://www.jawset.com/shop/pricing (prices render as placeholders without JS). LichtFeld: https://github.com/MrNeRF/LichtFeld-Studio . Brush: https://github.com/ArthurBrussee/brush , https://radiancefields.com/brush-releases-v0-3 (15 Sep 2025).
- Polycam: https://poly.cam/pricing . KIRI: https://www.kiriengine.app/pricing , https://www.kiriengine.app/blog/kiri-engine-basic-vs-pro ("3D Gaussian Splatting is a Pro-only scanning mode"). Scaniverse: https://www.nianticspatial.com/pricing ("For commercial rights, including resale, you must be on a Pro plan or Enterprise contract"), https://apps.apple.com/us/app/scaniverse-3d-scanner/id1541433223 . Luma: https://apps.apple.com/us/app/luma-3d-capture/id1615849914 (Genie sunset 1 Jan 2026), https://github.com/lumalabs/luma-web-library (archived 2 Apr 2025), https://radiancefields.com/luma-ai-to-sunset-flythroughs-on-january-1-2026 .
- Spark: https://registry.npmjs.org/@sparkjsdev/spark/latest (2.2.0, MIT, peer three >=0.180.0), https://github.com/sparkjsdev/spark (PLY, compressed PLY, SPZ, SPLAT, KSPLAT, SOG; WebGL2 98%+), LOD docs https://sparkjs.dev/docs/lod-getting-started/ (budgets Oculus 500K, Vision Pro 750K, Android 1M, iOS 1.5M, Desktop 2.5M; `.RAD/.RADC` trees). mkkellogg deprecation: https://github.com/mkkellogg/GaussianSplats3D .
- SuperSplat 3.0: https://blog.playcanvas.com/new-in-supersplat-editor-3-0-rebuilt-on-webgpu/ (9 Sep 2026), https://www.cgchannel.com/2026/09/playcanvas-releases-supersplat-editor-3-0/ (11 Sep 2026), import/export https://developer.playcanvas.com/user-manual/supersplat/editor/import-export/ , collision GLB via `splat-transform --collision-mesh` https://blog.playcanvas.com/turning-a-gaussian-splat-into-a-videogame/ .
- Mobile viewer benchmarks table (iPhone 15 Pro 2M@60/4M@30; iPhone 13 & Pixel 7 1M@60/2.5M@30): https://swyvl.io/blog/best-gaussian-splat-viewers/ . 4096² RGBA8 = 67.1 MB, ≈89 MB with mipmaps (arithmetic).
- Meshroom: https://github.com/alicevision/Meshroom/releases/tag/v2025.1.0 . COLMAP: https://github.com/colmap/colmap/releases . OpenMVS: https://github.com/cdcseacave/openMVS/releases . Nerfstudio: https://docs.nerf.studio/nerfology/methods/splat.html .

### Refuted or corrected claims (do not repeat)
- **"Spark runs 4M Gaussians at 60 fps on iPhone 14+"** — a swyvl prose claim contradicted by its own table and by Spark's default iOS budget of 1.5M; drop it.
- **"RealityScan texture export caps at 16,384"** — the export dialog offers up to 65,536 px for a single combined file.
- **"RealityScan poses need a conversion script for LichtFeld/Brush"** — no longer true; 2.1.1 writes a standard COLMAP folder directly.
- **"LichtFeld prebuilt binaries may require paid access"** — confirmed paid on Windows via the portal; free means building from source or Linux.
- **"SuperSplat 3.0 released 11 Sep 2026"** — PlayCanvas announced it 9 Sep 2026; 11 Sep is CG Channel's article date.
- The researcher's RealityScan help URL (`tools/modelExport.htm`) 404s; the live page is `tools/export.htm`.
- Brush v0.3.0's year is now resolved: 14 September 2025.
- Scaniverse Plus ($20/mo) also lacks commercial rights; the jump is straight to Pro.

### Unknowns still open
- The owner's PC GPU — decides LichtFeld/Postshot (RTX 20+) vs Brush; RealityScan itself now supports AMD RDNA3/4.
- Whether the owner has an iPhone Pro with LiDAR and whether the EF-S 10–18 mm lens is owned (18–55 kit works with more frames).
- RealityScan licence wording only via press; CR2 RAW import unverified (develop to 16-bit TIFF/JPEG q95).
- Meshroom default texture atlas size not confirmed.
- Spark has no official R3F wrapper (mount via `<primitive>` or `extend`).
- Photo counts (400–600) are derived from overlap rules and one case study, not a per-room benchmark.
- Polycam per-plan export article and Realities.io interior guide were 403.

### Cost (GBP)
- RealityScan, LichtFeld (source build), Brush, SuperSplat, Spark, Meshroom, COLMAP/OpenMVS: £0.
- Optional Postshot Indie ≈ £14.50/month or ≈ £174/year. Optional Scaniverse Pro ≈ £38.50 for one month of commercial-rights previews. Optional KIRI Pro ≈ £13.80/month.
- Hardware: none beyond the owned 750D; a 1 m tape and printed AprilTags ≈ £5.

---

## 5. WebAR try-on for cap, hoodie, long sleeve + Kitty on your floor (`webar`)

### Decision
**MediaPipe Tasks Vision inside the existing R3F 9 canvas**, no vendor SDK. It is the only free, self-hostable option that runs in iOS Safari and Android Chrome from a static Vercel deploy with no approval, view cap, watermark or domain registration, and covers: cap (Face Landmarker: 478 landmarks + 4×4 facial transformation matrix), hoodie/long sleeve (Pose Landmarker: 33 landmarks + metric world landmarks + optional segmentation mask), occlusion (drei `<Facemesh>` as a depth-only occluder + SelfieMulticlass segmenter). **Pin one `@mediapipe/tasks-vision` version** — drei 10.7.8 ships 0.10.17 while npm latest is 1.0.1 — and self-host the wasm folder and `.task` models under `/public`. Use the lite pose model (5.78 MB, from a mirror listing) on mobile, run inference in a Web Worker at 15–20 Hz with a main-thread fallback for Safari, One Euro filter per channel (start mincutoff 1.0 / beta 0.007 for positions, 1.5 / 0.05 for rotations), feet-derived floor plane for Kitty with DeviceOrientation pitch fallback, Android-only bonus mode via native WebXR `immersive-ar` hit-test with `@react-three/xr`.

Component architecture (client-only, `dynamic(() => import(...), { ssr:false })`): `TryOnOverlay.tsx` (100dvh fixed portal, mode/facing state) → `CameraFeed.tsx` (getUserMedia inside the tap handler, `<video autoPlay muted playsInline>`, stop tracks before switching cameras) → `landmark.worker.ts` (FilesetResolver from `/mediapipe/wasm`, FaceLandmarker with `outputFacialTransformationMatrixes:true`, PoseLandmarker lite) → `trackingStore.ts` (zustand refs + One Euro filters, 300 ms hold then fade) → transparent `<Canvas>` with cover-mapping VFOV → `CapAnchor.tsx` (matrix.fromArray, scale 0.01, Facemesh occluder colorWrite:false) / `TorsoAnchor.tsx` (landmarks 11/12/23/24) / `FloorKitty.tsx` (ankles 27–32 → floor line; else DeviceOrientation; else fixed plane) → `CaptureButton.tsx` (compose video + GL to canvas, `navigator.share`) → fallbacks (in-app browsers → "Open in Safari/Chrome"; NotAllowedError → static mock-up; slow inference → cap-only).

### Runner-up
**Snap Camera Kit for Web** (`@snap/camera-kit@1.22.0`; free per Snap's blog, application-gated) — the only web SDK with cloth-simulated Clothing Try-On and 3D Body Mesh. Safari 16+/iOS 15+, Chrome 95+; Safari lacks SIMD and Web Worker mode; 6DoF falls back to 3.5DoF surface tracking; 3D body tracking flagged as slow on mobile web. Garments must be authored as Lenses and render in Snap's canvas, so Kitty stays composited separately. Web-specific clothing try-on performance is unverified.

### Comparison table

| Option | Face | Body/torso | World/floor | iOS Safari | Price | Verdict |
|---|---|---|---|---|---|---|
| MediaPipe Tasks Vision 1.0.1 (drei pins 0.10.17) | 478 pts + matrix | 33 pts + world + mask | Inferred only | Yes (JS/WASM) | Free, Apache-2.0 | **Pick** |
| drei FaceLandmarker/Facemesh/FaceControls 10.7.8 | Wraps MediaPipe | No helper | No | Yes | MIT | **Pick** (face half) |
| MindAR 1.2.5 | MediaPipe underneath | No | Roadmap | Yes | MIT | Skip (last release 16 Jan 2024) |
| 8th Wall OSS engine 0.1.0 + SLAM binary | Face Effects (MIT) | No | SLAM binary, frozen after Mar 2026 | Yes | Free, attribution required | Last resort for floor detection |
| Zappar Universal AR | Yes | No | Instant world | Yes | Dev £9.99/mo non-commercial; Pro £250/mo 12k views/yr; self-hosting Enterprise-only | Skip |
| Variant Launch | No | No | WebXR via App Clip | Safari only | Free 3k views/mo; $99 ≈ £76/mo unlimited | Skip for try-on |
| `<model-viewer>` AR | No | No | Quick Look / Scene Viewer | Leaves page | Free | Optional "see Kitty on your table" button |
| Native WebXR | — | — | Android Chrome only | **Not supported** | Free | Android bonus mode |
| Snap Camera Kit Web 1.22.0 | Yes | 3D Body Mesh + cloth | Surface (3.5DoF) | Safari 16+ | Free, application-gated | Runner-up |
| DeepAR Web 5.6.22 | Yes | No (foot/wrist removed v5.6.4) | No | iOS 11+ | Free 10 MAU watermarked; $25 ≈ £19/mo to 1k MAU | Cap-only alternative |
| Banuba Web AR | Yes | No | No | Yes | Quote-only | Skip |

### Verified facts
- 8th Wall: paid subscriptions ended 28 Feb 2026, hosted projects live until 28 Feb 2027, engine framework MIT (Face Effects, Image Targets, Sky), binary under "XR Engine License Agreement" with visible copyright/LICENSE requirement, Hand Tracking/VPS/Maps not included, binary "maintained through March 2026" (https://8thwall.org/ , https://8thwall.org/docs/open-source , https://8thwall.org/docs/migration/faq , https://registry.npmjs.org/@8thwall/engine/latest , https://roadtovr.com/niantic-webar-platform-8th-wall-open-source/).
- iOS Safari WebXR: not supported through 27.2 (https://caniuse.com/webxr); Apple engineer: "the AR session is currently not supported, there has been no conversations about supporting webXR-AR" (https://developer.apple.com/forums/thread/743655).
- MediaPipe: https://registry.npmjs.org/@mediapipe/tasks-vision/latest (1.0.1, Apache-2.0); Face Landmarker web guide https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js ; Pose Landmarker https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker ; Image Segmenter classes https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter . drei 10.7.8 dependency 0.10.17 (https://registry.npmjs.org/@react-three/drei/latest); Facemesh props https://drei.docs.pmnd.rs/shapes/facemesh ; FaceControls https://drei.docs.pmnd.rs/controls/face-controls .
- Snap: https://registry.npmjs.org/@snap/camera-kit/latest (1.22.0); "completely free of charge" https://ar.snap.com/blog/guide-web-ar-camera-kit ; setup/browsers/CSP https://developers.snap.com/camera-kit/integrate-sdk/web/web-configuration ; considerations https://developers.snap.com/camera-kit/integrate-sdk/web/guides/web-considerations ; clothing try-on https://developers.snap.com/lens-studio/features/try-on/clothing-try-on .
- DeepAR pricing https://docs.deepar.ai/deepar-sdk/pricing/ ; changelog v5.6.4 (2024-05-16) "Foot and wrist tracking are removed from DeepAR SDK. They are available in ShopAR" https://docs.deepar.ai/deepar-sdk/platforms/web/changelog/ ; browsers https://docs.deepar.ai/deepar-sdk/platforms/web/supported-browsers .
- Zappar: https://docs.zap.works/universal-ar/general/licensing/ ("We currently only offer self-hosting to users on our Enterprise plans"), https://docs.zap.works/workspaces/workspace-plans/ (Pro overage $30/thousand), https://zap.works/pricing . Variant Launch https://launch.variant3d.com/ , https://launch.variant3d.com/docs/launching/ios-browsers . `<model-viewer>` https://modelviewer.dev/examples/augmentedreality/ . One Euro filter https://gery.casiez.net/1euro/ .

### Refuted claims (do not repeat)
- **"DeepAR Web offers foot and wrist tracking"** — refuted; removed from the SDK in v5.6.4 (May 2024) and moved to ShopAR. Current web features: face tracking (incl. CNN), background/hair segmentation, emotion detection. Conclusion "cap only" stands.
- **"8th Wall SLAM binary is a viable upgrade path"** — downgraded; it was only maintained through March 2026 and is now a frozen, unmaintained closed binary with an attribution requirement.
- The Web Considerations URL cited originally (without `/guides/`) 404s; the Safari SIMD/Worker limitation lives on the web-configuration page.
- Zappar Pro overage is listed as $30/thousand on the plans page; the £25 figure was not verified.
- MindAR's last release date is now resolved: v1.2.5 on 16 Jan 2024 (over 2.5 years stale).
- "Body tracking not included" in 8th Wall is true by omission (it never shipped it), not by explicit statement.

### Unknowns still open
- pose_landmarker_heavy size and real iOS Safari fps for GPU vs CPU delegate (only a snippet: iPhone 12 CPU lite ~30 fps, full 20–25, heavy 10–15).
- Snap Clothing Try-On performance specifically on Camera Kit Web in iOS Safari; approval time; licence terms behind login.
- 8th Wall OSS 0.1.0 browser/device matrix (docs 404'd).
- getUserMedia behaviour inside Instagram/TikTok in-app browsers; whether WebKit requires transient activation for the camera prompt in 2026 (not re-verified).
- Variant Launch minimum iOS version; whether failed interstitial views count against the 3,000 free.

### Cost (GBP)
- MediaPipe + drei + R3F: £0.
- Snap Camera Kit Web: £0 (application-gated).
- Not chosen: DeepAR ≈ £19/mo (1k MAU) to ≈ £770/mo (100k MAU); Zappar Pro £250/mo; Variant Launch ≈ £76/mo per project; Banuba quote-only.

---

## 6. 3D cat model and hero camera prop (`cat-model`)

### Decision
**Quaternius "Cat" on Poly Pizza** (https://poly.pizza/m/qKICY6xla2, GLB https://static.poly.pizza/67f5e3fe-37ee-4c86-95c8-d269d8c9f8ba.glb): CC0 1.0, downloads with a plain GET (238,672 B, FBX2glTF export), 2,448 triangles, one 16-joint skin (All, Root, Body, Head, Tail, FrontLeg.L/R, BackLeg.L/R + `_end` bones), 512×512 `Atlas.png` (5,978 B) + COLOR_0 vertex colours, eight clips: Idle 6.67 s, Idle_Eating 3.33 s, Walk 1.0 s, Run 0.67 s, Jump_Start 0.25 s, Jump_Loop 1.0 s, Headbutt 0.62 s, Death 0.88 s. Steps: import into Blender 4.x; repaint the atlas to a tuxedo (black body, white bib/muzzle/paws/belly) on the existing UV islands; bake vertex colours into the atlas or delete the Color attribute; optionally author `Sit`/`LookAround` on the existing armature (or drive the Head bone in `useFrame`); **rename the actions** — the GLB's clip names are `AnimalArmature|AnimalArmature|AnimalArmature|Walk` etc.; export GLB with actions as NLA strips; `gltf-transform` (draco/meshopt + texture resize) → well under 300 KB; `useGLTF` + `useAnimations`, crossfade Idle/Walk/Run by scroll velocity. **Mirror the GLB into the repo** — do not hot-link the UUID URL.

Hero camera: OpenGameArt **"DSLR camera [Blender]"** (CC0, 610 tris, .blend 541.8 KB, https://opengameart.org/content/dslr-camera-blender) exported to GLB. Zero-Blender alternative: Google Poly "Camera" (743 tris, CC BY 3.0, https://s3.us-east-005.backblazeb2.com/icosa-gallery/poly/0nfSsetwy0Z/Camera.gltf) with a footer credit.

### Runner-up
Quaternius's smaller 4-joint flat-colour cat (https://poly.pizza/m/2f54vbV0In, 111,948 B, 1,772 tris, clips Bite_Front, Dance, Death, HitRecieve, Idle, Jump, No, Walk, Yes) — no UVs, so no true tuxedo pattern. For a photo-real Kitty later: Microsoft TRELLIS (MIT, HF Space, 16 GB VRAM locally) from a clean 3/4 Canon 750D photo, rigged with Blender's bundled Rigify **Cat** metarig.

### Comparison table

| Source | Licence | Rigged / clips | Size | Verdict |
|---|---|---|---|---|
| Quaternius Cat qKICY6xla2 (Poly Pizza) | CC0 | 16 joints; 8 clips | 238,672 B, 2,448 tris | **Pick** |
| Quaternius Cat 2f54vbV0In (Poly Pizza) | CC0 | 4 joints; 9 clips; no UVs | 111,948 B, 1,772 tris | Runner-up |
| Quaternius Animal Pack Vol.2 (OGA) | CC0 | Cat: Idle + Walking only (.blend/.fbx/.obj) | zip 2.07 MB | Blender source if needed |
| Quaternius Ultimate Animated Animals | CC0 | **No cat** (12 other animals) | — | Not applicable |
| Khronos Fox | CC0 mesh / CC BY 4.0 rig | Survey, Walk, Run | 162,852 B | Test asset only |
| Icosa/Google Poly "Cat" | CC BY 3.0 | Static | 594 tris | Base mesh for Rigify |
| Gobkit Free Animal Pack | CC0 | Rigged, no cat | 56–75 KB each | Pattern reference |
| OGA Cat Pilot | CC0 | Biped | — | Wrong body plan |
| Kenney | CC0 | No animal packs | — | Not applicable |
| Meshy (AI) | Free 100 cr/mo → CC BY 4.0 outputs | Quadruped auto-rig, **walk only** | dense | Skip for hero |
| Tripo3D (AI) | Free $0/200 cr non-commercial; Pro $20 ≈ £15.40/mo commercial | Rig v2.5 quadruped: `preset:quadruped:walk` only | dense | Skip for hero |
| Rodin / Hyper3D | Creator $24–30 ≈ £18.50–23/mo | No rigging | — | Skip |
| Luma Genie | — | — | — | Discontinued (308 to homepage) |
| Microsoft TRELLIS | MIT | No rigging | needs 16 GB VRAM | Photo-real path later |
| Tencent Hunyuan3D 2 / 2.1 | Licence excludes EU, UK, South Korea | — | — | **Do not use from London** |
| Blender Rigify Cat metarig | GPL add-on, output yours | Manual animation | — | Free rigging fallback |
| Auto-Rig Pro | $50 ≈ £38.50 + $12.50/yr | Quadruped rigging + retarget | — | Only if retargeting to another mesh |
| Mixamo | — | Bipedal humanoids only | — | Cannot help |
| OGA "DSLR camera [Blender]" | CC0 | 610 tris, rotation anim | .blend 541.8 KB | **Pick** for hero prop |
| Google Poly "Camera" | CC BY 3.0 | 743 tris | GLTF on S3 | Zero-Blender alternative |
| Poly Haven Camera_01 | CC0 | 26,987 polys, ~2.4 MB | — | Too heavy, vintage look |

### Verified facts
- Ultimate Animated Animals Drive folder (all four format subfolders) contains exactly Alpaca, Bull, Cow, Deer, Donkey, Fox, Horse, Horse_White, Husky, ShibaInu, Stag, Wolf (https://quaternius.com/packs/ultimateanimatedanimals.html , https://drive.google.com/embeddedfolderview?id=1uJ3N5HfB7jKTseJUNQr3N4YaN0UuEtHk).
- qKICY6xla2 GLB parsed: generator FBX2glTF v0.9.7; 8 animations; 16-joint skin; 2,448 indexed triangles; COLOR_0, TEXCOORD_0, JOINTS_0, WEIGHTS_0; Atlas.png 512×512; single AtlasMaterial (curl of the static URL, HTTP 200, gltf-binary, no cookies).
- Hunyuan3D LICENSE line 3: "THIS LICENSE AGREEMENT DOES NOT APPLY IN THE EUROPEAN UNION, UNITED KINGDOM AND SOUTH KOREA"; §5(c) forbids using outputs outside the Territory (https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2/main/LICENSE , https://raw.githubusercontent.com/Tencent-Hunyuan/Hunyuan3D-2.1/main/LICENSE).
- Meshy: "Currently, walking is the only animation we support for quadrupeds" (https://help.meshy.ai/en/articles/16231707); Free 100 credits/mo, CC BY 4.0 outputs; Pro 1,000 credits/mo, subscribers own assets (https://www.meshy.ai/pricing , https://www.meshy.ai/features/ai-auto-rigging).
- Tripo: Rig v2.5 quadruped presets = `preset:quadruped:walk` only, output glb/fbx (https://developers.tripo3d.ai/en/docs/animations-retarget , https://developers.tripo3d.ai/en/models/rig); pricing page reachable with a browser UA: Free $0 / 200 credits / "Public Models · Non-Commercial Use", Pro $20.00/mo / 3,000 credits / "Private Models · Commercial Use", Max $90/mo / 25,000 credits (https://www.tripo3d.ai/pricing); Tripo's blog admits Terms reserve broad rights in Free output (https://www.tripo3d.ai/blog/ai-3d-commercial-use-license).
- Rigify predefined meta-rigs include Basic Human, Basic Quadruped, Human, Cat, Wolf, Horse, Shark (https://docs.blender.org/manual/en/4.2/addons/rigging/rigify/basics.html). Mixamo "bipedal humanoids only" — Adobe FAQ 403 to fetch, reproduced by a search-indexed snippet of the Adobe URL and https://www.meshy.ai/tutorials/how-to-use-mixamo-with-meshy .
- Luma Genie: `curl -I https://lumalabs.ai/genie` → HTTP 308 to `/`; homepage lists Ray 3.2, Uni-1, Luma Skills; zero occurrences of "genie".
- TRELLIS https://github.com/microsoft/TRELLIS (MIT). Rodin https://hyper3d.ai/pricing . Auto-Rig Pro https://artell.gumroad.com/l/autorigpro . OGA DSLR https://opengameart.org/content/dslr-camera-blender . Icosa camera http://api.icosa.gallery/v1/assets/0nfSsetwy0Z . Poly Haven https://api.polyhaven.com/info/Camera_01 .

### Refuted claims (do not repeat)
- **"tripo3d.ai/pricing returns 403; Professional is $19.90/mo; free outputs are CC BY 4.0"** — refuted. The page is fetchable with a normal browser UA; Pro is $20.00/month (3,000 credits, commercial), Max $90/month; the pricing page never mentions CC BY 4.0. The operative restriction is "Non-Commercial Use" on Free; Free-tier assets must not appear on the merch site regardless of CC BY wording.
- **"Clip names are Idle, Walk, Run…"** — the actual keys are prefixed `AnimalArmature|AnimalArmature|AnimalArmature|<Name>`; rename on export or match by suffix.
- Tripo Animation Retarget "10 credits/animation" — the docs example shows `credits_consumed 20.00`; unconfirmed.

### Unknowns still open
- Which Quaternius pack qKICY6xla2 originally shipped in (Poly Pizza page names none).
- Meshy Pro price (pricing fetch truncated; only "Pro 1,000 credits/mo" captured).
- Rodin/Hyper3D exact output licence per tier.
- Luma Genie's exact retirement date (no Luma-owned page confirms 1 Jan 2026).
- Whether the OGA DSLR model reproduces a specific Canon body closely enough to raise trade-dress concerns.
- Long-term stability of `static.poly.pizza` UUID URLs (mirror into repo).

### Cost (GBP)
- Quaternius cat, OGA camera, Rigify, TRELLIS: £0.
- Not chosen: Tripo Pro ≈ £15.40/mo; Meshy Pro (price not captured); Rodin Creator ≈ £18.50–23/mo; Auto-Rig Pro ≈ £38.50 one-off.

---

## 7. Stripe checkout → Supabase → POD fulfilment → tracking email (`stripe-pod`)

### Decision
Stripe **hosted Checkout Sessions** (`mode: 'payment'`, GBP, pre-created Prices with shared `lookup_key` in sandbox and live, `shipping_address_collection.allowed_countries: ['GB']`, ≤5 flat `shipping_options` via `shipping_rate_data`, `phone_number_collection.enabled: true`, `customer_creation: 'if_required'`, `metadata.kind`, `client_reference_id`, `expires_at` 1 h, **no** `payment_method_types` so dynamic methods give Onelink + Apple Pay + Google Pay with no domain registration, **no** `automatic_tax` while under the £90,000 UK VAT threshold). Created in `app/api/stripe/checkout/route.ts` (Node runtime) with `idempotencyKey: checkout/${cart_id}`, 303 redirect to `session.url`.

Fulfilment only from `app/api/stripe/webhook/route.ts`: `const raw = await req.text()`, `stripe.webhooks.constructEvent(raw, sig, whsec)`, insert `stripe_events(id)` (PK conflict = duplicate → 200), on `checkout.session.completed` / `checkout.session.async_payment_succeeded` with `payment_status !== 'unpaid'` call `fulfillCheckout(session.id)` (retrieve with `expand: ['line_items']`; shipping at `collected_information.shipping_details`; `insert into orders ... on conflict (stripe_checkout_session_id) do nothing`), then `after(() => submitToPod(orderId))` so the 200 returns within Stripe-hosted Checkout's 10-second wait. `export const runtime = 'nodejs'; export const maxDuration = 60`. Success page calls the same `fulfillCheckout` but never fulfils alone.

**POD adapter:** the pod-uk dimension chose Printful, so `lib/orders/pod.ts` targets Printful v1 (`POST /orders` draft → `POST /orders/{id}/confirm`; webhooks `POST /webhooks` types `package_shipped`, `order_failed`, `order_canceled`) with a Printify implementation (`POST /v1/shops/{shop_id}/orders.json` → `.../send_to_production.json`; `X-Pfy-Signature: sha256=<HMAC-SHA256 hex>`) kept as the alternate. Store `pod_status` as free text and branch only on shipment webhooks / fulfilled / cancelled — Printify's status enum differs between sources. A Vercel cron `GET /api/cron/reconcile` every 15 min (requires Pro) retries rows stuck in `paid` > 10 min. Tracking email via **Resend** with `idempotencyKey: shipment/${id}`.

**£1 "feed Kitty a snack":** MVP = hosted Checkout Session with ad-hoc `price_data` (unit_amount 100), `submit_type: 'donate'`, `metadata.kind: 'snack'`; Phase 2 = same session with `ui_mode: 'elements'` + `return_url` rendered through `<ExpressCheckoutElement>` for one-tap wallets (requires payment-method domain registration in sandbox and live). Skip saved-payment-method PaymentIntents. Fee on £1 UK card = 1.5% + 20p = 21.5p → **rounds up to 22p → 78p net exactly**. Offer £2 / £2.50 tiers. The Pi reads `snack_payments where status='paid'` (own restricted credential), dispenses, sets `dispensed`.

**Hosting:** Vercel Pro ($20 ≈ £15.40/seat/mo — Hobby is non-commercial and caps crons at once/day), Functions region `lhr1`, only the production URL registered in Stripe live; previews via `?x-vercel-protection-bypass=<secret>` or `stripe listen`. Supabase Pro ($25 ≈ £19.25/mo — Free pauses after 7 idle days), London region, `sb_secret_` key in a `server-only` module, RLS on every table with `revoke` from anon/authenticated on orders, public read on `products` and a `snack_feed` view. Schema in `supabase/migrations/0001_commerce.sql` as drafted (stripe_events, products, orders, order_items, snack_payments, enum `order_status`, unique constraints on session/payment-intent/pod ids, `livemode` on every row).

### Runner-up
Stripe Payment Links (zero code) — rejected because line items, shipping and metadata routing per SKU are needed for POD mapping; and Supabase Edge Functions instead of Next.js route handlers — rejected to keep one runtime and use `after()`.

### Comparison table

| Component | Choice | Version / tier | Alternative considered | Why |
|---|---|---|---|---|
| Checkout | Stripe hosted Checkout Sessions | API 2026-08-26.dahlia via `stripe@22.6.2` | Embedded Checkout / Elements | No domain registration; wallets free; 10 s webhook wait handled with `after()` |
| Webhook runtime | Next.js 16 route handler, Node runtime | 16.3.5 docs | Edge runtime | Edge is deprecated in Next 16 docs; Stripe SDK needs crypto provider there |
| Deferred work | `after()` | stable since 15.1 | Queue (Inngest/QStash) | Sufficient for one POD call; cron reconciles |
| Database | Supabase Postgres, Pro | $25 ≈ £19.25/mo | Free tier | Free pauses after 7 idle days |
| POD | Printful v1 behind adapter | — | Printify | See §2 |
| Email | Resend | Free 3,000/mo, 100/day | Stripe receipts | React templates + idempotency |
| Tax | `automatic_tax` off | — | Stripe Tax Basic £0.40/txn | Zero tax without registration; below £90k threshold |
| £1 one-tap | Hosted session → Express Checkout Element | — | Off-session PaymentIntents | SCA/consent makes saved-PM unreliable for anonymous tips |
| Hosting | Vercel Pro, lhr1 | $20 ≈ £15.40/seat/mo | Hobby | Non-commercial clause; cron once/day |
| Local testing | `stripe listen --forward-to` | CLI | Dashboard endpoint on ngrok | Stable whsec_, `stripe trigger` |

### Verified facts
- UK card pricing 1.5% + 20p standard, 2.8% + 20p premium, 2.5% + 20p EEA, 3.15% + 20p international, +2% FX, £20 dispute; Tax Basic £0.40/txn where registered (https://stripe.com/gb/pricing). Rounding: "Stripe rounds the Stripe fee to the nearest unit ... if the fee is 0.025, Stripe will round up to 0.03" (https://support.stripe.com/questions/rounding-rules-for-stripe-fees). GBP minimum charge £0.30 (https://docs.stripe.com/currencies).
- `shipping_details` moved to `collected_information.shipping_details` in 2025-03-31.basil (https://docs.stripe.com/changelog/basil/2025-03-31/checkout-session-remove-shipping-details); `line_items` includable only via `expand` (https://docs.stripe.com/api/checkout/sessions/object); create params incl. shipping_options ≤5, 100 line items, expires_at 30 min–24 h (https://docs.stripe.com/api/checkout/sessions/create).
- Wallets on hosted Checkout need no configuration; Elements/embedded need domain registration (https://docs.stripe.com/apple-pay?platform=web , https://docs.stripe.com/payments/payment-methods/pmd-registration?dashboard-or-api=dashboard); Express Checkout Element with `ui_mode=elements` (https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=embedded-components).
- Checkout waits up to 10 s for the webhook 200; CLI-forwarded events skip the wait (https://docs.stripe.com/checkout/fulfillment?payment-ui=stripe-hosted). Webhook retries up to 3 days live / 3 attempts sandbox, 5-min tolerance, order not guaranteed (https://docs.stripe.com/webhooks). `constructEvent` / `constructEventAsync` (https://raw.githubusercontent.com/stripe/stripe-node/master/src/Webhooks.ts). `stripe@22.6.2` (2026-09-09); 22.6.0 pinned `2026-08-26.dahlia` (https://registry.npmjs.org/stripe/latest , https://raw.githubusercontent.com/stripe/stripe-node/master/CHANGELOG.md). Sandboxes isolate settings; objects not shared between modes (https://docs.stripe.com/testing-use-cases). CLI listen flags (https://docs.stripe.com/cli/listen).
- Next.js 16.3.5: `await request.text()` webhook example, no bodyParser (https://nextjs.org/docs/app/api-reference/file-conventions/route); runtime `'edge'` deprecated, default `'nodejs'` (route-segment-config); `after()` stable 15.1, runs to maxDuration via waitUntil (https://nextjs.org/docs/app/api-reference/functions/after).
- Vercel Hobby non-commercial, $20/seat Pro (https://vercel.com/docs/plans/hobby); default region iad1, `lhr1` valid (https://vercel.com/docs/functions/configuring-functions/region); protection bypass with Stripe example (https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation); Hobby crons once per day (https://vercel.com/docs/cron-jobs/usage-and-pricing).
- Supabase: Free 500 MB, 2 projects, pause after 1 week, 5 GB egress; Pro $25 never pauses (https://supabase.com/pricing); secret key bypasses RLS, 401 from browser UA, legacy anon/service_role deprecated by end of 2026 (https://supabase.com/docs/guides/api/api-keys).
- Stripe Tax zero without registration (https://docs.stripe.com/tax/set-up); UK VAT threshold £90,000 (https://www.gov.uk/register-for-vat).
- Resend: Free 3,000/mo, 100/day, 3 domains (https://resend.com/pricing); idempotency key ≤256 chars, 24 h (https://resend.com/docs/api-reference/emails/send-email); verified domain for production `from` (https://resend.com/docs/send-with-nextjs).
- Printify: 600 req/min global, 100/min catalog, shipments `carrier/number/url/delivered_at` readable at https://developers.printify.com/ ; order body and webhook topics corroborated by https://github.com/nasa8x/printify-api and pkg.go.dev connellrobert/printify-go; signature format via https://github.com/ARau87/printify-mcp/issues/16 .

### Refuted or corrected claims (do not repeat)
- **"£1 nets ≈78p (rounding unverified)"** — now exact: half-penny rounds up, fee 22p, net 78p.
- **"Link/Apple Pay/Google Pay carry no extra fee"** — not itemised on stripe.com/gb/pricing; assume card rate but do not present it as verified.
- **"Vercel Hobby only fails on the commercial clause"** — it also caps crons at once per day, so the `*/15` reconcile cron fails to deploy on Hobby.
- **"stripe-node version could not be read"** — resolved: 22.6.2, API 2026-08-26.dahlia; Stripe.js loads from `js.stripe.com/dahlia/stripe.js`.
- **Printify order/webhook specifics** — unverifiable from a readable primary page (SPA docs; help centre 403); corroborated by three SDKs but the status enum differs (`payment-not-submitted` vs `payment-not-received`, `has-issues` vs `had-issues`). Do not hard-code it.
- Stripe now brands Link as **Onelink**; the Dashboard toggle sits under Wallets.

### Unknowns still open
- Printify `order:shipment:created` payload field names and retry policy; exact API store type (docs say "API").
- Whether the chosen Printful SKUs require `address_to.phone` (collect it anyway).
- Vercel Pro cron limits beyond "more than once per day" for the reconcile route.
- EU shipping/customs/IOSS if `allowed_countries` is widened.
- Whether Printful base prices are VAT-inclusive (affects margin, not code).

### Cost (GBP)
- Stripe: 1.5% + 20p per UK card sale (cap at £12.25 base ≈ 38p + 20p on a £25 retail); £1 snack → 22p fee, 78p net; £2 snack → 23p fee (11.5%).
- Vercel Pro ≈ £15.40/seat/month. Supabase Pro ≈ £19.25/month. Resend £0 (free tier). Stripe Tax £0 (disabled).
- Printful per-order product + shipping (see §2). Total fixed ≈ **£34.65/month** before artta credits.

---

## 8. Story video generation, artta.ai, and the frame pipeline (`story-video`)

### Decision
1. **Shoot Kitty first** with the 750D in flat daylight: 6–8 stills (front, 3/4, side, top-down, sitting, walking), 3:4 / 9:16 framing against plain SE16 walls. Every AI clip starts from one of these real photos.
2. **Models on artta.ai:** Kling 3.0 as the consistency engine — register "Kitty" as an Element (2–4 images; animals explicitly supported; bind in every generation with first frame + optional last frame; sound off; 39 credits per 5 s 720p with sound, less without). Veo 3.1 (10 credits per 8 s 720p, native 9:16) for establishing/atmosphere shots. Wan 2.7 (8 credits/s 720p = 40 per 5 s; first+last frame, negative prompt, seed, [Image n] refs) as the budget bookended transition model. Seedance 2.5 (23 credits/s 720p = 115 per 5 s) for at most one hero beat. Generate 9:16, 5 s, 720p drafts, 1080p finals only.
3. **Budget (corrected):** artta's true month-to-month plans are Basic $19.90 ≈ £15.30 / 200 credits, Pro $39.90 ≈ £30.70 / 500, Max $69.90 ≈ £53.80 / 1,050, Pro Max $99.90 ≈ £76.80 / 2,100. Monthly Pro buys ≈ 8 Kling 3.0 + 8 Veo + 2–3 Wan clips — roughly one 8–10-scene story with retries over two months. The annual Pro ($238.80 ≈ £184 charged once for 4,200 credits, ≈ 4.4p/credit) is cheapest per clip if committed. The free tier (one claimable credit per 24 h) is not a video budget. "Price increase coming soon" banner present — re-check before buying.
4. **Prompt template:** `CAMERA: <one slow move, no cut>. SUBJECT: @Kitty, the black-and-white tuxedo cat from the reference — keep markings, white bib, white paws, black mask, eye colour exactly; one cat only. ACTION: <one plausible action from this pose, with an end state>. CONTEXT: <the room as in the image>. STYLE: photoreal, natural micro-shake, shallow DOF, 24 fps, subtle motion.` Negative: `morphing, warping, extra limbs, second cat, changing fur pattern, colour shift, text, watermark, cut, flicker, cartoon`. One action + one camera move per 5 s; never a 180° turn in one clip; cat ≥25% of frame height; lock seed where offered; end-frame prompts camera-only.
5. **Post-processing (validated on the installed ffmpeg 9.0-full gyan.dev build):**
   - Inspect: `ffprobe -v error -select_streams v -show_entries stream=width,height,r_frame_rate,nb_frames -of default=nw=1 clip.mp4`
   - Mobile frames: `ffmpeg -i clip.mp4 -vf "fps=12,scale=720:-2:flags=lanczos" -c:v libwebp -quality 80 -compression_level 6 -preset photo -pix_fmt yuv420p story/s02/f_%04d.webp` → 60 frames ≈ 1.5 MB synthetic (25.5 KB/frame); expect 2–4 MB for real footage; drop to `-quality 74` or `fps=10` if a scene exceeds 4 MB.
   - Optional AVIF: `... -c:v libaom-av1 -still-picture 1 -crf 30 -cpu-used 6 -pix_fmt yuv420p -f image2 f_%04d.avif` (≈1.1 MB / 60 frames; slower decode; **not** libsvtav1 with `avif=1`, which fails on sequences).
   - Desktop set: same with `scale=1280:-2`.
   - Manifest: `scripts/make-manifest.mjs` → `manifest.json` with `fps`, `frameCount`, `width/height`, `pattern`, `basePath`, `totalBytes`, `cacheKey`, `keyframes.first/last`, `preload.immediate: [0,8,16,…]`, `scroll.pinVh`. Folders under `public/story/<sceneId>/`, versioned by cacheKey, immutable cache headers.
   - Runtime: preload `immediate` frames, then the rest in scroll direction; `createImageBitmap` into a sliding window of ~24 decoded frames; `CanvasTexture.needsUpdate` only on index change; DPR cap 2; ≤3 MB per scene, ≤25 MB for an 8-scene story.
6. **Chaining:** `ffmpeg -sseof -0.05 -i A.mp4 -frames:v 1 -update 1 A_last.png`, re-sharpen once with Nano Banana 2 / Flux Kontext on artta ("identical image, restore sharpness, keep the cat exactly the same"), use as B's first frame on Kling 3.0 / Wan 2.7 / Seedance with an end frame generated from an original Kitty photo in the same room. Kling warns dissimilar frames cause a "shot switch"; near-identical frames yield ~10× less motion — make end frames a real pose change in the same scene. For location changes use exits (walk out right / enter left). Re-anchor every 2–3 clips with a fresh original photo.
7. **"Kitty walks out of a photo frame":** layered composite, not in-video. Cut Kitty out (`rembg -m birefnet-general -a`, BiRefNet MIT), paste onto flat chroma-green 1080×1920, generate a left-to-right walk on Kling 3.0 with the Element, then `ffmpeg -i walk.mp4 -vf "fps=12,scale=720:-2,chromakey=0x00FF00:0.10:0.08,despill=type=green" -c:v libwebp -quality 85 -compression_level 6 -pix_fmt yuva420p walk/f_%04d.webp` (validated yuva420p output). In three.js: photo-frame plane with a stencil/clip opening, second alpha-textured Kitty plane (`transparent`, `alphaTest 0.02`, `depthWrite false`) moving from behind the mat to in front with slight scale-up and a shadow blob. Stacked-alpha AV1 MP4 (Archibald) only for looping, non-scrubbed beats. **Do not** use rembg's default `bria-rmbg` (CC BY-NC 4.0) or MatAnyone (S-Lab, non-commercial) on the merch site.

### Runner-up
Local **Wan 2.2 TI2V-5B** in ComfyUI (Apache-2.0, fits ~8 GB VRAM with offloading; ~9 min per 5 s 720p on a 4090) — zero per-clip cost, no watermark, photos never leave the machine, but needs an NVIDIA GPU the owner has not listed and produces roughly 10× less motion with near-identical first/last frames. Direct Kling.ai or Google Gemini API are viable off-artta routes (Veo 3.1 $0.40/s ≈ 31p/s; Fast $0.10–0.12/s ≈ 8–9p/s; Lite $0.05–0.08/s ≈ 4–6p/s).

### Comparison table

| Model / tool | First+last frame | Identity refs | 9:16 | Price on artta (credits) | Verdict |
|---|---|---|---|---|---|
| Kling 3.0 | Yes (image 0/2) | Elements 0/3, 2–4 images each; @name across 5 shots | Yes | 39 per 5 s 720p with sound | **Primary** |
| Veo 3.1 | No on artta (Google API: yes) | Reference Mode 1–3 images (Fast) | Yes | 10 per 8 s 720p (+3 1080p, +20 4K) | Cheap establishing shots |
| Wan 2.7 | Yes | Up to 5 refs, negative prompt, seed | Yes | 8/s 720p, 12/s 1080p | Budget bookended transitions |
| Wan 3.0 | Yes (First & Last Frames tab) | — | Yes | 6/12/24 per s at 480/720/1080p | Alternative if 2.7 fails |
| Seedance 2.5 | Yes ("First and Last Frames" mode) | Omni Reference up to 30 images | Yes | 12/23/48 per s at 480/720/1080p | One hero beat only |
| Seedance 2.0 Mini | Yes (per matrix) | 9 images | Yes | 20 per 5 s | Not re-verified |
| Kling 2.6 | No on artta | Single image | Yes | 30 per 5 s no sound | Skip |
| Runway Gen-4.5 / References | Video first-frame only; References for stills | 3 images | — | Not on artta; ~12 cr/s ≈ 46p per 5 s (third-party) | Consistent stills only |
| Luma Ray3.x | Yes (up to 16 keyframes in 3.2, third-party) | Modify (video-to-video) | — | Not on artta; Plus $30 ≈ £23/mo (third-party) | Not chosen |
| Pika 2.2 Pikaframes | 2–5 keyframes | — | — | fal $0.04/s ≈ 3p/s | Not chosen |
| Hailuo 02 FL2V | Yes (legacy model) | — | follows first frame | Not on artta | Not chosen |
| Wan 2.2 (local) | FLF2V node on 14B | — | Yes | £0 | Runner-up (needs GPU) |
| ffmpeg 9.0 | — | — | — | £0 | **Pick** |
| rembg + BiRefNet | — | — | — | £0, MIT | **Pick** for cut-outs |
| Photoroom API | — | — | — | 10 free, then $0.02 ≈ 1.5p/image | Hero cut-outs only |
| MatAnyone | — | — | — | Non-commercial | Do not use |

### Verified facts (browser pane, 2026-09-22 unless noted)
- artta panels: Seedance 2.5 "Credits required: 115" at 5 s 720p, tip "480p costs 12 credits/second; 720p costs 23; 1080p costs 48"; Veo 3.1 10 credits / 8 s, "1080P Output: +3 credits", "4K Output: +20 credits", single Reference Image, "Reference Mode: Use 1-3 reference images with Veo 3.1 Fast"; Kling 3.0 39 credits at 720P/5 s/With Sound, "Upload Media image (0/2) First Frame", "Element References 0/3", "Shot List Total: 0s / 15s, Add Shot (0/5)"; Wan 2.7 40 credits / 5 s, "First Frame Only" toggle, Negative Prompt, Seed, "0/5 images uploaded"; Kling 2.6 30 credits, single Reference Image; Wan 3.0 "First & Last Frames" tab at 6/12/24 credits/s. https://artta.ai/image-to-video
- artta pricing: page loads on the "Annually (-30%)" toggle showing $9.90/150, $19.90/350, $34.90/750, $59.90/1,500 per month with "Full 1800 / 4200 / 9000 / 18,000 credits issued once"; the "Monthly" toggle shows Basic $19.90 / 200, Pro $39.90 / 500, Max $69.90 / 1,050, Pro Max $99.90 / 2,100. FAQ: "Monthly subscription credits will not reset on renewal. Annual plans issue the full annual credit bundle up front." Free: "+1 Credit / Claim your free credit every 24 hours". "Remove watermark" and "Commercial usage rights" listed on paid plans. Payments by SHIPMOREFAST LIMITED (UK Co. 16479417). https://artta.ai/pricing
- Kling Element Library: "Characters, Animals, Props, Costumes & Accessories, Scenes, Special Effects, Others"; 2–4 reference images; "The Kling 3.0 model supports binding up to 3 elements in start frame/start and end frames generation" (https://kling.ai/quickstart/klingai-element-library-3-user-guide). Start & End Frames: "Large differences may trigger a shot switch" (https://kling.ai/quickstart/ai-video-start-end-frames). VIDEO 3.0: 3–15 s, 720p/1080p; credits 6/s 720p, 8/s 1080p, +3/+4 with audio (https://kling.ai/quickstart/klingai-video-3-model-user-guide).
- Veo 3.1 Gemini API: 16:9 and 9:16; 4/6/8 s; 720p default, 1080p/4K at 8 s only; Lite has no 4K; extension 720p only, +7 s up to 20×; `lastFrame` requires `image`; up to three reference images; SynthID watermark on every video (https://ai.google.dev/gemini-api/docs/veo). Pricing $0.40/s Veo 3.1, $0.10–0.12/s Fast, $0.05–0.08/s Lite (https://ai.google.dev/gemini-api/docs/pricing).
- ffmpeg re-run on the owner's PC: `ffmpeg version 9.0-full_build-www.gyan.dev` with libwebp, libaom-av1, libsvtav1, chromakey/despill/alphaextract/vstack; synthetic 1080×1920 5 s → 60 WebP q80 = 1,532,864 B; 120 frames at 24 fps = 3,064,884 B; 60 libaom AVIF = 1,096,492 B; RGBA→libwebp yuva420p confirmed; libsvtav1 `avif=1` to an image2 sequence fails.
- Licences: BiRefNet MIT (https://huggingface.co/ZhengPeng7/BiRefNet); BRIA RMBG-2.0 CC BY-NC 4.0 (https://huggingface.co/briaai/RMBG-2.0); rembg default is `bria-rmbg`, MIT repo, Python ≥3.11 <3.14 (https://raw.githubusercontent.com/danielgatis/rembg/main/README.md); MatAnyone S-Lab License 1.0 (https://raw.githubusercontent.com/pq-yang/MatAnyone/main/LICENSE).
- Wan 2.2 open weights and ComfyUI notes (https://github.com/Wan-Video/Wan2.2 , https://docs.comfy.org/tutorials/video/wan/wan2_2). First/last-frame model matrix and end-frame-ignored findings (https://mer.vin/2026/09/which-ai-video-models-actually-take-a-first-and-last-frame/). Stacked-alpha video technique (https://jakearchibald.com/2024/video-with-transparency/). Scroll-sequence budgets (https://gsapvault.com/blog/scroll-image-sequence-tutorial). MiniMax FL2V (https://platform.minimax.io/docs/api-reference/video-generation-fl2v). Pikaframes (https://fal.ai/models/fal-ai/pika/v2.2/pikaframes). Photoroom API pricing (https://www.photoroom.com/api/pricing).

### Refuted or corrected claims (do not repeat)
- **"artta monthly plans are $9.90/150, $19.90/350, $34.90/750, $59.90/1,500"** — refuted. Those are annual-billing prices charged as a whole year up front (≈ $118.80 / $238.80 / $418.80 / $718.80 ≈ £91 / £184 / £322 / £553). Month-to-month: $19.90/200, $39.90/500, $69.90/1,050, $99.90/2,100.
- **"Kling warns of a 'lens switch'"** — current wording is "shot switch" (same meaning).
- **"Kling audio adds a flat +4 credits/s"** — it is +3/s at 720p and +4/s at 1080p.
- **"Veo reference images cannot be combined with a first frame"** — not stated explicitly in the Gemini docs; inferred from separate parameter modes. Test once before building a workflow on it.
- ffmpeg sizes were 1.5 / 3.1 / 1.1 MB on re-run rather than 1.6 / 3.4 / 1.3 MB — same conclusions, still synthetic.
- Seedance 2.0 Mini's first/last panel and 20-credit price were not re-opened in verification (unverified, consistent with the third-party matrix).

### Unknowns still open
- Which upstream provider artta routes each model to; whether outputs are re-encoded; whether artta's Kling 3.0 Element binding behaves identically to kling.ai's.
- Whether artta free-tier outputs are visibly watermarked (implied).
- No vendor benchmark for keeping a specific real cat's markings consistent — validate with 2–3 test clips before committing credits.
- Real-footage frame sizes (synthetic measurement only; expect 35–70 KB per 720-px photographic WebP frame).
- Runway, Luma, Pika, Hailuo pricing/free-tier/watermark figures are third-party; Photoroom consumer-app watermark policy inconsistent across sources.
- The owner's PC GPU (needed for local Wan 2.2 / BiRefNet-on-GPU).
- Provider-dependent end-frame handling on "Kling v2.6" endpoints.

### Cost (GBP)
- artta monthly: Basic ≈ £15.30 (200 cr), **Pro ≈ £30.70 (500 cr) — recommended for production months**, Max ≈ £53.80 (1,050), Pro Max ≈ £76.80 (2,100). Annual Pro ≈ £184 once for 4,200 credits.
- Per clip on monthly Pro (≈ 6.1p/credit): Kling 3.0 5 s ≈ £2.40; Veo 3.1 8 s ≈ 61p; Wan 2.7 5 s ≈ £2.45; Seedance 2.5 5 s ≈ £7.05.
- ffmpeg, rembg/BiRefNet, manifest script: £0. Photoroom hero cut-outs ≈ 1.5p each after 10 free. Wan 2.2 local: £0 if a suitable GPU exists.

---

## Decisions locked for the build

### npm packages (exact versions verified on the registry 2026-09-20/22)
- `next@16.3.x` (docs at 16.3.5; App Router, Node runtime for all Stripe/POD routes, `after()`), `react@19.x`, `tailwindcss@4.x`
- `gsap@3.15.0`, `@gsap/react@2.1.2`
- `lenis@1.3.26`
- `@react-three/fiber@9.7.0`, `@react-three/drei@10.7.8`, `three@0.186.0` (0.185 also satisfies every peer range; Spark needs ≥0.180)
- `motion@13.4.0` (LazyMotion only; import from `motion/react`)
- `react-parallax-tilt@1.7.343`
- `@use-gesture/react@10.3.1`
- `@cloudimage/360-view@4.10.0` (or hand-rolled canvas turntable)
- `@sparkjsdev/spark@2.2.0` (GLB/splat phase)
- `@mediapipe/tasks-vision@0.10.17` (pinned to drei's dependency; self-host wasm + `.task` under `/public/mediapipe/`)
- `stripe@22.6.2` (API `2026-08-26.dahlia`); `@stripe/stripe-js` + `@stripe/react-stripe-js` latest for Phase-2 Express Checkout Element (versions not verified in this research)
- `@supabase/supabase-js` latest (version not verified), `server-only`
- `resend` latest + `@react-email/components` (versions not verified)
- `zustand` (tracking store; version not verified)
- `three-mesh-bvh` (collider; version not verified)
- CLI tools: `shadcn@4.21.0`, `jsrepo@3.8.1` (component pulls from Aceternity / Magic UI / ReactBits — owned source, not runtime deps), `@gltf-transform/cli` (cat + collider compression)
- **Explicitly not installed:** `scrolly-video`, `@splinetool/*`, `@theatre/*`, `ogl`, `curtainsjs`, `gpu-curtains`, `mind-ar`, `@mkkellogg/gaussian-splats-3d`, `react-bits` (unrelated 2022 package), `@14islands/r3f-scroll-rig`

### Providers and plans
- **Vercel Pro**, Functions region `lhr1`, production webhook URL only in Stripe live; previews via `x-vercel-protection-bypass`. Cron `/api/cron/reconcile` every 15 min.
- **Supabase Pro**, London region, `sb_secret_` key server-side only; Realtime `postgres_changes` on `kitty_state`; RLS on every table.
- **Stripe**: general sandbox + live; hosted Checkout Sessions; Onelink/Apple Pay/Google Pay via dynamic payment methods; `automatic_tax` disabled until £90k rolling turnover; payment-method domain registration only when the Express Checkout Element ships.
- **Printful** (UK fulfilment, Wolverhampton) via API v1 with v2 paths behind a flag; **Inkthreadable** as fallback (polling cron); **3rd Rail Clothing** (SE16 4DU) / Live Ink / Fifth Column for a screen-print pre-order batch.
- **Resend** free tier with a verified sending domain.
- **artta.ai** monthly Pro ($39.90) during production months (or annual Pro if committed); models Kling 3.0 (Element "Kitty"), Veo 3.1, Wan 2.7; Seedance 2.5 once.
- **RealityScan 2.2** (free tier) → **LichtFeld Studio** (if RTX 20+) or **Brush 0.3.0** → **SuperSplat 3.0** → SOG.
- **ESPresense v4.0.6** on 3× ESP32-C3/S3 + **Mosquitto** on the Pi 4 + **BeaconZone E8** (or PC038) collar beacon.
- **Quaternius CC0 cat** (Poly Pizza `qKICY6xla2`) mirrored into `/public/models/kitty.glb`; **OGA CC0 DSLR camera** for the hero.
- **MediaPipe Tasks Vision** for try-on; **Snap Camera Kit Web** as the gated upgrade.

### API endpoints (exact)
- Stripe: `POST https://api.stripe.com/v1/checkout/sessions` (via SDK `stripe.checkout.sessions.create`), `GET .../checkout/sessions/{id}?expand[]=line_items`; webhook events `checkout.session.completed`, `checkout.session.async_payment_succeeded`; Stripe.js `https://js.stripe.com/dahlia/stripe.js`.
- Printful v1: `GET https://api.printful.com/products/{id}`, `POST https://api.printful.com/shipping/rates`, `POST https://api.printful.com/orders`, `POST https://api.printful.com/orders/{id}/confirm`, `POST https://api.printful.com/webhooks` (types `package_shipped`, `order_failed`, `order_canceled`), `POST https://api.printful.com/mockup-generator/create-task/{id}`; headers `Authorization: Bearer <token>`, `X-PF-Store-Id`. v2 (Open Beta, flagged): `GET /v2/catalog-products/{id}/catalog-variants`, `GET /v2/catalog-variants/{id}/prices`, `POST /v2/shipping-rates`, `POST /v2/orders`, `POST /v2/orders/{id}/confirm`, `POST /v2/webhooks`, `POST /v2/mockup-tasks`.
- Inkthreadable (fallback): `POST https://www.inkthreadable.co.uk/api/orders.php?AppId=…&Signature=SHA1(body+secret)`, `GET https://www.inkthreadable.co.uk/api/orders.php?since_id=&format=JSON`, `GET https://www.inkthreadable.co.uk/api/order.php?id=`.
- Printify (alternate adapter, corroborated not primary-verified): `POST https://api.printify.com/v1/shops/{shop_id}/orders.json`, `POST .../orders/{order_id}/send_to_production.json`, `POST .../orders/shipping.json`, `POST https://api.printify.com/v1/shops/{shop_id}/webhooks.json`, `GET https://api.printify.com/v1/catalog/blueprints/{id}/print_providers.json`; header `X-Pfy-Signature: sha256=<hex HMAC-SHA256(raw body)>`.
- Supabase: PostgREST `POST {SUPABASE_URL}/rest/v1/kitty_positions`, `POST {SUPABASE_URL}/rest/v1/kitty_state` (upsert) from the Pi; Realtime channel `.on('postgres_changes', { schema:'public', table:'kitty_state', event:'UPDATE' })` from the browser.
- Resend: `POST https://api.resend.com/emails` with `Idempotency-Key` (SDK `resend.emails.send(..., { idempotencyKey })`).
- Next.js route handlers: `POST /api/stripe/checkout`, `POST /api/stripe/snack`, `POST /api/stripe/webhook`, `POST /api/pod/webhook` (Printful), `GET /api/cron/reconcile`, `GET /api/kitty` (cached tracker fallback).
- MQTT (LAN): `espresense/devices/<beaconId>/<room>` on the Pi's Mosquitto.
- MediaPipe assets: self-hosted `/mediapipe/wasm/` and `/mediapipe/models/face_landmarker.task`, `/mediapipe/models/pose_landmarker_lite.task`.
- Google Gemini Veo (only if going off-artta): `models/veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`.

### Asset pipeline commands locked
- Story frames: `ffmpeg -i clip.mp4 -vf "fps=12,scale=720:-2:flags=lanczos" -c:v libwebp -quality 80 -compression_level 6 -preset photo -pix_fmt yuv420p public/story/<scene>/f_%04d.webp`
- Alpha walk-out: `ffmpeg -i walk.mp4 -vf "fps=12,scale=720:-2,chromakey=0x00FF00:0.10:0.08,despill=type=green" -c:v libwebp -quality 85 -compression_level 6 -pix_fmt yuva420p public/story/walk/f_%04d.webp`
- Last frame for chaining: `ffmpeg -sseof -0.05 -i A.mp4 -frames:v 1 -update 1 A_last.png`
- Cut-outs: `rembg p -m birefnet-general -a in_frames out_frames`
- Cat GLB: Blender export with actions → `gltf-transform optimize kitty.glb kitty.opt.glb --compress meshopt --texture-compress webp`
- Scan: RealityScan → Export Model (.glb, texture side ≤8192) + Alignment → COLMAP folder → LichtFeld/Brush → SuperSplat → `room.sog`; collider 30–50k tris UV-stripped GLB.
