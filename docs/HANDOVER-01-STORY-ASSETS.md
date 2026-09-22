# Handover 01: six chapters for the landing story

*Rewritten 22 Sep 2026. This replaces the earlier eleven-scene plan.*

You make six clips on artta.ai (Kling 3.0, image + prompt → video, 9:16, 5 s,
1080p). The landing page plays them in order as one scroll story. Each one is
also a chapter in the Stories page, inside the volume that fits it.

| # | Chapter | When | Also lives in volume |
|---|---|---|---|
| 1 | **A cold night** | January 2025 · Smith Close | *The back door* (new volume) |
| 2 | **Five by dawn** | 14 April 2025 · 12:30am | *The cupboard* |
| 3 | **A flat on the Thames** | November 2025 · Pacific Wharf | *The sofa on the river* |
| 4 | **Thousands of flyers** | 23 Dec 2025 – April 2026 | *What the flyer said* |
| 5 | **And there she was** | April 2026 | *The neighbour* |
| 6 | **Next to me** | Now | *The neighbour* |

---

## How the clips are used (it changes what a good clip looks like)

On the landing page, **the scroll plays the clip**: scroll down and it moves
forward, scroll up and it plays backwards. So:

- **Smooth, continuous motion wins.** Sudden jumps, cuts and camera shake look
  broken when scrubbed. Every prompt below asks for one slow camera move and one
  small action.
- **The words sit on the bottom third** under a dark gradient. Keep Kitty's face
  and the action in the **top two-thirds** of the frame when you crop.
- **A failed clip never breaks the page.** Any chapter without a clip shows its
  start-frame photo with a slow push-in instead. You can regenerate later.

## Credits

302 credits ÷ 49 per 1080p clip = six clips with 8 credits left, so **no
retries**. The prompts are built for a first-time hit. One option if you want a
safety net: Kling 3.0 at **720p is 39 credits** (sound off), and the site
already serves 720-pixel-wide frames on phones. Six at 720p = 234 leaves 68, so
one retry. 1080p only shows on large desktop screens. Your call.

**Suggested order, easiest first,** so you learn how artta treats your photos
before the harder ones: **5 → 6 → 3 → 1 → 2 → 4.**

## The same settings for every clip

- Model **Kling 3.0** · mode **image + prompt → video** · **9:16** · **5 s** ·
  **1080p** · sound **off**.
- **"Enhance / optimise prompt": off** if artta offers it. It rewrites your
  prompt and adds things you did not ask for.
- A "creativity ↔ relevance / prompt adherence" slider, if shown: nudge it
  towards **relevance**.
- Paste the **negative prompt** below into the negative field every time.
- Optional: if artta lets you register a **"Kitty" Element** (reference photos
  of one subject) without extra cost, add 3–4 photos from
  `assets-raw/kitty-identity/` and bind it. Not needed: the start frame already
  carries her look.

**Negative prompt (all six):**

```
morphing, warping, melting, extra legs, extra paws, extra tail, second cat, extra kittens, merging bodies, changing fur pattern, colour shift, distorted face, deformed eyes, garbled text, new text, subtitles, watermark, logo, scene cut, camera shake, flicker, cartoon, CGI, 3D render, oversaturated
```

## Before you upload each photo

1. **Crop to 9:16** in Photos (Edit → Crop → 9:16). Kitty in the top
   two-thirds, whole body in frame unless the brief says close-up.
2. **Sharp beats pretty.** Her eyes and markings must be in focus; Kling copies
   blur and makes it worse.
3. **No other people's faces** (the neighbour, visitors). The site is public.
   Your own arm or legs are fine.
4. Save the cropped photo into the chapter's `start-frame/` folder, then upload
   that same file to artta.

**Finding photos fast:** iPhone Photos search understands dates, places and
objects ("cat April 2025", "Rotherhithe", "box", "laptop", "window"), and it
reads text inside photos, so searching **MISSING** finds the flyer.

---

## 1 · A cold night

*January 2025 · Smith Close, SE16 · volume: The back door*

**On screen:** "One cold January night, a black-and-white cat walked in through
our back door." · "She did not ask. She just came in." · "We called her Kitty
because we weren't sure we'd keep her." · "She stayed."

**Find in your camera roll:** one of the very first photos you took of her,
January 2025, at Smith Close. Ideally she is **standing on the kitchen floor near
the back door**, facing you or three-quarter on, a little wary, evening or night
with the lights on. A door or a dark window behind her is a bonus. Her whole
body in frame, at least a quarter of the frame height. If the earliest photos
are rough, the best one from her first two weeks will do, as long as she is
standing, not lying down.

**Prompt:**

```
Low camera at floor level, very slow push-in. The black-and-white tuxedo cat in the image takes two slow, cautious steps towards the camera, pauses, lifts her head and looks straight into the lens with her tail raised, then stands still. The room stays exactly as in the photo; through any doorway or window it is a dark, cold January night, and warm indoor light falls on her fur. Keep her markings exactly: white chest and paws, black back and face mask. Photoreal, natural light, shallow depth of field, smooth steady camera, one continuous shot.
```

**Extras (2–4, optional):** her first days at Smith Close. First nap, first
time on the sofa, looking unsure.

**Drop into:** `assets-raw/story/01-a-cold-night/`

---

## 2 · Five by dawn

*14 April 2025, 12:30am · the bedroom cupboard · volume: The cupboard*

**On screen:** "At half past midnight, in a cardboard box in the bedroom
cupboard, the first kitten arrived." · "Then another, every thirty minutes." ·
"By dawn there were five." · "She raised them in that cupboard, until every one
was adopted and the box was empty again."

**Find in your camera roll:** **Kitty lying in the cardboard box in the bedroom
cupboard with her newborn kittens against her belly**, taken looking down into
the box, from the night of 14 April or the first week after, while the kittens
are still tiny. Best: her face visible and awake, all five kittens in view, lamp
or phone-torch light. If the night-of photos are dark or blurry, take the
sharpest one from days 1–7.

**Prompt:**

```
Very slow push-in with a slight tilt down into the cardboard box. The black-and-white mother cat in the image lies curled around her newborn kittens. The kittens stay tucked against her, breathing softly, and one wriggles a little closer. She slowly lowers her head, licks the nearest kitten once, then rests her head and looks calmly up towards the camera. The same kittens stay in view the whole time; no new animals appear. Warm, low lamp light from one side, deep shadows at the edges, half past midnight, quiet and intimate. Photoreal, shallow depth of field, smooth steady camera, one continuous shot.
```

This is the riskiest clip (several small animals). The prompt keeps the kittens
nearly still and gives the action to Kitty; that is deliberate.

**Extras (3–4):** the kittens at a few weeks old tumbling about; a kitten
asleep on Kitty; the empty box, if you ever photographed it.

**Drop into:** `assets-raw/story/02-five-by-dawn/`

---

## 3 · A flat on the Thames

*November 2025 · Pacific Wharf · volume: The sofa on the river*

**On screen:** "In November we moved to a ground-floor flat on the river." ·
"New windows. New smells. The same cat on the same sofa."

**Find in your camera roll:** **Kitty on the sofa (or the windowsill) at Pacific
Wharf with the window and the river visible**, daytime, from her first weeks in
the new flat (Nov–Dec 2025). Sitting upright or loafed, looking towards the
window or at you. Bright, soft daylight. The more of the window and water in
frame, the better.

**Prompt:**

```
Slow sideways camera drift from left to right with gentle parallax. The black-and-white cat on the sofa in the image turns her head to look out of the big window at the River Thames, ears swivelling, then settles and half-closes her eyes. Outside, the river water glitters and moves, and soft light reflected off the water ripples across the wall and over her fur. Pale November daylight, calm and quiet. Keep her markings and the room exactly as in the photo. Photoreal, shallow depth of field, smooth steady camera, one continuous shot.
```

**Extras (2–4):** moving day (boxes, the empty flat); the view of the river from
the window, no cat needed; her exploring the new rooms.

**Drop into:** `assets-raw/story/03-a-flat-on-the-thames/`

---

## 4 · Thousands of flyers

*23 December 2025 to April 2026 · volume: What the flyer said*

**On screen:** "Two days before Christmas we were away for three nights." · "The
building manager fed her every morning and every evening." · "She thought we had
left her. She went missing." · "Thousands of flyers. Every letterbox we could
reach. Rainy nights. Wet paper. Four months."

**Find in your camera roll:** **one of the real MISSING flyers out in the world**
(taped to a lamppost, tree, noticeboard or shop window), photographed
**straight-on, as large in the frame as possible**, with the word MISSING and her
photo readable. Night or rain is a bonus. Fallback: a single flyer held up
outdoors, or the stack of freshly printed flyers. (Search "MISSING".) Avoid
house numbers or anyone's front door number being readable.

**Prompt (night photo):**

```
Static camera with the slowest possible push-in towards the cat's photo on the flyer. Light rain falls in front of the lens; raindrops bead on the paper and a few run slowly down it. A gust of wind lifts the flyer's loose bottom corner, it flutters for a moment, then settles flat again. Streetlight glints on the wet surface. The printed words and the photo on the flyer stay perfectly sharp and unchanged. Cold, dark, wet winter night in London. Photoreal, smooth steady camera, one continuous shot.
```

If your photo is in **daylight**, swap the last two sentences' mood: replace
`Streetlight glints on the wet surface.` with `Grey winter light glints on the
wet surface.` and `Cold, dark, wet winter night in London.` with `Cold, grey,
wet winter afternoon in London.` Do not ask Kling to turn day into night.

Text is where AI video goes wrong, which is why the camera barely moves and only
one corner of the paper is allowed to flutter.

**Extras (2–4):** the pile of printed flyers; flyers up around SE16; a wet
street at night from the leafleting rounds. No cat needed.

**Drop into:** `assets-raw/story/04-thousands-of-flyers/`

---

## 5 · And there she was

*April 2026 · volume: The neighbour*

**On screen:** "Four months later, a neighbour saw a flyer, lured her inside with
some snacks, and called." · "I cycled over as fast as I could." · "And there she
was. Like she had nothing to say. Just a faint recognition." · "That's Kitty
sometimes. A subtle type of love."

**Find in your camera roll:** the **first close-up you took of her face when you
found her**, April 2026: head and shoulders, eyes open, looking at or just past
the camera, **sharp on the eyes**. If the reunion photos are blurry (they usually
are), use the sharpest face close-up from April–May 2026. Crop so her eyes sit
about a third of the way down the frame. This is the most important frame on the
site, so pick the best one you have.

**Prompt:**

```
The slowest possible push-in on her face. The black-and-white cat in the image holds her gaze on the camera, then slowly blinks once, a long soft cat blink, and keeps looking, calm and unimpressed. Her whiskers move very slightly as she breathes and her ears settle. Nothing else in the scene moves. Keep her face, markings and eye colour exactly as in the photo. Photoreal, quiet, soft natural light, shallow depth of field, smooth steady camera, one continuous shot.
```

**Extras (1–3):** her first evening back home; the bike, if you took one that
day. No photos of the neighbour.

**Drop into:** `assets-raw/story/05-and-there-she-was/`

---

## 6 · Next to me

*Now · volume: The neighbour*

**On screen:** "She's been next to me the entire time I've been building this."

**Find in your camera roll:** **Kitty curled up on the sofa right next to your
open laptop** (screen on), recent (summer to September 2026), evening lamp light
if possible. A bit of your arm or leg in frame is good; it says "next to me".
If you have none with the laptop, the best one of her asleep right beside you on
the sofa.

**Prompt:**

```
Locked-off camera, completely steady. The black-and-white cat curled up on the sofa next to the open laptop slowly closes her eyes and tucks her chin down, settling deeper into sleep. Her side rises and falls with slow breathing and the tip of her tail flicks once. The laptop screen's glow flickers softly across her fur. Evening, warm lamp light, the window dark behind. Keep her, the laptop and the room exactly as in the photo. Photoreal, warm, one continuous shot.
```

**Extras (2–3):** her next to the laptop on other days; asleep on the sofa this
summer.

**Drop into:** `assets-raw/story/06-next-to-me/`

---

## Where everything goes

```
assets-raw/
├─ story/
│  ├─ 01-a-cold-night/
│  │  ├─ start-frame/    the cropped 9:16 photo you uploaded to artta (one file)
│  │  ├─ clip/           the video artta gives you (any file name; newest wins)
│  │  └─ extras/         2–4 real photos from the same time (optional)
│  ├─ 02-five-by-dawn/          (same three folders)
│  ├─ 03-a-flat-on-the-thames/
│  ├─ 04-thousands-of-flyers/
│  ├─ 05-and-there-she-was/
│  └─ 06-next-to-me/
├─ ui/
│  ├─ flyer/      the MISSING flyer: the original print file (PDF/PNG) and/or a flat, straight-on photo
│  ├─ cutout/     Kitty side-on, standing or mid-step, background removed (see below)
│  └─ portrait/   your single favourite photo of Kitty
├─ kitty-identity/   optional: 4–8 clear photos of her markings (front, both sides, from above)
└─ turntable/        optional: a 10–20 s video circling her while she sits still
```

**File types:** JPEG or PNG for photos; whatever artta downloads (MP4) for
clips. iPhone HEIC files are fine too; the build converts them.

**What the extras and ui images are for:**

- **extras/**: the chapter's tile on the Stories page blends two of these into
  each other (you can change them later in the tile editor), and the end of each
  chapter shows a small strip of the real photos under the AI clip.
- **ui/flyer/**: the flyer that falls through the screen into chapter 4, the
  chapter 4 tile, and the long-sleeve print.
- **ui/cutout/**: the Kitty who walks out of chapter 2's frame and into chapter
  3's. Make it free on iPhone: open a side-on photo of her with all four legs
  visible, long-press on her until she lifts off the background, then **Share →
  Save Image**. That saves a transparent PNG.
- **ui/portrait/**: the preview image when someone shares the link, and the last
  frame of the story.
- **kitty-identity/**: the Kling Element if you use one, and the reference for
  retexturing the 3D Kitty in Phase 3.

Raw photos and clips stay on your machine. Only the processed web frames go into
the public repo.

## When you are done

Tell me which chapters have clips. I run `npm run story`, which turns each clip
into web frames, and then tune the scroll length and text timing of every
chapter to its actual motion. You do not have to wait for all six; drop them in
as they come.

## Checklist

- [ ] 1 · A cold night: start frame, clip, extras
- [ ] 2 · Five by dawn: start frame, clip, extras
- [ ] 3 · A flat on the Thames: start frame, clip, extras
- [ ] 4 · Thousands of flyers: start frame, clip, extras
- [ ] 5 · And there she was: start frame, clip, extras
- [ ] 6 · Next to me: start frame, clip, extras
- [ ] `ui/flyer/`: the flyer, flat and high-res
- [ ] `ui/cutout/`: transparent Kitty, side-on
- [ ] `ui/portrait/`: favourite photo
- [ ] Optional: `kitty-identity/`, `turntable/`
