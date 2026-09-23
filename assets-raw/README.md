# assets-raw

Your drop zone for raw photos and clips. **Nothing in here is committed except
these README files**: the repo is public, so your camera roll stays on your
machine. `npm run story` turns what you drop here into web frames in `public/`,
and those are what get committed.

Start with `docs/HANDOVER-01-STORY-ASSETS.md`.

```
story/<chapter>/start-frame/   the cropped 9:16 photo you gave artta
story/<chapter>/clip/          the artta clip (any name; newest wins)
story/<chapter>/extras/        real photos from the same time (tile + photo strip)
ui/flyer/                      the MISSING flyer, flat and high-res
ui/cutout/                     transparent PNG of Kitty, side-on
ui/portrait/                   your favourite photo of her (share image, story ending)
ui/whatsapp/                   the neighbours' chat, BLURRED (original/ is never published)
kitty-identity/                optional: 4–8 photos of her markings
turntable/                     optional: a 10–20 s video circling her
products/                      artwork for the merch (Phase 2 of commerce)
room/                          living room + garden reference (Phase 3); room/build/ is made from it
tryon/                         photos or videos of you, to fit the try-on to a real person (Phase 4)
feedback/                      screenshots of things to fix, one folder per day
merch/build/                   made by scripts/store/merch-textures.mjs
```

Chapters: `01-a-cold-night`, `02-five-by-dawn`, `03-missing-found`, `04-riverside-sofa`.
Each chapter's first frame is the previous chapter's final frame (`extras/end-frame.jpeg`).
