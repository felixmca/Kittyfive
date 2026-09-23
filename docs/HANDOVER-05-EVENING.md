# Handover 05: the evening session (23 Sep 2026)

Felix tried the site on an iPhone and sent screenshots of what looked wrong,
photos of the living room and garden at Pacific Wharf, and the link Supabase
sent after signing up, asking for the reports to be checked, the admin
sign-in to work the Birthday Lobby way, the store's clothes, Kitty and the
view across the Thames to be much more detailed (keeping the store's look),
the screenshots filed, and whether photos of Felix would help the try-on.
This file is the log; the newest entry is at the bottom of "Progress".

## For Felix, when you are back

**Everything below is live at https://kittyfive.vercel.app.**

**Your iPhone test worked.** Six story reports came in from your iPhone
(Safari on iOS 26): the landing story started in about 0.6 s, you swiped
through all four chapters twice, and there were no errors, no stalls and no
crash-reloads. It never held more than 33 frames in memory (the budget is
40). The fix from this morning holds on a real phone.

**Signing in.** Your account is confirmed and is the admin. The link
pointed at `localhost` only because Supabase's **Site URL** is still
`http://localhost:3000`: Supabase quietly swaps that in for any address not
on its list. Birthday Lobby had exactly this, and its PASSWORD-RESET.md says
no code change fixes it. The code here already works the Birthday Lobby way:
sign in with a password, reset it by email, and choose a new one from the link.
The harness now checks that flow too. Two minutes in Supabase fixes it:

1. Supabase → project **Kittyfive** → **Authentication → URL Configuration**
2. **Site URL:** `https://kittyfive.vercel.app`
3. **Redirect URLs:** add `http://localhost:3000/**` and `http://localhost:3201/**`
4. Then sign in at https://kittyfive.vercel.app/account with your email and
   password. The menu gains **Admin** (Kitty Tunables).

Until step 2 is done, a password-reset email would also send you to
localhost. The link you pasted contained a live sign-in token. Pressing
**Sign out** on the site once ends every session, including that one.

**Please look at on your phone:**
1. **The store** (`/store`). It is now your living room, modelled from your
   photos: the grey corner sofa with the mustard cushions and the sage
   bolster, the coffee table on the black folk rug, the leather recliner
   with its throw, the pine bookcase (sunflowers, the tennis-ball lantern,
   the wicker lamp), the Beauty Parlour sign and the maze print (lifted
   straight out of your photos), the cap rack, the scroll bench, the coats,
   the hall door, the cat tree and the koi rug. Through the patio door are
   the yard, the white gate, the Thames Path railings and lamp posts, and the
   **far bank of the Thames, which is your own dusk photo from the gate**,
   cut out along the skyline and mirrored in water that moves. In the
   evening the lamps, uplighters and festoon lights come on.
2. **The clothes are proper 3D models**: a six-panel cap with Kitty
   embroidered on the front, a hoodie (hood, drawstrings, pocket, ribbed
   cuffs and hem, Kitty on the chest) and the long-sleeve with **the
   MISSING flyer printed on the back** (her photo as a halftone). They turn
   slowly, so the back comes round.
3. **Kitty is new**: a smooth 3D cat with her own markings: the white bib
   and front legs with the black patch high on one, white socks, the blaze
   between yellow-green eyes, the black spot on her chin, and her collar
   and tag. She walks properly, walks *round* the furniture now, jumps onto
   the ottoman, and looks up at you when she stops.
4. **Stories:** the "?" box on chapter 1's picture should be gone. Your
   phone had kept a failed copy of that picture (the file itself is fine),
   so pictures now retry once under a fresh address and step aside if they
   still fail. The gold button no longer runs under the clock when you
   scroll: there is a dark strip under the status bar.
5. **The try-on** (`/try-on`). Your screenshots showed the drawn cap too
   small and too high (a button in profile), and the hoodie low and narrow.
   I played your screenshots into a test browser as its camera, so the
   site's own tracking ran on your real face and body. From that:
   - **the cap is now 3D by default**: the store's cap model, at real size,
     on your head, turning with it, the brim just above your eyebrows;
   - **the hoodie and long-sleeve are fitted by default**: they start at your
     collar, as wide as you, and a raised arm takes its sleeve with it;
   - **the new Kitty walks beside you there too** (the store's model, in
     place of the blocky cat);
   - `?cap3d=0` and `?fit=0` bring the old flat versions back, if you
     want to compare.

**Photos of yourself for the try-on: yes, please.** They are how the rest
of the fitting gets done: your screenshots worked for a first pass, but the
old overlay covers what the tracker needs. Short phone videos are best: the
test browser plays them as its camera, so the site's own code runs on you
frame by frame. The shot list is in
`assets-raw/tryon/README.md`: a selfie turning your head, the same in any
real cap, then standing back (head to hips) moving your arms, the same in a
plain hoodie. They stay on your machine and are never committed or put
online.

**What only you can do:**
- The Supabase Site URL above (2 minutes).
- Try-on videos (`assets-raw/tryon/felix/`).
- Optional: a **daytime** photo from the garden gate, landscape and 1×
  zoom, so the far bank by day can be your photo too (it is a repaint of the
  dusk one for now).
- Chapters 3 and 4 when you have them.

## Progress

### 1 · Your iPhone reports

The six reports from your iPhone (Safari 26.6.1, a 428 × 781 viewport at 3×)
all have the story started (0.57 s the first time, then about 0.07 s from
cache), no errors and no stalls. Chapter 4 was reached twice, a peak of 33
decoded frames, and no crash-reload flag. Two earlier reports came from Edge
on a Windows PC, also clean. The try-on and store pages send no reports of
their own, so the screenshots are the evidence there.

### 2 · Pictures that fail on an iPhone, and the status bar

iOS Safari draws a "?" box for a picture that fails (Chrome draws nothing),
and it keeps the failure. Chapter 1's tile and cover showed one on your
phone, but the file loads fine in WebKit on production. Most likely your phone
cached a failed response, possibly from the day everything under `/story`
was cached "for a year, never changes", even a "not found". A new
`RetryImg` asks once more under a fresh address, which no cache has seen,
and removes itself if that fails too. On a tile, the other picture then fills
it. It also checks on mount, because a server-rendered picture can fail
before React is listening. The harness caught exactly that case, which is
probably what your phone hit. It is used by the tiles, the reader's
scenes and the camera roll, and the harness now fails a picture on purpose
both ways.

Pages scroll up under the iPhone status bar (the page is edge to edge), so
the gold "Start from the beginning" button ran behind the clock. A strip of
the page's own dark sits under the status bar on every page now. It has no
height on a computer.

### 3 · Sign-in: the Birthday Lobby way, now checked

Kitty already had Birthday Lobby's pattern: email and password,
confirm-email on, "Forgotten your password?", and a reset link that lands on
"Choose a new password" (read from the address before Supabase clears it).
Two things changed:
- Demo mode now honours reset links and dead links too, so the harness can
  prove the order of things without a mailbox (journey `account`: the
  same answer for any address, the reset link lands on the new-password
  form, the link's parameters are scrubbed, a short password is refused,
  and a dead link says so).
- Saving a new password used to flash the form back empty, because ending
  "recovery" swapped the page mid-save. It now stays on "New password
  saved".

Your account is confirmed (the link did its work before the redirect went
astray), and your address is in `admins`, so you are the admin as soon as
you sign in.

### 4 · The store, rebuilt from your photos

The photos you sent are filed under `assets-raw/room/living/` and `garden/`
with the names Handover 04 uses. The screenshots went to
`assets-raw/feedback/2026-09-23-iphone/` and, the try-on ones with your face,
to `assets-raw/tryon/felix/`. None of it is committed.

How the room is made (all scripted, so it can be rebuilt):
- `scripts/store/textures.mjs` lifts the flat things out of your photos
  (the Beauty Parlour sign, the maze print, the pink print, the maps, the
  botanical print) with a perspective warp. It cuts the far bank out of the
  gate photo along the skyline, and paints the rest in code: the beech floor
  (three-strip boards like yours), London stock brick, paving, the folk rug
  and the koi rug (painted from the photos, because the coffee table covers
  half of the real rug), and soft shadows and the uplighters' glow.
- `scripts/store/room.py` builds the room and garden in Blender (run
  headless; you did not need to open it) from
  `src/components/store/layout.json`. That one file holds every position,
  and the site reads it too: Kitty's spots, the places she wanders to, and the
  furniture she walks round. Flat colours ride on the vertices, so the whole
  house is 27 meshes (27 draw calls, down from 98 on the old room), 37k
  triangles, 600 KB.
- The Thames is a painted backcloth (`RiverBackdrop.tsx`): the sky moves
  from day to your dusk colours, your far bank photo sits on the horizon
  (a daylight repaint by day), and the water mirrors it with ripples and
  glints.
- Kitty now walks round the furniture (`paths.ts`: the shortest way through
  the corners of whatever is in the way), jumps onto the ottoman from a
  spot beside it, and jumps down again before walking anywhere. Her three
  wander stops are the open patio door ("The river's out there…"), her cat
  tree, and the good bit of rug.
- On a portrait phone the camera stands further back at each stop, so she
  and the product both fit.

### 5 · The clothes, as models

`scripts/store/merch.py` builds all three at real size. `merch-textures.mjs`
makes the embroidered face (the site's own Kitty mark, with satin-stitch
sheen) and the MISSING flyer print (her face from chapter 1 as a halftone,
"KITTY", tear-off tabs). The cloth takes the colour you choose in the store.
When your real flyer arrives (`assets-raw/ui/flyer/`), the print should be
made from it instead.

### 6 · Kitty, in 3D

`scripts/store/kitty.py`: a body made smooth over a stick skeleton, a
sculpted head, ears, eyes with slit pupils, nose, whiskers, and her collar
and tag. Her markings are painted from your photos and chapter 1's close-up.
She has a rig and two clips, "Walk" (0.6 s, the pace the store walks her at)
and "Idle", and the site turns her head to look at you when she stops. She is
9k triangles, 350 KB.

### 7 · The try-on, fitted to a real person

Felix's screenshots, turned into a camera feed
(`--use-file-for-fake-video-capture`), ran through the real MediaPipe
tracking (see "Things this session learned").
- **Cap.** The 3D cap (`Cap3D.tsx`) was right to exist: it turned with
  the head where the flat one shrank. But its crown sat at the hairline and
  was too shallow for real hair. It now wears the store's cap model
  (`/models/merch-cap.glb`, metres converted to face widths, 14.5 cm) with
  its band about a third of a face width below landmark 10, tipped back a
  little, dyed the chosen colour; the drawn cap stands in while it loads.
  It is the default (`?cap3d=0` for the flat one, which also takes over
  by itself when face tracking cannot start). In full profile MediaPipe
  loses the face and the page asks the wearer to look at the camera.
- **Flat garments** (the fallback): width 1.95 × shoulder width (was 1.6),
  top edge 34 % of it above the shoulders (was 12 %). The tracker's
  shoulders are the joints, well below the neck, so the neckline had been
  landing on the chest.
- **Fitted garments** (`fitGarment.ts`): the shoulder line 20 % of the
  shoulder width above the joints and 16 % outside them; sleeve roots at
  the shoulder. The default now (`?fit=0` for flat); it already drops to
  fewer pixels on a slow phone.
- **The flat cap** (fallback): 2.25 × the head's width, and never smaller
  than 1.7 × the eye-to-ear distance, so a turned head keeps its size.
- **Kitty beside you** (`KittyCompanion.tsx`) is the store's model now,
  walking and standing with her own clips; the procedural cat stands in
  while she loads.
- Still to do with Felix's footage (`assets-raw/tryon/README.md`): tune
  all of this on video, not stills; the store's hoodie and long-sleeve
  models could replace the drawn garments in the fitted warp.

## Things this session learned the hard way

- **Blender runs headless here**: `node scripts/store/blender.mjs <script.py>`
  (Blender 5.2 at the usual path, or `BLENDER=`). Nobody needs to open it;
  the Blender MCP is only needed to watch the viewport.
- **three.js turns off depth writes for a glTF "BLEND" material.** A decal
  that you then switch to a cut-out (alphaTest) must set `depthWrite = true`
  again. Otherwise, whenever it happens to draw before the cloth under it,
  the cloth paints over it. (The embroidery vanished when the merch meshes
  were merged, because the material order changed.)
- **Merging meshes in Blender drops which colour layer is active**, and the
  glTF exporter then writes white vertex colours. Set
  `color_attributes.active_color` after a merge.
- **A server-rendered `<img>` can fail before React is listening**, so
  `onError` never fires; check `complete && naturalWidth === 0` on mount.
- **A picture's "?" on iOS is sticky**: Safari keeps the failed response,
  so a fresh address (`?retry=1`) is the way round it, not a reload.
- **Supabase swaps the Site URL in for any redirect it does not know**,
  silently. Code cannot fix a Site URL of `localhost`.
- **Testing the try-on on a real face without a person**: turn a photo or
  video into a `.y4m` (`ffmpeg -loop 1 -i photo.jpg -t 2 -r 15 -vf
  "scale=640:-2,format=yuv420p" -f yuv4mpegpipe face.y4m`) and launch
  Chromium with `--use-file-for-fake-video-capture=face.y4m`. The site's
  own MediaPipe tracking then runs on it.
