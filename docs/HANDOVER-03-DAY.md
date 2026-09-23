# Handover 03: the day session (23 Sep 2026)

Felix was out for the day and asked for: the landing story fixed on iPhone
(test it upright), a clear Kitty home button on every page with "Kitty" at the
top of the menu, better navigation between pages, then the rest of the
roadmap with progress tracked. This file is the running log; the newest entry
is at the bottom of "Progress".

## For Felix, when you are back

*(Written last; see the bottom of this file.)*

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
