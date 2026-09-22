# Kitty — architecture and build contract

Mobile-first (design at **390 × 844**, verify there first), dark, cinematic.
Next.js 16 App Router · React 19.2 · React Three Fiber 9 · three 0.186 · drei 10 ·
GSAP 3.15 (ScrollTrigger is free) · Lenis 1.3 · Tailwind 4 · zustand 5 ·
Supabase JS 2 · Stripe 22 · @anthropic-ai/sdk 0.127. Hosted on Vercel; DB on Supabase.

Everything a non-developer edits lives in `src/config/*`:

| File | Owns |
|---|---|
| `src/config/site.ts` | name, tagline, nav labels/hrefs, places |
| `src/config/story.ts` | the ordered scenes (`STORY`), turntable settings |
| `src/config/products.ts` | the three products, variants, prices (pence), shipping, the £1 snack |
| `src/config/stories.ts` | short "Kitty Stories" vignettes for `/stories` |
| `src/config/kitty.ts` | Kitty's chat persona (system prompt), opening line "Check this out" |

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing: hero camera (top third) → scroll story → 360° turntable → two buttons |
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
| `src/components/chrome/*` | `default Chrome()` | Fixed top-right translucent **three-line-stack** button; side drawer with `Kitty Stories`, `Kitty Store`, `Scroll to top`, `Scroll to bottom`; floating small camera button (bottom-right) that opens the try-on. Rendered on every page via `src/app/layout.tsx`? **No** — rendered by each page so the landing can hide the small camera while the hero camera is on screen. |
| `src/components/hero/*` | `default Hero()` | R3F canvas filling the **top third of a phone screen** (`h-[34dvh]`): a stylised camera model that spins slowly, tilts, and bounces slightly; tap → `/try-on`. Title `Kitty`, tagline, scroll cue. Build the camera procedurally from primitives (body box, lens cylinders, flash, strap) so there is no licence and no download; a GLB at `/models/camera.glb` overrides it if present. |
| `src/components/story/*` | `default Story()`, `default StoryEnd()` | The scroll engine. Per scene: a full-viewport pinned section (`pinLength` × 100dvh), a `<canvas>` painting the WebP frame sequence from `/story/<id>/manifest.json` scrubbed by ScrollTrigger progress, beats fading in one by one, transitions per `enter`/`exit`. Scenes with no manifest render a designed placeholder (kicker, title, beats on a gradient) so the page is complete with zero assets. Preload the next scene's frames while the current is pinned; decode with `createImageBitmap`; cap in-memory frames to ~3 scenes. `StoryEnd` = Turntable + the two big buttons. |
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

- `@anthropic-ai/sdk`, `client.messages.stream(...)`, `model: "claude-opus-5"`,
  `output_config: { effort: "low" }` (a cat persona does not need deep reasoning),
  `max_tokens: 1024`, system prompt from `src/config/kitty.ts` with
  `cache_control: { type: "ephemeral" }` on the stable system block, product
  context appended as a **second** system block after it.
- Route returns a `text/plain` streaming `Response` built from `stream.on("text")`.
- No API key → route returns a canned, in-character reply so the UI still works.

## Assets and slots (all optional; the site is complete without them)

| Path | What | Made by |
|---|---|---|
| `public/story/<scene-id>/0001..NNNN.webp` + `manifest.json` | frame sequences | `npm run story` from `assets-raw/story/<id>/clip.mp4` |
| `public/story/index.json` | which scenes have media | same |
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
(+ `chapter_builds`, the owner's private notes). Kitty is the pet in
`SITE.petSlug`. Schema and policies: `supabase/migrations/`; Kitty's content:
`supabase/seed/kitty.sql`; RLS smoke test: `supabase/tests/rls-smoke.sql`.

| Route | What it is |
|---|---|
| `/stories` | The book: volumes and chapter tiles. Editors: Edit switch → drag tiles (RippleGrid springs), tile editor, volume editor |
| `/stories/<chapter>` | Continuous reader across chapters and volumes, both directions; URL follows the chapter on screen |
| `/stories/new?volume=<slug>` | Chapter studio: photos + "what happened" → Claude draft → scenes with Kling prompts |
| `/stories/<chapter>/edit` | The same studio for an existing chapter: scenes, prompts, 9:16 start frames, clip upload |
| `/account` | Sign in / create account / forgotten password / set new password |
| `/admin` | Admin-only dashboard (Kitty Tunables arrive in Phase 3) |
| `/api/chapters/draft` | Claude Opus 5 drafts a chapter from photos + text (editors only, structured output, fallbacks) |
| `/api/admin/status` | Which services this deployment has keys for (admins only) |

| Module | Owns |
|---|---|
| `src/lib/supabase/{config,browser,server,sessionHint}.ts` | Env, clients (browser session; server anon and "as the caller"), demo switch (`?demo=1`) |
| `src/lib/auth/{authLanding,store}.ts` | Reset/confirm link capture before supabase-js consumes it; the auth store (live or pretend) |
| `src/lib/stories/{types,read,client,media,draft}.ts` | Shapes and row mapping; server reads; browser writes (live + demo backends); photo resizing; draft schema |
| `src/lib/studio/frames.ts` | Browser-side clip → frames and 9:16 start-frame crops |
| `src/components/stories/*` | RippleGrid, TileFace, TileEditor, VolumeEditor |
| `src/components/reader/*` | ChapterReader, ReaderScene |
| `src/components/studio/*` | ChapterStudio, SceneCard |

Rules that hold everywhere: RLS is the boundary (the UI only mirrors it);
demo mode must always work; `?demo=1` for any test that writes; never commit
`assets-raw/` media or anything with third parties' personal details.
