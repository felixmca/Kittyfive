# Handover 03: the day session (23 Sep 2026)

Felix was out for the day and asked for: the landing story fixed on iPhone
(test it upright), a clear Kitty home button on every page with "Kitty" at the
top of the menu, better navigation between pages, then the rest of the
roadmap with progress tracked. This file is the running log; the newest entry
is at the bottom of "Progress".

## For Felix, when you are back

**Everything below is live at https://kittyfive.vercel.app.** Screenshots are
in [`docs/screenshots/day-23/`](screenshots/day-23/).

**Please try these on your iPhone (five minutes):**
1. **The landing.** The story should now start under the camera within a
   couple of seconds and play all the way through. It was failing on iPhone
   because it kept about 340 MB of video frames in memory, more than Safari
   allows a page; it now keeps about 80 MB and decodes in the background.
   Swipe through all four chapters, and hold and drag once.
2. **The Kitty button**, top-left on every page (her face): it takes you
   home. The menu (top-right) now starts with Kitty and has "Try it on".
3. **The store** (`/store`): the room follows the time at your flat (evening
   from 7pm), and the sun/moon button under the menu flips it. There is a
   garden through a glass door, and if you leave Kitty alone she wanders to
   the window or the garden door and back.
4. **The 3D cap:** open `https://kittyfive.vercel.app/try-on?cap3d=1`, allow
   the camera and wear the cap. Tell the next session where it sits wrong
   (too high, too big, visor too long). Until then the normal try-on is
   unchanged.

If the landing still misbehaves, you don't need to describe it: each visit
sends a small anonymous report (browser, screen, how far the story got, any
error), and the next session can read yours (§2 below).

**What you need to do (unchanged from before, plus the photos):**
- Supabase → Authentication → URL Configuration, then sign up with your admin
  address (Roadmap 2A). After that, **/admin → Kitty Tunables** sets how Kitty
  talks in the store's chat (warmth, dryness, snacks, merch, story, length,
  opening line, notes), and the menu shows "Admin".
- Chapters 3 and 4 clips and the MISSING flyer ([Handover 01](HANDOVER-01-STORY-ASSETS.md)).
- **New:** photos for the store's 3D house, Kitty's markings for the 3D cat,
  and a turntable video: the shot list is [Handover 04](HANDOVER-04-STORE-PHOTOS.md).

**Choices I made (say if you want them different):**
- The floating camera button is gone from the landing, the store, checkout
  and the try-on itself (it covered buttons there); the end of the landing and
  the store's product panel have "Try it on" instead.
- "Skip story" moved next to the Kitty button; the kitten clock moved down.
- The chat stays on Claude Opus 5 at low effort, now with Anthropic's
  server-side fallback on, so a declined turn is retried on a fallback model
  instead of leaving Kitty silent.
- Link previews (WhatsApp, iMessage) show her close-up from the end of
  chapter 1 with her name; chapters show their own picture.

**Not done, and why:** the Blender house and the real 3D Kitty need your
photos (and the cat model needs downloading, which I did not do without
asking); realistic hoodie/long-sleeve try-on needs a person on camera to
calibrate against; Phases 5–6 need a domain, Stripe and Printful accounts.

## Plan for the day

1. iPhone: find why the story does not render, fix it, and test portrait
   phones in WebKit (the engine inside every iPhone browser) as well as Chrome.
2. Navigation: Kitty's face as a home button on every page; the menu starts
   with Kitty; links between pages where they were missing.
3. Roadmap, in order: Phase 2E (Playwright journeys for the Stories pages,
   demo mode only), then Phase 3 (the store: chat with Kitty on the real key
   and Kitty Tunables in /admin, the tour, the room photo brief for Felix).

## Progress

### 1 · iPhone fix and the home button (deployed, commit `fa8442a`)

**What was wrong.** The story kept every frame of two chapters decoded at once,
about 340 MB of pictures. iOS Safari does not let a page hold that much: it
drops the canvas (a black stage) or reloads the page. A frame that failed to
decode also stalled playback for good, and the loading splash covered the Skip
button, so a stuck load trapped the page.

**What changed.**
- The story now keeps only the compressed frames (about 45 KB each) and decodes
  a small window around the playhead: about 30 frames on a phone (70 on a
  computer), plus the first frames of the next chapter. Peak decoded memory on
  a phone went from ~340 MB to ~85 MB.
- It can no longer sit forever on a blank or loading screen: it starts with
  whatever has arrived after 7 s, a broken frame is skipped over, Skip is always
  on top, and a swipe while loading brings the stage up.
- iOS specifics: a swipe that starts on the hero can no longer scroll the page
  past the story; frames are released while the tab is in the background and
  the picture is redrawn when you come back (also from the Back button).
- Kitty's face (a tuxedo cat) is a 44 px button, top-left on every page. It
  takes you home, or back to the top on the landing. The menu starts with
  Kitty and gains "Try it on". The same face is the site icon (browser tab,
  and the icon if you add the site to your iPhone home screen).
- Skip story sits beside the home button; the kitten clock and "Paused" badge
  moved below the button row.
- The floating camera button no longer covers other buttons. It is gone from
  the landing, the store and checkout; the end of the landing and the store's
  product panel have "Try it on" links instead.
- The end of the landing fits on a small phone (iPhone SE): the turntable is
  smaller there, so both big buttons show.
- The store heading is readable over the bright room, and it links to Kitty
  Stories.

**How it was tested.** `npm run verify` now also runs the landing and every
page in WebKit as an iPhone 17 Pro (portrait) and in Chrome at 375×667. Phone
swipes are real touch events that start on the hero, and the check asserts no
more than 40 frames are ever decoded on a phone. 288/288 passed on the
production build. A headless browser is not an iPhone (no iOS memory limits),
so **please try it on your phone**.

### 2 · Story reports (deployed, commit `e4faa48`)

The landing now sends home one small, anonymous summary per visit: which
browser and screen, whether the story started and how fast, how far it got,
how many frames were decoded at most, and the first few errors. There is also
a note for when the previous visit in that tab ended in a crash (iOS reloads a
page it kills for memory). No IP address, cookies or identifiers are kept. It
goes into a Supabase table capped at 2000 rows a day and 30 days, and only
admins can read it. So when you open the site on your iPhone, the next session
can see exactly what happened:

```bash
node scripts/db.mjs -e "select created_at, kind, report->>'screen' as screen, report->>'started' as started, report->>'furthest' as furthest, report->>'peakDecoded' as peak, report->'errors' as errors, left(report->>'ua', 60) as ua from story_reports order by created_at desc limit 20"
```

It is off on localhost and in the test harness, and `NEXT_PUBLIC_STORY_REPORTS=off`
turns it off entirely.

### 3 · Phase 2E: the Stories pages are tested end to end

`npm run verify` now also runs these journeys in demo mode, where every edit
stays in the test browser:
- a reader scrolls from the end of volume 1 into volume 2, and the address
  bar and the "Vol 2 · The cupboard" chip follow;
- an owner builds a chapter from two photos and a few sentences, publishes it,
  drags it in front of "A cold night", renames its tile, and reloads to prove
  all of it stuck.

This caught one gap: the demo draft made a single scene however many photos
you added. It now makes one per photo, as the real one does. The full run was
318/318.

### 4 · Kitty Tunables and chat on the real key (Phase 3)

`/admin` now has **Kitty Tunables**: five sliders (warmth, dryness, snack
obsession, merch pushiness, story references), reply length, effort, her
opening line and free notes. Under each slider is the exact sentence it puts
into her instructions, and "Show her full instructions" shows the whole prompt
she is given. Saving stores them in Supabase (`pet_personas`: editors write,
anyone can read, so no private details in the notes). The chat picks a change
up within a minute, and the store opens with her tuned opening line.

The chat itself still runs on Claude Opus 5 and now has Anthropic's
server-side **refusal fallback** switched on. If Opus declines a turn, the API
reruns it on a fallback model in the same call, and a turn that still ends
with nothing to say gets an in-character line instead of a blank bubble.
Tested with real calls.

### 5 · Photos for the store

The house is modelled from your own rooms, so Phase 3's next steps need
pictures. [Handover 04](HANDOVER-04-STORE-PHOTOS.md) is the shot list: the
living room, the garden, rough measurements, Kitty's markings (so the 3D cat
is really her) and a turntable video (the "spin Kitty" circle at the end of
the landing is still a drawing). The folders have READMEs.

### 6 · The store comes alive (on the drawn room, until the Blender house)

- **Day and evening.** The store opens as it is at Kitty's in London (evening
  from 7pm), and a sun/moon button under the menu flips it. Lights, lamps and
  colours fade between the two over about a second.
- **The river in the window** is now a small shader: the far bank as a row of
  buildings, and water with light moving on it. At dusk the sky turns amber
  and indigo, windows light up across the river, and their reflections
  shimmer on the water.
- **A garden door** in the back wall (glass, with Kitty's cat flap) looks onto
  a lawn with beds of plants swaying in the breeze, a blossom tree, pots, a
  low wall, and the Thames beyond it.
- **Kitty wanders.** Left alone for a while, she walks to the window ("The
  river. I keep an eye on it."), later the garden door, then her bit of rug,
  sits there for a moment, and comes back to the product she was showing. A
  tap on the arrows brings her straight back. (Not under reduced motion.)
- Her speech bubble no longer runs off the edge of a phone screen.
- `npm run verify` checks the toggle really changes the light and the bubble
  stays on screen.

### 7 · Smoother story on iPhone: frames decode in the background

Measured in WebKit (Safari's engine), turning a story frame into a picture
held the main thread for ~30–45 ms each time, so with the new small window of
frames the story could stutter or slow while it decoded ahead. Chrome does
this in the background; Safari does not. Frames are now decoded in two small
background workers (tested: WebKit supports it; the main thread's longest
pause dropped from 46 ms to 17 ms). If a browser cannot, it quietly uses the
old way.

### 8 · The same iPhone fix for the chapter pages, and a faster start

- **Chapter pages** (`/stories/<chapter>`) had the landing's old problem:
  every clip scene decoded its whole clip (≈170 MB) when it came near the
  screen, and at a chapter boundary two could be near at once, more than an
  iPhone allows. They now keep only the frames around the scroll position
  (plus a keyframe every 12 frames for fast flicks): at most 34 frames
  decoded while scrolling from volume 1 into volume 2, checked by
  `npm run verify` in WebKit as an iPhone and in Chrome.
- **The landing starts sooner.** It used to wait until the whole of chapter
  1 could download before the part already there had played; it only needs
  each frame by the time the playhead reaches it. On a phone's 4G (throttled,
  with a 4× slower processor) the story now starts at about 2.8 s instead of
  4.7 s, and the kitten photos wait until chapter 1 is in so they do not
  compete with it.
- Measured on the live site (fast 4G, 4× CPU): first paint 0.5 s; the store's
  3D room appears at about 5.9 s (slow 4G 8.6 s), still over the roadmap's 3 s
  target, which is mostly three.js arriving and starting; next step there.

### 9 · Phase 4 started: the cap in 3D (behind a switch)

Open **`/try-on?cap3d=1`** on your phone, allow the camera and pick the cap.
Instead of the flat picture, the cap is 3D: six panels, a button on top, a
curved visor, and Kitty's face embroidered on the front, in the colour you
pick. It sits on your forehead, is sized to your face, turns and tilts with
your head, and an invisible head hides the back of it. Its light follows the
room's (a dark room gives a darker cap). The photo button includes it.

It is behind the switch because nobody has worn it yet: it was built without
a camera, tested on posed heads (see the screenshots in the harness), so the
proportions are first estimates. Tell the next session where it sits wrong
(too high, too big, visor too long) and it becomes the default. Without the
switch the try-on is exactly as before, and if face tracking cannot start on
a device, it falls back to the flat cap by itself.

Also: link previews (WhatsApp, iMessage) now show Kitty's photo with her name,
and "Add to Home Screen" gives an app with her face as the icon.

### 10 · Small things for you on your phone

- **Typing on the iPhone no longer zooms the page.** Safari zooms into any
  text field smaller than 16 px; the editors (Kitty Tunables, the tile and
  volume editors, the chapter studio, Kling prompts) were 15 px and 13 px.
  They are 16 px on phones now.
- **/admin shows "The story on real phones"**: the last 25 story reports,
  one line each (device and browser, how fast it started, how many chapters
  were seen, frames held, the first error). Once you have signed in, the menu
  also has an **Admin** row.
- **Add to Home Screen** opens Kitty full screen with a dark status bar.
- The database's RLS smoke test (`node scripts/db.mjs supabase/tests/rls-smoke.sql`,
  rolls back) now also proves that strangers cannot set Kitty's Tunables or
  read the story reports, and that anonymous visitors can only add reports
  through the checked function.
- **In the try-on, Kitty comes and sits beside you** (on the side with more
  room, turned towards you) instead of pacing the bottom of the screen, and
  moves over when you do.
