# Handover 04: photos for the store (Phase 3)

*Written 23 Sep 2026. What to shoot so the next session can build the store:
your living room and garden as a stylised, animated 3D house in Blender, and
Kitty herself as the 3D cat who walks you round.*

Nothing here needs to be perfect. The house is **stylised** (soft shapes,
toon-ish shading), so the photos are reference, not textures: they tell the
model where things are, how big, and what colour. Rough and complete beats
beautiful and partial.

**Where it goes:** everything below lives in `assets-raw/`, which never leaves
your machine (the repo is public). Drop the files, tell the next session, done.

**Kit:** the Canon 750D with the kit lens at its widest (18 mm) for rooms, or
your phone's normal 1× camera (not the 0.5× ultra-wide: it bends straight
lines, which makes modelling harder). Landscape for rooms, portrait is fine
for close-ups.

**Before you shoot:** daylight, main lights off, curtains open. Overcast is
ideal (even light, no hard shadows). Put away anything with an address or a
name on it (post, parcels), and keep people and the neighbours' windows out
of frame.

---

## 1 · The living room → `assets-raw/room/living/`

Stand with the camera at chest height (about 1.5 m) unless it says otherwise.

| File | Where you stand | What it is for |
|---|---|---|
| `01-doorway.jpg` | in the doorway you usually walk in through, looking in | the store's opening view |
| `02-corner-a.jpg` … `05-corner-d.jpg` | in each corner, looking across to the opposite corner | the room's shape and where everything sits |
| `06-window.jpg` | 2–3 m back from the window, straight on | the window's size and frame |
| `07-window-view.jpg` | close to the glass, looking out | the river the window shows |
| `08-sofa.jpg`, `09-sofa-side.jpg` | straight on, then from 45° | the sofa (Kitty's spot) |
| `10-counter.jpg`, `11-counter-end.jpg` | straight on, then from one end | the kitchen counter |
| `12-floor.jpg` | pointing straight down at the floor | floor colour and boards |
| `13-wall.jpg` | a plain patch of wall | wall colour |
| `14-<thing>.jpg` … | anything Kitty loves: her bed, bowl, scratching post, favourite chair, the rug, the lamp, plants | the props she walks between (name the file after the thing, e.g. `14-bowl.jpg`) |

**Evening set (optional, five minutes):** the same `01-doorway` and `08-sofa`
after dark with the lamps you actually use switched on, saved as
`20-evening-doorway.jpg` and `21-evening-sofa.jpg`. The store has a day and an
evening light, and these set the evening colours.

## 2 · The garden → `assets-raw/room/garden/`

| File | Where you stand | What it is for |
|---|---|---|
| `01-from-door.jpg` | in the doorway to the garden, looking out | the first view of the garden |
| `02-far-end.jpg` | at the far end, looking back at the flat | the garden's length and the back of the flat |
| `03-left.jpg`, `04-right.jpg` | in the middle, looking at each side | fences, beds, walls |
| `05-plant-<name>.jpg` … | close-ups of the three or four biggest plants | stylised plants that sway |
| `06-river.jpg` | wherever you can see the river from the garden | the backdrop |

## 3 · Measurements → `assets-raw/room/measurements.txt`

To the nearest 10 cm is plenty. A photo of a sketch on paper with the numbers
on it works just as well (`assets-raw/room/sketch.jpg`).

```
Living room: length ×  width ×  ceiling height
Window: width × height, height of the sill from the floor
Doors: which wall, how wide
Sofa: length × depth × seat height
Counter: length × depth × height
Coffee table: length × width × height
Garden: length × width; the door into it: width
```

## 4 · Kitty's markings → `assets-raw/kitty-identity/`

The 3D cat is a free (CC0) cat model that the next session repaints as Kitty,
so her black and white patches have to match. Six to eight photos with her
whole body in frame, sharp, in even daylight, a plain background if you can:

`left.jpg` (her left side), `right.jpg`, `front.jpg` (face on, eye level),
`top.jpg` (from above while she lies down), `back.jpg`, `chest.jpg` (the white
bib), `paws.jpg`, `tail.jpg`.

Snacks are allowed as bribes. Several sessions are fine; she does not have to
cooperate all at once.

## 5 · The turntable → `assets-raw/turntable/`

The end of the landing page has a "swipe to spin Kitty" circle that is still a
drawn cat. Either:

- **a video** (easiest): while she sits still (a snack helps), walk slowly all
  the way round her in 10–20 seconds, phone at her eye level, the same
  distance all the way, her in the middle of the frame. Save as
  `assets-raw/turntable/orbit.mp4`; or
- **photos**: 18–36 stills from evenly spaced points around her, same height
  and distance, named in order (`01.jpg`, `02.jpg`, …).

Then run `npm run story`: it cuts the video (or the photos) into 36 frames in
`public/turntable/`, and the landing's turntable uses them straight away.

---

## What the next session does with them

1. Builds the living room and garden in Blender as one stylised scene: simple
   shapes from the photos and measurements, your colours, baked lighting for
   day and for evening, exported as a compressed GLB (`public/models/room.glb`).
   The store already loads that file when it exists and falls back to the
   drawn room when it does not.
2. Repaints the CC0 cat as Kitty from `kitty-identity/` (walk, idle, sit and
   jump animations) as `public/models/kitty.glb`, which the store also picks
   up by itself.
3. Sets Kitty's tour (sofa → window → counter → garden) and the product spots
   from the real layout.
