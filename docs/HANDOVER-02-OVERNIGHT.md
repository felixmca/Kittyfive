# Handover 02: the overnight session (22 → 23 Sep 2026)

**For a fresh Claude session.** Felix is asleep for about 8 hours. Build the new
swipe-driven landing story from his first two clips, keep everything else
working, deploy, and leave him a short morning summary. Work autonomously; do
not wait for answers. Where this file leaves a choice open, make it, note it,
and move on.

Read first, in this order: the memory index (`MEMORY.md` in the project memory
folder), `docs/ROADMAP.md`, `docs/HANDOVER-01-STORY-ASSETS.md`, then this file.

---

## 1. What Felix asked for (his words, condensed)

1. **Four chapters on the landing**, not six: **1 A cold night**, **2 Five by
   dawn**, **3 Missing, Found**, **4 Riverside sofa**. Clips 1 and 2 are in;
   3 and 4 come tomorrow. Each chapter's first frame is the previous chapter's
   final frame "to seamlessly stitch the chapters together".
2. **Swipe, don't scrub.** "When the user scrolls, it should not be one fluid
   motion; rather, a swipe triggers a flow of animation from one chapter to the
   next. This lowers the amount of swiping and still illustrates the story."
3. **Tap and hold** anywhere on the story "to pause and pan around the
   animation flow between chapters" (hold = pause; drag while holding = scrub
   through time).
4. **Chapter 1 starts under the camera** at the top of the page as the landing
   loads (the spinning camera hero stays). While it loads, show a **"Kittyfive"
   heading and a loading bar** if it is going to take time.
5. **Captions assemble near the end of each chapter's animation**: a **title
   and a subtitle** that explain the scene, forming as the chapter finishes.
6. **Chapter 1 → 2, exactly:** "The screenshot should be featured very quickly
   and kind of airdrop in from behind the user's point of view. The image on
   the WhatsApp chat is the start frame of chapter 2 (and chapter 1's end
   frame). When chapter 1's animation flow has completed and the user swipes
   up, the screenshot flies through and frames the start frame of chapter 2,
   then zooms into it and begins playing five-by-dawn.mp4."
7. **Chapter 2 must use the kitten photos** (`Kittens1–5`) in its interactivity.
   "Really get creative with the extra images."
8. The Stories page shows the same four chapters (each in its volume).

Blurring the neighbours' details in the screenshot: **approved** (already done,
see §3).

## 2. Where things stand (all built and verified by the previous session)

Live: https://kittyfive.vercel.app (Vercel project `kittyfive`, team scope
`musical-chairs`, deploys on every push to `main` of the **public** repo
`github.com/felixmca/Kittyfive`). Supabase project `Kittyfive`, ref
`xloturzrohswrmbqwylt`, Frankfurt.

| Area | State |
|---|---|
| Database | Migrations in `supabase/migrations/` (mirrors of what is applied; file versions must equal `list_migrations`). Multi-pet: pets → volumes → chapters → chapter_scenes, chapter_builds, admins + `is_admin()`, `can_edit_pet()`, reorder RPCs, public `story-media` bucket (editors write `pets/<id>/…`). RLS smoke test: `node scripts/db.mjs supabase/tests/rls-smoke.sql` (rolls back). Kitty seeded from `supabase/seed/kitty.sql`: 7 volumes, **6 chapters (to be cut to 4, task B)**. Felix's admin row exists. |
| Auth | `/account` (Birthday Lobby pattern), `/admin` (admin-only shell). Felix has **not signed up yet**; Supabase Auth URL settings not yet set by him. |
| Stories | `/stories`: volumes, tile faces (two photos blended), editor, RippleGrid drag physics (verified headless). `/stories/<chapter>`: continuous reader (verified: prepend without jump, URL follows, frames scrub). `/stories/new` + `/stories/<chapter>/edit`: chapter studio (photos → `/api/chapters/draft` (Claude Opus 5, structured output, fallbacks) → scenes with Kling prompts, 9:16 start-frame download, clips cut into frames in the browser). **The studio and the draft route have not been exercised end to end** (needs Felix signed in; demo mode returns a canned draft). |
| Landing | Still the old scroll-scrubbed engine (`src/components/story/*`, config `src/config/story.ts`, currently 6 scenes with the old ids 03–06 that no longer have folders). **This is what you replace.** |
| Pipeline | `npm run story` (`scripts/build-story.mjs`): per chapter `clip/` → 72 WebP frames (never upscaled), `start-frame/` → `still.webp`, `extras/` → `extras/<name>.webp` + `media.json` (names kept: `end-frame`, `kittens1`…). `ui/whatsapp` → `public/story/whatsapp-chat.webp` + `.json`. Already run for chapters 1 and 2 (outputs committed in `public/story/`). |
| Keys | Vercel env: Supabase URL + publishable key (all envs), `NEXT_PUBLIC_SITE_URL` (prod), `ANTHROPIC_API_KEY` (all envs, sensitive). Local: `.env.local` (git-ignored) also has `SUPABASE_DB_URL` (session pooler). |

## 3. The media you have

All raw files are git-ignored (`assets-raw/**` except READMEs). Processed web
versions are in `public/story/` (run `npm run story` again after any change).

| File (assets-raw/…) | What it is |
|---|---|
| `story/01-a-cold-night/clip/a-cold-night-come-inside.mp4` | 576×1024, 24 fps, 5.04 s. Kitty outside the open back door on the deck → turns, walks in → ends on the WhatsApp photo pose (a hand on her head, her lying on a dark surface, white wall). |
| `story/01-a-cold-night/start-frame/start-frame.jpeg` | 1152×2048, the clip's first frame. |
| `story/01-a-cold-night/extras/end-frame.jpeg` | 1536×2048, the clip's final frame = the WhatsApp photo = chapter 2's first frame. |
| `story/02-five-by-dawn/clip/five-by-dawn.mp4` | 576×1024, 24 fps, 5.05 s (Seedance 2.5). Starts on the WhatsApp pose → into a cardboard box with a newborn → ends on a top-down close-up of Kitty with a calico newborn on a white towel. |
| `story/02-five-by-dawn/start-frame/start-frame.jpeg` | 1536×2048, same image as chapter 1's final frame. |
| `story/02-five-by-dawn/extras/end-frame.jpeg` | 1630×2048, chapter 2's final frame (Kitty + calico newborn) = chapter 3's first frame. |
| `story/02-five-by-dawn/extras/Kittens1.jpeg` … `Kittens5.jpeg` | Real photos: 1–3 newborn piles asleep (calico, tabby, black-and-white), 4 a calico kitten of a few weeks sitting up looking at the camera, 5 three kittens on a red blanket in sunlight. No people. |
| `ui/whatsapp/whatsapp-chat.jpeg` | 946×2048, **blurred** screenshot of the "Neighbourly Neighbours" group: welcome message, a neighbour's photo of Kitty ("Anyone missing this cutie?"), Felix's reply ("…She arrived last night and doesn't want to leave…"). Names, numbers, profile photos, group avatar and house number are blurred. |
| `ui/whatsapp/whatsapp-chat.json` | `photo: {x:106, y:715, w:608, h:811}`: where the photo sits inside the screenshot (measured by eye; check it and refine). |
| `ui/whatsapp/original/…` | **The unblurred original. Never read it into anything public.** |

Chapters 3 and 4 are empty folders with READMEs; the landing must look complete
without them (placeholder chapters or end after chapter 2 with a "more
tomorrow" state; your call, but no broken frames).

## 4. The experience to build

Mobile first (390×844), then desktop (1280×800; the stage becomes a centred
9:16 column over a blurred copy of the frame, as the old engine did).

### Page structure
1. **Hero** (existing `src/components/hero`, top ~34dvh): the spinning camera,
   title, tap → `/try-on`. Keep it.
2. **The story stage**, directly under the hero on load and full-screen once
   the story starts: one canvas for clip frames plus DOM layers for the
   choreography and captions.
3. After the last chapter: the existing `StoryEnd` (turntable + the two big
   buttons to Kitty Stories / Kitty Store), then normal page scrolling.

### Loading
Preload chapter 1's frames (and the WhatsApp image) before starting. If that is
not done within ~400 ms, show a splash over the stage: **"Kittyfive"** in the
display font and a thin progress bar (frames decoded / frames needed). Fade it
out and start chapter 1 as soon as enough frames are ready to play smoothly.
Keep loading the rest (chapter 2 and its extras) in the background.

### The player
Model the story as **one timeline** made of segments, with **stops** where it
rests:

```
[ch1 clip 5.04s][caption 1 assembles][STOP 1]
  swipe → [whatsapp flight ~1.8s][ch2 clip 5.05s + kittens][caption 2][STOP 2]
  swipe → [flyer drop?][ch3 …][caption 3][STOP 3]
  swipe → [ch4 …][caption 4][STOP 4]
  swipe → release the page to StoryEnd
```

- On load (after preload) play from 0 to STOP 1 automatically.
- **Swipe up / wheel down / ↓ / Space / PageDown**: play from the current stop
  to the next one at normal speed. One gesture = one move; ignore further
  swipes until it arrives (or let a second swipe skip ahead: your call, keep it
  simple).
- **Swipe down / ↑**: go back to the previous stop (play in reverse at about 2×,
  or crossfade quickly; your call).
- **Tap and hold** (pointer down ~250 ms without moving): **pause**. While
  still holding, **drag** scrubs the playhead: map horizontal and vertical drag
  to time (e.g. 1 screen height ≈ one segment). Release: resume playing
  towards the stop you were heading for (or stay paused if you scrubbed onto a
  stop). Show a small "paused" hint and a scrub position indicator.
- Captions and overlays must be **pure functions of the playhead time**, so
  scrubbing backwards and forwards is deterministic.
- While the stage is active the page must not scroll: `touch-action: none` on
  the stage, `overscroll-behavior: none`, block wheel/touchmove with passive:
  false listeners on the stage only. After STOP 4 (or a "Skip story" button),
  release scrolling so the rest of the page works.
- Accessibility: a visible "Swipe up" hint and a Skip button; keyboard works;
  `prefers-reduced-motion` → no flights, just crossfades between chapter stills
  and static captions; `aria-live` announces each chapter's title and
  subtitle.

### Chapter 1 → 2: the WhatsApp flight (Felix's spec, choreograph exactly)
At STOP 1 the stage shows chapter 1's final frame F (Kitty with a hand on her
head) full-screen. On the next swipe:

1. **Airdrop from behind the viewer (~0.5 s):** the blurred screenshot enters as
   if it passed the viewer's head: starts huge (scale ≈ 4), slightly rotated,
   blurred and transparent, "behind" the camera (use a CSS 3D perspective:
   `translateZ` towards the viewer, then away), and flies into the scene.
2. **It lands framing F (~0.4 s):** it settles so that the photo inside the
   chat lands exactly on the full-screen F. Achieve this by computing the
   transform that maps the screenshot's `photo` rectangle
   (`whatsapp-chat.json`) onto the stage, then animating from the "whole chat
   visible, phone-sized, centred" pose to that. Simplest reading of "frames the
   start frame": F shrinks into the chat bubble as the chat arrives, so for a
   beat the whole chat is visible with F inside it.
3. **"Featured very quickly" (~0.6 s hold):** the chat is readable for a moment
   ("Anyone missing this cutie?" / "She arrived last night and doesn't want to
   leave").
4. **Zoom into the photo (~0.5 s):** scale the chat up until its photo fills the
   stage again (the inverse of step 2). At the end the photo is exactly frame
   0 of chapter 2 → cross over to the chapter 2 canvas without a visible jump
   and play five-by-dawn.

All four sub-steps are functions of the playhead, so hold-and-drag can scrub
through the flight.

### Chapter 2: the kittens (be creative; one strong idea, executed well)
Story beats: "At half past midnight, in a cardboard box in the bedroom
cupboard, the first kitten arrived. Then another, every thirty minutes. By dawn
there were five. She raised them in that cupboard, until every one was adopted
and the box was empty again."

A suggested direction (improve on it if you have better): as the clip plays,
a small clock ticks **12:30, 1:00, 1:30, 2:00, 2:30**, and at each tick one real
kitten photo (Kittens1–5) drops in as a polaroid that lands in a loose fanned
stack beside Kitty (gentle rotation, a soft shadow, a physical settle like the
RippleGrid springs). "By dawn there were five": five polaroids. Then, as the
clip reaches its final frame (Kitty and the calico newborn), the polaroids lift
away one by one to the edges ("adopted"), leaving her alone, and caption 2
assembles. Hold-and-drag should let you scrub the kittens in and out. Kittens4
(the calico sitting up, looking at the camera) could be the last one to leave.

### Captions (every chapter)
Towards the end of each chapter (last ~1.2 s before its stop) the **title**
assembles (letters or words fly in from scattered positions and lock into
place, like type being set), then the **subtitle** fades up under it. Low on
the screen over a dark gradient; readable at 390 px. When playback moves on,
they disassemble or fade before the next chapter's visuals take over.

| # | Title | Subtitle |
|---|---|---|
| 1 | A cold night | She did not ask. She just came in. She stayed. |
| 2 | Five by dawn | Half past midnight, a cardboard box, one kitten every thirty minutes. |
| 3 | Missing, Found | Four months of flyers. Then a neighbour, some snacks, and a phone call. |
| 4 | Riverside sofa | She's been next to me the entire time I've been building this. |

(Tune the wording to fit; keep Felix's facts.)

## 5. Tasks, in order

**A. ✅ Done by the previous session:** chapters 1–2 frames, stills, extras
and the blurred `whatsapp-chat.webp` are committed. If any raw file changes,
`npm run story` and commit `public/story` again. Never add anything from
`assets-raw/` except READMEs.

**B. Four chapters everywhere.**
- `src/config/story.ts`: four chapters with ids `01-a-cold-night`,
  `02-five-by-dawn`, `03-missing-found`, `04-riverside-sofa`, titles,
  subtitles (table above), beats if you still use them.
- Database (Kitty's rows): keep `a-cold-night` (The back door) and
  `five-by-dawn` (The cupboard); turn `thousands-of-flyers` into
  `missing-found` ("Missing, Found", volume **the-neighbour**, landing_order 3);
  turn `a-flat-on-the-thames` into `riverside-sofa` ("Riverside sofa", volume
  **the-sofa-on-the-river**, landing_order 4); delete `and-there-she-was` and
  `next-to-me`; point each scene's `image`/`frames.dir` at
  `/story/<new folder>/`. Write it as SQL, run with `node scripts/db.mjs -e`
  (the MCP's `execute_sql` is read-only), and update `supabase/seed/kitty.sql`
  and the demo copy in `src/config/stories.ts` to match.
*Done when* `/stories` shows the four chapters in their volumes, live and in
`?demo=1`.

**C. The swipe story engine** (§4): a new component (e.g.
`src/components/landing/SwipeStory/`) used by `src/components/landing/Landing.tsx`
in place of `Story`. Reuse `src/components/story/frameLoader.ts` /
`useFrameSequence.ts` for loading and decoding frames. Keep the old scroll
engine files until the new one is verified; delete them after if nothing uses
them (the chapter reader uses its own `ReaderScene`).

**D. The WhatsApp flight** (§4), **E. the kittens** (§4), **F. captions**
(§4), **G. the loading splash** (§4).

**H. Verify.** Headless Playwright (see §6 on why not the browser pane):
- load at 390×844 and 1280×800; splash appears only when slow; chapter 1 plays
  under the hero and stops on its final frame (canvas pixel readback changes
  over time, then stops changing);
- one wheel/swipe → the flight runs → chapter 2 plays → stops; kittens appear
  and leave; caption text present at the stop;
- hold 400 ms → frames stop changing; drag → frames change with the drag;
  release → playback resumes;
- ↑ goes back a chapter; Skip releases the page; `StoryEnd` buttons reachable;
- reduced motion path; no console errors; no requests 404 except the known
  missing chapter 3/4 media;
- update `scripts/verify.mjs` (its landing journey assumed the old scroll
  story; make it pass with the new one), then `npm run build`,
  `npx next start -p 3201`, `npm run verify`.
Save screenshots of each stop and mid-flight for Felix.

**I. Ship.** Commit (message ends with the Co-Authored-By line from the
system reminder), push to `main`, confirm the Vercel deployment is Ready
(`npx vercel@latest ls kittyfive --scope musical-chairs`), smoke-test
production (landing, `/stories`, a chapter, `/account`). Tick the boxes in
`docs/ROADMAP.md`, update the memory files, and write a short morning note at
the top of this file (what works, what to look at, what he needs to do).

## 6. Things the last session learned the hard way

- **Disk:** C: was full (0 bytes) and crashed the dev server (ENOSPC). It has
  about 3 GB now. `npm cache clean --force` frees ~1–2 GB; delete `.next/` if a
  build dies mid-write. D: has 149 GB free. Check `(Get-PSDrive C).Free` before
  long builds.
- **The browser pane is usually hidden**, and hidden tabs do not run
  `requestAnimationFrame`, so animations freeze there. Test motion with
  headless Playwright scripts (the project has Playwright; examples of probes:
  drag physics with sampled transforms, the reader's scroll prepend, canvas
  pixel signatures to prove frames change).
- **ffmpeg:** use the full build on PATH (winget Gyan.FFmpeg 9.0). Playwright's
  bundled ffmpeg cannot decode H.264 or write WebP.
- **Supabase:** MCP `execute_sql` runs read-only; `apply_migration` for DDL,
  then save the file as `supabase/migrations/<version from list_migrations>_<name>.sql`
  (the GitHub integration must see identical versions). Data writes:
  `node scripts/db.mjs` (uses the session pooler; the direct host is IPv6-only).
  Never put Felix's email in the repo (admins are seeded by SQL).
- **Demo mode** (`?demo=1` or no env): pretend account in localStorage
  (`kittyfive-demo-auth`), demo book in `kittyfive-demo-stories-v1`. Use it for
  every test that edits; never write test data to production.
- **React lint (react-hooks v7 compiler rules)** fails the build on: reading or
  writing `ref.current` during render, calling a ref-reading function passed
  into another function during render (wrap per-item output in a child
  component), `setState` directly in an effect for derived state (use the
  "adjust state when a prop changes" pattern), and `Date.now()`/`Math.random()`
  anywhere the compiler thinks runs during render. `npx eslint src` must be
  clean except the existing font warning.
- **Git Bash quoting:** regexes with `\/` inside `node -e` or heredoc-generated
  JS get mangled (twice this session); prefer the Edit tool for code with
  backslashes.
- **Vercel:** dashboard framework preset is "Other"; `vercel.json` must keep
  `"framework": "nextjs"`. Region `fra1`. `npx vercel@latest` is logged in.
- **Public repo:** scan staged diffs for `sk-ant`, `sb_secret`, the DB
  password, and Felix's email before every push.

## 7. Don't

- Don't read or publish `assets-raw/ui/whatsapp/original/`.
- Don't create accounts or type passwords into forms (including this site's).
- Don't spend Felix's artta credits or call paid APIs in loops. A single test
  call to Claude through `/api/chapters/draft` is fine only if you can do it
  without an account (it needs one; skip it and note it).
- Don't restructure the Stories page, reader or studio beyond task B; they
  work.

## 8. Morning note for Felix (fill in at the end)

*(write here: what is live, links to screenshots, anything that needs him.)*
