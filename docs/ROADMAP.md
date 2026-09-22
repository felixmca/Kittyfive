# Kittyfive roadmap

*Last updated 22 Sep 2026. This is the plan every session starts from: find the
first unchecked box in the current phase, do it, tick it, deploy.*

## What we are building

**Kittyfive is an open-source pet story platform, and Kitty is its first pet.**
A phone-first site where a pet's life plays as you scroll (real photos brought
to life as short AI clips), organised like a book: **volumes** hold
**chapters**, and every chapter is its own scrollable page. Owners make a
chapter from a few photos and a description of what happened. Around the stories
sit a 3D **store** where the pet walks you through the merch and talks back,
a camera **try-on**, and later **email and WhatsApp** delivery of new chapters.
Anyone can run their own; the hosted version will let people make "[pet name]
Stories" and, for £19 a month, their own store.

The three pillars, in Kitty's words:

1. **Kitty Stories**: photos + "what happened" → a short AI-animated scroll page
   (a chapter). The landing page story is the long version.
2. **Divisions of the book** (the `/stories` page): volumes → chapter tiles you
   can customise and drag into order; read straight through chapters and
   volumes by scrolling.
3. **Kitty Store**: explore the house, chat with Kitty (personality tuned from
   the admin dashboard), buy the merch.

## Phase map

| Phase | Ships | Needs Felix | Status |
|---|---|---|---|
| **0 · Foundation** | Story engine, store, try-on, commerce adapters, verify harness, research | — | ✅ done 21–22 Sep |
| **1 · The landing story** | Six AI chapters stitched into the landing scroll | Six clips on artta ([Handover 01](HANDOVER-01-STORY-ASSETS.md)) | 🟡 Felix generating; code in progress |
| **2 · The Stories page** | Platform foundation (GitHub, Supabase, auth, deploy) · volumes and chapter tiles · tile editor · drag with ripple · continuous chapter reader · chapter builder | Supabase URL settings; sign up once | 🟡 in progress |
| **3 · The Store** | Stylised, animated 3D living room + garden, Kitty tour, products, chat with Kitty + Kitty Tunables | Room and garden reference photos | ⬜ next |
| **4 · Real try-on** | 3D cap on the head, garments warped to the body with real shading | — | ⬜ |
| **5 · Subscribe by email** | Accounts subscribe to a pet's stories; new chapter → email | A domain for sending mail; Resend | ⬜ |
| **6 · Kitty's store takes money** | Printful UK, Stripe live, order emails | Stripe, Printful, Vercel Pro, Supabase Pro | ⬜ |
| **7 · Your pet, your story** | Anyone signs up and makes their own pet's stories | Licence choice; generation budget | ⬜ |
| **8 · Stores for everyone** | £19/month store subscription with payouts | Stripe Billing + Connect | ⬜ |
| **9 · WhatsApp tier** | New chapters by WhatsApp for subscribers | WhatsApp Business number | ⬜ |
| **10 · Where is Kitty** | BLE beacon → Kitty's live position in the 3D house | ~£40 of parts | ⬜ |
| **11 · Hardware** | £1 snack dispenser + live camera | Build the dispenser | ⬜ |

Rule for every phase: **build → verify (`npm run verify`) → push to `main` →
Vercel deploys → smoke-test production → tick the boxes here → update memory.**

---

## Phase 1 · The landing story

Six chapters, one Kling 3.0 clip each, played in order by the scroll. Each
chapter also lives in its volume on the Stories page.

| # | Chapter | Volume | Transition out |
|---|---|---|---|
| 1 | A cold night | The back door (new) | zoom |
| 2 | Five by dawn | The cupboard | Kitty walks out of the frame |
| 3 | A flat on the Thames | The sofa on the river | the flyer falls |
| 4 | Thousands of flyers | What the flyer said | crossfade |
| 5 | And there she was | The neighbour | slide up |
| 6 | Next to me | The sofa on the river | → turntable, then the two buttons |

**Felix**
- [ ] Six clips, start frames and extras into `assets-raw/story/<chapter>/`
- [ ] `ui/flyer/`, `ui/cutout/`, `ui/portrait/`
- [ ] Optional: `kitty-identity/`, `turntable/`

**Code**
- [x] Handover 01 rewritten for six chapters; folder tree created; raw media git-ignored
- [ ] Story config → six chapters (kickers, beats, transitions above)
- [ ] Pipeline reads the new layout: newest file in `clip/`, `start-frame/` as the
      still fallback (slow push-in), `extras/` → web-size WebP, HEIC converted
- [ ] `ui/flyer` → the falling flyer; `ui/cutout` → the walking Kitty;
      `ui/portrait` → `og.png` share image and the story's last frame
- [ ] A strip of the real photos (extras) at the end of each chapter
- [ ] When clips land: tune each chapter's scroll length and beat timing to the footage
- [ ] Verify at 390×844 and 1280×800, deploy

**Done when** scrolling the production site on an iPhone plays all six chapters
in order without stutter, and every chapter opens from its volume.

---

## Phase 2 · The Stories page

### 2A · Platform foundation *(this session)*
- [ ] Git repo pushed to `github.com/felixmca/Kittyfive` (public). Secrets
      scanned; `.env.local` and raw media ignored
- [ ] Supabase schema as migrations in `supabase/migrations/` (applied through
      the Supabase MCP and mirrored as files): `profiles`, `admins` +
      `is_admin()`, `pets`, `volumes`, `chapters`, `chapter_scenes`, storage
      bucket `story-media`, commerce tables. RLS on everything
- [ ] Auth like Birthday Lobby: email + password, confirm email, forgotten
      password, set new password, sign out. `/account`
- [ ] Admin: Felix's address in `admins` (seeded in the database, not the public
      repo); `/admin` shell
- [ ] Vercel: env vars, function region next to the database (Frankfurt), first
      production deploy
- [ ] **Felix:** Supabase → Authentication → URL Configuration: Site URL
      `https://kittyfive.vercel.app`; Redirect URLs `https://kittyfive.vercel.app/**`,
      `http://localhost:3200/**`, `http://localhost:3201/**`
- [ ] **Felix:** sign up on the live site with your admin address and click the
      confirmation email (that makes you admin, and admins edit Kitty)

### 2B · Volumes and chapter tiles
- [ ] Kitty seeded: seven volumes (the six vignettes + "The back door"), the six
      landing chapters inside them
- [ ] `/stories` renders volumes and chapter tiles from Supabase (config
      fallback in demo mode)
- [ ] Chapter tile face: date, title, subtitle, description, up to two
      background images blended with a gradient
- [ ] Owner mode: add, edit and delete volumes; tile editor with live preview;
      image upload
- [ ] Drag chapter tiles to reorder, with spring physics: neighbours are pushed
      away and pulled back, and the motion ripples down the row. Touch, mouse
      and keyboard; order saved

### 2C · The chapter reader
- [ ] Every chapter has its own URL and share preview
- [ ] Scenes: photo with a slow push-in, or clip frames scrubbed by the scroll,
      with beats fading in
- [ ] Continuous reading: scroll past the end of a chapter into the next; past
      the end of a volume into the next volume; scroll up from the first
      chapter of volume 2 into the last chapter of volume 1. The address bar
      follows the chapter on screen

### 2D · The chapter builder (pillar 1)
- [ ] Upload a few photos and describe what happened
- [ ] Claude (Opus 5, vision) drafts the chapter: title, subtitle, 3–6 scenes
      (photo + beats) and an artta/Kling prompt per scene
- [ ] The chapter works straight away as a photo story (draft until published)
- [ ] Per scene: copy the prompt, download the 9:16 start frame, drop the clip
      artta returns → frames are cut in the browser → the scene animates.
      (artta.ai has no public API, verified 22 Sep 2026; see decisions)

### 2E · Verify and ship
- [ ] Playwright journeys: visitor reads across a volume boundary; owner edits
      a tile, drags a chapter, builds a chapter from fixtures (demo mode, never
      production data)
- [ ] Deploy; smoke-test on a phone

**Done when** Felix can make a new chapter on his phone from photos and a few
sentences, drag it into place, and a visitor can read every chapter of every
volume top to bottom without tapping.

---

## Phase 3 · The Store: a stylised, animated house

Not a photogrammetry scan: a **non-realistic, animated** 3D version of the
living room and garden (think soft low-poly with toon shading), which is cheaper
to render on phones and easier to make charming.

**Felix**
- [ ] Reference photos into `assets-raw/room/`: each corner of the living room,
      the window and river view, the sofa, the kitchen counter, the garden from
      the door and from the far end, anything Kitty loves (brief to follow)
- [ ] Rough room and garden measurements

**Code**
- [ ] Room + garden modelled in Blender (MCP) from the photos: stylised palette,
      baked lighting, one draw-call budget per zone, GLB with Draco/KTX2
- [ ] Kitty: Quaternius CC0 cat retextured as a tuxedo from `kitty-identity/`,
      Walk / Idle / Sit / Jump clips
- [ ] The tour: Kitty walks sofa → window → counter → garden; camera follows;
      river and plants animate; day/evening light
- [ ] Products at spots in the house; product panel and Buy (demo checkout)
- [ ] Chat with Kitty on the real API key; **Kitty Tunables** on `/admin`
      (warmth, dryness, snack obsession, merch pushiness, story references,
      length, opening line, extra notes, model effort) compiled into her system
      prompt
- [ ] Performance: 60 fps on an iPhone 12, first render < 3 s on 4G

## Phase 4 · A more realistic try-on

- [ ] Cap: MediaPipe FaceLandmarker's head transform anchors a 3D cap GLB, an
      invisible head mesh hides the back of the cap, light matched to the
      camera frame
- [ ] Hoodie and long-sleeve: pose + body segmentation; the garment is warped
      to shoulders, hips and elbows (thin-plate spline); the camera's own
      shading is multiplied through so folds show; arms occlude correctly
- [ ] Kitty stands next to you in 3D
- [ ] Upgrade path: Snap Camera Kit Web (application-gated) for draped cloth

## Phase 5 · Subscribe to Kitty Stories by email

Starts only after Phases 1–4 (landing story, store, stories page, try-on).

- [ ] A domain for the site and for sending mail (Resend needs a verified
      domain; `vercel.app` cannot be verified)
- [ ] Supabase Auth sends through Resend SMTP (the built-in mailer sends about
      two emails an hour for the whole project; lesson from Birthday Lobby)
- [ ] Signed-in visitors subscribe to a pet's stories; owners invite people by
      email (double opt-in)
- [ ] Publishing a chapter emails subscribers once: tile image, title, link;
      one-click unsubscribe and `List-Unsubscribe` headers
- [ ] Send log, bounce handling, rate limits

## Phase 6 · Kitty's store takes real money

The commerce code is already built and runs in demo mode (see Decisions).
- [ ] Printful UK products (cap, hoodie embroidery; long-sleeve DTG or a
      screen-print pre-order batch with 3rd Rail Clothing, SE16)
- [ ] Stripe live keys, webhook, Supabase secret key on Vercel
- [ ] Vercel Pro and Supabase Pro before the first sale (Hobby forbids
      commercial use; Free pauses after a week idle)
- [ ] Resend order and shipping emails; £1 snack

## Phase 7 · Your pet, your story (open platform)

- [ ] Licence chosen (MIT for reach, or AGPL-3.0 so hosted forks share their
      code); Kitty's photos, clips and words stay © Felix
- [ ] Onboarding: sign up → name your pet → "[name] Stories" at `/p/<slug>`
- [ ] Automated clip generation through a provider with an API (candidates:
      Kling's own API, fal.ai) behind the same `VideoProvider` interface; credits
      or a paywall, because generation costs real money
- [ ] Storage quotas, moderation, reporting, privacy (unlisted/private pets)
- [ ] Self-hosting guide: Supabase project + migrations + Vercel in ten minutes

## Phase 8 · Stores for everyone (£19/month)

- [ ] Stripe Billing subscription; store switched on while it is paid
- [ ] Payouts to owners through Stripe Connect (Express); platform fee
- [ ] Per-store products (Printful mockups), per-pet chat persona and tunables

## Phase 9 · WhatsApp delivery

- [ ] Subscription tier; new chapter → WhatsApp template message (reuse the
      Birthday Lobby WhatsApp integration)

## Phase 10 · Where is Kitty

BLE beacon on the collar, three ESPresense ESP32 nodes and a resolver on the Pi
write Kitty's zone to Supabase; the 3D Kitty moves to the same spot in the
house. Details in [TRACKING-KITTY.md](TRACKING-KITTY.md).

## Phase 11 · Hardware

£1 snack dispenser on the Raspberry Pi (servo or auger, hourly and daily caps,
physical off switch) triggered by a paid Stripe order; Canon 750D live view for
30 seconds after each snack.

---

## Decisions locked

| Area | Decision | Rejected and why |
|---|---|---|
| Platform shape | Multi-tenant from day one (`pets` own volumes and chapters); Kitty is the first pet | Single-cat schema (expensive to retrofit) |
| AI clips | Kling 3.0 on artta.ai, image + prompt, 9:16, 5 s | Text-only prompts (a different cat every time) |
| Clip automation | **artta.ai has no public API** (site says "no API keys required"; no docs; verified 22 Sep 2026). Builder hands off prompts + start frames and takes the clip back; an API provider comes in Phase 7 | Scraping artta (breaks, and breaks their terms) |
| Scroll story | Frame sequences on canvas, scrubbed by the scroll | `<video>` scrubbing (iOS) |
| Chapter reader | Native scroll with neighbours loaded above and below | Snap paging (fights the scroll-driven scenes) |
| Auth | Supabase email + password with confirm email (Birthday Lobby pattern); browser session, bearer token to API routes | Magic links only |
| Admin | `admins` table + `is_admin()` that also requires a confirmed email; RLS is the boundary, the UI only reflects it | Email check in React |
| Database region | Supabase eu-central-1 (Frankfurt); Vercel functions `fra1` beside it | `lhr1` (one hop further from the database) |
| Store look | Stylised, animated 3D house built in Blender | Photogrammetry (heavy, uncanny on phones) |
| Print on demand | Printful UK primary; Inkthreadable fallback; Printify third | Gelato/Prodigi/Teemill (no UK caps or embroidery) |
| Payments | Stripe hosted Checkout + verified webhook + `after()` | Payment Links (no address/fulfilment) |
| Chat | Claude Opus 5, streaming, cached system prompt, low effort | — |
| AR | MediaPipe Tasks Vision; Snap Camera Kit Web as the upgrade | WebXR on iOS (absent), 8th Wall (closed) |
| Cat model | Quaternius CC0 cat, retextured | Meshy/Tripo/Hunyuan3D (licence, one clip, look) |
| Tracking | Static BLE beacon + ESPresense + Pi | AirTag (no API) |

## Running costs once live

| Item | Monthly |
|---|---|
| Vercel Pro (needed before selling anything) | $20 |
| Supabase Pro (needed before selling anything) | $25 |
| artta.ai while making clips | $19.90–39.90 |
| Claude (chat + chapter drafts) | pennies per conversation / draft |
| Resend, Stripe, Printful | per message / transaction / order |

## Accounts and where they live

| Service | Identifier | Notes |
|---|---|---|
| GitHub | `felixmca/Kittyfive` (public) | never commit `.env*` or `assets-raw/` media |
| Vercel | project `kittyfive` (`prj_EKYH3UUhVMOwZtaFzYUkNcTcGVUj`), team scope `musical-chairs` | production `https://kittyfive.vercel.app`; deploys on push to `main` |
| Supabase | project `Kittyfive`, ref `xloturzrohswrmbqwylt`, eu-central-1 | confirm-email is on; automatic RLS on new tables |
| Anthropic | key shared with Birthday Lobby | server-only env var |

## Starting a session

1. Read this file and the memory index.
2. Find the first unchecked box in the lowest unfinished phase.
3. `npm run dev -- -p 3200` (demo mode needs no env vars; add `?demo=1` to force it).
4. Build, then `npm run build && npx next start -p 3201` and `npm run verify`.
5. Push to `main`; check the Vercel deployment; tick the boxes; update memory.
