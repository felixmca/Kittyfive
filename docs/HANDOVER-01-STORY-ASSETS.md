# Handover 01: the landing story's four chapters

*Updated 22 Sep 2026, late. Four chapters, chained frame to frame.*

The landing story is now **four chapters**, and each clip **starts on the
previous clip's final frame**, so they join without a seam. A swipe plays the
flow from one chapter to the next (see [Handover 02](HANDOVER-02-OVERNIGHT.md)).

| # | Chapter | Status | First frame | Final frame | Also lives in volume |
|---|---|---|---|---|---|
| 1 | **A cold night** | ✅ clip in (Kling, first + final frame) | Kitty outside the open back door | the WhatsApp photo (hand on her head) | *The back door* |
| 2 | **Five by dawn** | ✅ clip in (Seedance 2.5, 115 credits) | chapter 1's final frame | Kitty with a calico newborn on the towel | *The cupboard* |
| 3 | **Missing, Found** | ⬜ tomorrow | chapter 2's final frame | the first sharp close-up after she was found | *The neighbour* |
| 4 | **Riverside sofa** | ⬜ tomorrow | chapter 3's final frame | Kitty on the sofa by the river, next to the laptop | *The sofa on the river* |

**Credits left:** about 138 of your 302 (Kling ≈ 49 for chapter 1, Seedance 115
for chapter 2). Two Kling 3.0 clips at 1080p are 98; at 720p, 78. Both fit.

---

## How the clips are used now

- **A swipe plays a whole chapter**, then the page holds on its final frame
  (which is the next chapter's first frame). Tap and hold pauses; drag while
  holding scrubs back and forth. So the motion can be a little bolder than a
  scroll-scrubbed clip, but it still has to read as **one continuous shot**:
  no cuts, no shake.
- **The title and subtitle assemble on screen near the end of each chapter.**
  Keep the last second of each clip calm so the words have room.
- **Keep Kitty in the top two-thirds** of the final frame; the words sit low.
- **Between chapters the site adds its own pictures**: the neighbours'
  WhatsApp chat flies in between 1 and 2, the kitten photos play inside 2, and
  the MISSING flyer can drop in between 2 and 3 (put it in `ui/flyer/`).

## Settings (both remaining clips)

- **Kling 3.0** · **first + final frame** (image to video) · **9:16** · **5 s** ·
  sound **off** · "enhance prompt" **off** · nudge any relevance slider towards
  relevance.
- **First frame:** the previous chapter's final frame (files below), exactly as
  it is, uncropped, so the join is perfect.
- **Final frame:** your photo, cropped to **9:16** (Photos → Edit → Crop → 9:16),
  Kitty in the top two-thirds, sharp on her eyes, no other people's faces.

**Negative prompt:**

```
morphing, warping, melting, extra legs, extra paws, extra tail, second cat, extra kittens, merging bodies, changing fur pattern, colour shift, distorted face, deformed eyes, garbled text, new text, subtitles, watermark, logo, scene cut, camera shake, flicker, cartoon, CGI, 3D render, oversaturated
```

---

## 3 · Missing, Found

*23 December 2025 to April 2026 · volume: The neighbour*

**On screen (assembles at the end):** **Missing, Found** · *Four months of flyers.
Then a neighbour, some snacks, and a phone call.*

**First frame:** `assets-raw/story/02-five-by-dawn/extras/end-frame.jpeg` (Kitty
and the calico newborn on the white towel). Use it as it is.

**Final frame, find in your camera roll:** the **first sharp close-up of her face
after she was found**, April 2026. Head and shoulders, eyes open, looking at or
just past the camera. If the reunion photos are blurry, the sharpest face
close-up from April–May 2026. Crop to 9:16 with her eyes about a third of the way
down. No photos of the neighbour.

**Prompt:**

```
One slow, continuous camera move from the first frame to the final frame, no cuts. The camera lifts gently away from the black-and-white mother cat and her newborn kitten; the kitten slips softly out of frame and the warm lamp light cools to the dim blue of a winter night, so for a moment she is alone in the dark. Then soft spring daylight returns and the camera settles close on her face, exactly as in the final frame, looking into the lens. Keep her markings and eye colour exactly as in both frames. Photoreal, smooth steady camera, one continuous shot.
```

This is a big change of scene for five seconds, which is why the prompt makes it
a slow fade through darkness rather than a jump. If Kling fights it, the site can
still cover the middle with the MISSING flyer dropping through the frame.

**Extras (optional, 2–4):** the pile of printed flyers, flyers up around SE16, the
first evening back home. No neighbours' faces, no house numbers.

**Drop into:** `assets-raw/story/03-missing-found/` (`clip/`, `start-frame/` for
the final-frame photo too, `extras/`). Put the final-frame photo in
`extras/end-frame.jpeg` as well: chapter 4 starts from it.

---

## 4 · Riverside sofa

*November 2025 to now · Pacific Wharf · volume: The sofa on the river*

**On screen (assembles at the end):** **Riverside sofa** · *She's been next to me
the entire time I've been building this.*

**First frame:** chapter 3's final frame (`assets-raw/story/03-missing-found/extras/end-frame.jpeg`).

**Final frame, find in your camera roll:** **Kitty curled up on the sofa at
Pacific Wharf right next to your open laptop**, the window and the river behind
if you have one like that, recent (summer to September 2026). A bit of your arm
is good. Crop to 9:16.

**Prompt:**

```
One slow, continuous camera move from the first frame to the final frame, no cuts. The camera eases back from the black-and-white cat's face to reveal her lying on the sofa by a big window over the River Thames, next to an open laptop. Afternoon light glitters on the water outside and drifts across her fur; she settles, tucks her chin and half-closes her eyes, as in the final frame. Keep her markings exactly as in both frames. Photoreal, warm, smooth steady camera, one continuous shot.
```

**Extras (optional, 2–3):** the river from the window; her on the sofa on other
days; moving day, November 2025.

**Drop into:** `assets-raw/story/04-riverside-sofa/`.

---

## Done: chapters 1 and 2

- **1 · A cold night**: `01-a-cold-night/clip/a-cold-night-come-inside.mp4`
  (576×1024, 5 s), start frame of her outside the back door, final frame =
  the WhatsApp photo (`extras/end-frame.jpeg`).
- **2 · Five by dawn**: `02-five-by-dawn/clip/five-by-dawn.mp4` (576×1024,
  5 s), starts on chapter 1's final frame, ends on Kitty and the calico
  newborn (`extras/end-frame.jpeg`). `extras/Kittens1–5.jpeg` play inside the
  chapter.
- The neighbours' WhatsApp screenshot now lives in `ui/whatsapp/`: the
  original (untouched, never published) is in `ui/whatsapp/original/`, and
  `ui/whatsapp/whatsapp-chat.jpeg` is the published copy with names, numbers,
  profile photos and the house number blurred.

## Where everything goes

```
assets-raw/
├─ story/
│  ├─ 01-a-cold-night/       clip/  start-frame/  extras/end-frame.jpeg
│  ├─ 02-five-by-dawn/       clip/  start-frame/  extras/Kittens1–5, end-frame
│  ├─ 03-missing-found/      clip/  start-frame/  extras/ (end-frame.jpeg = its final frame)
│  └─ 04-riverside-sofa/     clip/  start-frame/  extras/
├─ ui/
│  ├─ whatsapp/     the blurred chat (+ original/, never published)
│  ├─ flyer/        the MISSING flyer, flat and high-res (for the drop between 2 and 3)
│  ├─ cutout/       optional: transparent Kitty, side-on
│  └─ portrait/     your favourite photo (the share image)
├─ kitty-identity/  optional
└─ turntable/       optional: a 10–20 s video circling her
```

JPEG, PNG or iPhone HEIC for photos; the MP4 artta gives you for clips. Raw files
never leave your machine; `npm run story` makes the web versions.

## Checklist

- [x] 1 · A cold night
- [x] 2 · Five by dawn
- [ ] 3 · Missing, Found: final-frame photo, clip, extras
- [ ] 4 · Riverside sofa: final-frame photo, clip, extras
- [ ] `ui/flyer/`: the flyer, flat and high-res
- [ ] `ui/portrait/`: favourite photo (share image)
