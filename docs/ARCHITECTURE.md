# Kitty — architecture and build contract

Mobile-first (design at **390 × 844**, verify there first), dark, cinematic.
Next.js 16 App Router · React 19.2 · React Three Fiber 9 · three 0.186 · drei 10 ·
GSAP 3.15 (ScrollTrigger is free) · Lenis 1.3 · Tailwind 4 · zustand 5 ·
Supabase JS 2 · Stripe 22 · @anthropic-ai/sdk 0.127. Hosted on Vercel; DB on Supabase.

Everything a non-developer edits lives in `src/config/*`:

| File | Owns |
|---|---|
| `src/config/site.ts` | name, tagline, nav labels/hrefs, places |
| `src/config/story.ts` | the four landing chapters (`STORY`: titles, captions, entrances), the WhatsApp chat and where its photo lands, the kitten photos, turntable settings |
| `src/config/products.ts` | the three products, variants, prices (pence), shipping, the £1 snack |
| `src/config/stories.ts` | short "Kitty Stories" vignettes for `/stories` |
| `src/config/kitty.ts` | The fixed parts of Kitty's chat persona (identity, story, style, rules) and the default opening line; the sliders and notes are Kitty Tunables on `/admin` (`src/lib/persona.ts` compiles both into her system prompt) |

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing: hero camera (top third) → swipe story (four chapters) → 360° turntable → two buttons |
| `/stories` | Kitty Stories: vignettes, updated over time |
| `/store` | The in-game store: 3D living room, Kitty presents products, chat dock, next/prev, buy |
| `/try-on` | Camera try-on: live camera + merch overlay + Kitty beside the person |
| `/checkout/success` | Post-Stripe thank-you, shows order summary |
| `/api/chat` | Streaming Claude route for "chat with Kitty" |
| `/api/checkout` | Creates a Stripe Checkout Session (merch) |
| `/api/snack` | Creates a Stripe Checkout Session for the £1 snack |
| `/api/webhooks/stripe` | Verified webhook → Supabase orders → print-on-demand order |
| `/api/webhooks/pod` | Print provider shipment webhook → order status + email |

## Shared client state — `src/lib/store.ts` (zustand)

```ts
drawerOpen, setDrawerOpen(b)         // hamburger side drawer
cameraOpen, setCameraOpen(b)         // try-on overlay (also reachable at /try-on)
productIndex, setProductIndex(i)     // which product Kitty is presenting
chatOpen, setChatOpen(b)
toast, showToast(msg)
```

## Component ownership (one agent per row; never edit another row's files)

| Directory | Exports | Notes |
|---|---|---|
| `src/components/smooth/SmoothScroll.tsx` | `default SmoothScroll({children})` | Lenis + `gsap.ticker`, `ScrollTrigger.scrollerProxy` not needed (Lenis drives native scroll). Respects reduced motion. Exposes `window.__lenis` for scroll-to helpers. |
| `src/components/chrome/*` | `default Chrome()` | **Kitty's face** (`KittyFace.tsx`, also the favicon and Apple touch icon) in a 44px glass button top-left: home from every page, back to the top on the landing. Fixed top-right translucent **three-line-stack** button; side drawer that starts with Kitty (home), then `Kitty Stories`, `Kitty Store`, `Try it on`, `Sign in`/`Your account`, `Scroll to top`, `Scroll to bottom`, the current page marked; floating small camera button (bottom-right) that opens the try-on, hidden with `hideCamera` where it would cover buttons (landing, store, checkout, the try-on itself). `layout.ts` exports the chrome row's geometry for pages that put controls near it. Rendered by each page, not the root layout. |
| `src/components/hero/*` | `default Hero()` | R3F canvas filling the **top third of a phone screen** (`h-[34dvh]`): a stylised camera model that spins slowly, tilts, and bounces slightly; tap → `/try-on`. Title `Kitty`, tagline, scroll cue. Build the camera procedurally from primitives (body box, lens cylinders, flash, strap) so there is no licence and no download; a GLB at `/models/camera.glb` overrides it if present. |
| `src/components/landing/SwipeStory/*` | `default SwipeStory()` | The landing story, played by swipes (since 23 Sep 2026; it replaced the scroll-scrubbed engine). One 100dvh stage under the hero: a canvas for the clip frames plus DOM layers for the choreography. `timeline.ts` turns the chapters into one timeline of seconds with a **stop** per chapter and makes every visual a pure function of the playhead (so reversing and hold-and-drag scrubbing need nothing special); `engine.ts` owns the playhead, the gestures (swipe, wheel, keys, press-and-hold to pause, drag to scrub) and the page modes (intro under the hero → engaged full screen → released after the last stop or Skip); `painter.ts` draws frames (blended pairs, cover on phones, a 9:16 column over a blurred copy when wide); `overlays.ts` writes the WhatsApp flight, the kitten polaroids and clock, the MISSING flyer, the stand-in moods, the assembling captions and the rail; `media.ts` loads `index.json`, manifests and every chapter's final frame (kept), keeps every frame's compressed bytes, and decodes only a **window** around the playhead (≈30 frames on phones, ≈70 on computers, leading the way it moves, plus the next chapter's first frames), because a whole decoded clip is 170 MB and iOS Safari will not hold two; broken frames are retried, then skipped. `report.ts` sends one anonymous technical summary per visit to `/api/story-report` (see Platform). Chapters without a clip play a designed stand-in and pick their clip up after `npm run story`. `prefers-reduced-motion`: stills and crossfades, captions already set. `window.__swipeStory.debugState()` / `debugSeek(t)` exist for `scripts/verify.mjs`. |
| `src/components/story/*` | `default StoryEnd()`, frame loading | `StoryEnd` = Turntable + the two big buttons. `frameLoader.ts` (limiter, manifests, decode) and `useFrameSequence.ts` (`SequenceController`) are shared by SwipeStory, the chapter reader and the turntable. |
| `src/components/turntable/*` | `default Turntable()` | Swipe/drag to spin Kitty using N photos from `/turntable/manifest.json`; inertia; falls back to a single placeholder silhouette when absent. |
| `src/components/store/*` + `src/app/store/page.tsx` | `default StoreScene()` | R3F living room (a placeholder room built from primitives until `/models/room.glb` exists — window with river light, sofa, kitchen counter), Kitty NPC (`/models/kitty.glb` if present, else a procedural black-and-white cat) walking between "presentation spots", the current product floating and rotating beside her, `Next`/`Previous` arrows, product panel (name, method, price, variant picker, **Buy** → `POST /api/checkout`), chat dock. Kitty always opens with `KITTY.opening` ("Check this out"). |
| `src/components/chat/*` + `src/app/api/chat/route.ts` | `default ChatDock()` | Streams from `/api/chat` (Claude, see below). Keeps last 12 turns client-side. Product context injected server-side from `productIndex` sent with each message. |
| `src/lib/commerce/*`, `src/app/api/{checkout,snack,webhooks}/**`, `supabase/commerce.sql` (Phase 6), `src/app/checkout/success/page.tsx` | | Stripe Checkout Sessions, verified webhooks, Supabase orders, print-on-demand adapter with a **demo implementation** when env is unset. |
| `src/components/ar/*` + `src/app/try-on/page.tsx` | `default TryOn()` | `getUserMedia` (front/back switch), MediaPipe Pose/Face landmarks → cap on head / hoodie on torso as 2D overlays (product `images.front` cut-outs) with smoothing; a small R3F Kitty on an assumed floor plane at the bottom of the frame; capture-to-PNG share button. Must degrade gracefully (no camera permission → explanation + static mockup). |
| `src/app/stories/page.tsx` + `src/config/stories.ts` | | Vignette cards. |
| `scripts/verify.mjs` | | Playwright, production build, 390 px + desktop, pixel readback on canvases, hit-test every control, reload check. Modelled on Birthday Lobby's harness. |

## Backend rule (from `ibd`): demo-mode-first

One interface, two implementations, chosen at runtime by env presence:

```ts
export function getCommerce(): Commerce { return isConfigured ? real() : demo(); }
```

With no env vars the whole site runs, checkout returns a fake session page,
and a persistent banner says **DEMO** so nobody mistakes it for live.

## Money rule (from `game-economy`)

Real money only. There is **no play economy** in v1. Orders and snack payments
are append-only tables written solely by the Stripe webhook using the service
role key on the server; the browser never writes them. RLS on, no client policies.

## Claude chat (from the `claude-api` skill)

- `@anthropic-ai/sdk`, `client.beta.messages.stream(...)`, `model: "claude-opus-5"`,
  `output_config: { effort }` from the Tunables (default `low`: a cat persona
  does not need deep reasoning), `max_tokens: 1024`, server-side refusal
  fallbacks on (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`).
- System prompt = `compileSystem(tunables)` (`src/lib/persona.ts`: the fixed
  persona in `src/config/kitty.ts` + the sliders' sentences + her human's notes;
  deterministic, so it stays cached until someone saves new Tunables) with
  `cache_control: { type: "ephemeral" }`, product context appended as a
  **second** system block after it. Tunables are read from `pet_personas` with a
  one-minute memory and are never taken from the request body.
- Route returns a `text/plain` streaming `Response` built from `stream.on("text")`;
  a turn that ends with no text (a refusal the fallbacks could not rescue) gets
  an in-character line.
- No API key → route returns a canned, in-character reply so the UI still works.

## Assets and slots (all optional; the site is complete without them)

| Path | What | Made by |
|---|---|---|
| `public/story/<scene-id>/0001..NNNN.webp` + `manifest.json` | frame sequences | `npm run story` from `assets-raw/story/<id>/clip.mp4` |
| `public/story/index.json` | which scenes have media | same |
| `public/story/whatsapp-chat.webp` + `.json` | the neighbours' chat, blurred, and where its photo sits (layout numbers only) | same, from `assets-raw/ui/whatsapp/`; `node scripts/align-chat.mjs` measures where that photo lands in clip 1's final frame |
| `public/story/flyer.webp` | the real MISSING flyer (a drawn one until then) | same, from `assets-raw/ui/flyer/` |
| `public/turntable/*.webp` + `manifest.json` | 360° photos | same, from `assets-raw/turntable/*.jpg` |
| `public/products/*.png` | mockups (transparent) | provider mockup generator or Photoroom |
| `public/models/{camera,kitty,room}.glb` | 3D | Blender / scan pipeline (later) |
| `public/og.png` | share image | later |

## Performance budget (phone)

- Landing first paint < 2.5 s on 4G: hero canvas only, story frames lazy.
- ≤ 3 scenes of frames decoded at once (~250 bitmaps × ~1 MB = fine; 11 scenes is not).
- One R3F canvas per page; `frameloop="demand"` when idle.
- No texture over 2048², KTX2 for the room scan (see `scan-to-web`).

---

## Platform (added 22 Sep 2026)

Multi-pet from the start: **pets → volumes → chapters → chapter_scenes**
(+ `chapter_builds`, the owner's private notes; `pet_personas`, each pet's
chat Tunables, public read and editor write; `story_reports`, anonymous
landing diagnostics written only through `report_story()`, capped at 2000 a
day and 30 days, admin read). Kitty is the pet in
`SITE.petSlug`. Schema and policies: `supabase/migrations/`; Kitty's content:
`supabase/seed/kitty.sql`; RLS smoke test: `supabase/tests/rls-smoke.sql`.

| Route | What it is |
|---|---|
| `/stories` | The book: volumes and chapter tiles. Editors: Edit switch → drag tiles (RippleGrid springs), tile editor, volume editor |
| `/stories/<chapter>` | Continuous reader across chapters and volumes, both directions; URL follows the chapter on screen |
| `/stories/new?volume=<slug>` | Chapter studio: photos + "what happened" → Claude draft → scenes with Kling prompts |
| `/stories/<chapter>/edit` | The same studio for an existing chapter: scenes, prompts, 9:16 start frames, clip upload |
| `/account` | Sign in / create account / forgotten password / set new password |
| `/admin` | Admin-only dashboard: **Kitty Tunables** (sliders, length, effort, opening line, notes; live preview of her full instructions), connected services, the book at a glance |
| `/api/chapters/draft` | Claude Opus 5 drafts a chapter from photos + text (editors only, structured output, fallbacks) |
| `/api/admin/status` | Which services this deployment has keys for (admins only) |
| `/api/story-report` | One anonymous technical summary of how the landing story went on a device (sendBeacon); stored via `report_story()` |

| Module | Owns |
|---|---|
| `src/lib/supabase/{config,browser,server,sessionHint}.ts` | Env, clients (browser session; server anon and "as the caller"), demo switch (`?demo=1`) |
| `src/lib/auth/{authLanding,store}.ts` | Reset/confirm link capture before supabase-js consumes it; the auth store (live or pretend) |
| `src/lib/stories/{types,read,client,media,draft}.ts` | Shapes and row mapping; server reads; browser writes (live + demo backends); photo resizing; draft schema |
| `src/lib/studio/frames.ts` | Browser-side clip → frames and 9:16 start-frame crops |
| `src/lib/persona.ts`, `personaServer.ts`, `personaClient.ts` | Kitty Tunables: types, defaults, validation, the deterministic prompt compiler; the chat route's cached read; the browser's read/save (demo: localStorage) and `useOpeningLine()` |
| `src/components/admin/TunablesEditor.tsx` | The Tunables editor on `/admin` |
| `src/components/stories/*` | RippleGrid, TileFace, TileEditor, VolumeEditor |
| `src/components/reader/*` | ChapterReader, ReaderScene |
| `src/components/studio/*` | ChapterStudio, SceneCard |

Rules that hold everywhere: RLS is the boundary (the UI only mirrors it);
demo mode must always work; `?demo=1` for any test that writes; never commit
`assets-raw/` media or anything with third parties' personal details.
