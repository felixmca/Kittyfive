# Scanning the living room and garden for the in-game store

Goal: a metric 3D model of your ground-floor flat and garden that Kitty can walk
around in on a phone. Two deliverables come out of one photo session:

1. **A textured mesh (GLB)** with a walkable floor. This is what the store needs
   first: it gives Kitty something to stand on and the products somewhere to
   float. Required.
2. **A Gaussian splat** for photoreal visuals, drawn over a hidden collision
   mesh. Optional upgrade; looks dramatically better, costs more GPU work.

Everything below is free for you (verified 21 Sep 2026; licences noted).

## The one tool to install: RealityScan 2.2 (Epic, desktop, free)

RealityScan (formerly RealityCapture) 2.2 is free for individuals and companies
under US$1M revenue. Install it through the Epic Games Launcher and confirm the
licence text there, because the pricing page is login-gated. It aligns photos,
builds the mesh, textures it, and exports the camera registration a splat
trainer can reuse.

**Hardware caveat:** Epic's requirements page says NVIDIA CUDA compute 3.5+ with
1 GB VRAM. AMD support in 2.2 is press-reported only. Tell me your PC's GPU
before you shoot; if it is not NVIDIA, the fallback is Polycam Free on the phone
(exports glTF, 150-image cap, mesh quality much lower) or Meshroom (free, slow,
CPU-capable).

Do not pay for phone apps for this: Polycam Free exports glTF only, KIRI's
splat mode is Pro-only, Scaniverse Free forbids commercial use, Postshot Free
cannot export at all, and Luma's capture tools are being sunset.

## Capture protocol — Canon 750D, indoors

**Lens.** Widest you own, one focal length for the whole session, zoom ring
taped. EF-S 10-18 at 12–14 mm is ideal; the 18-55 kit lens at 18 mm works but
needs about 1.5–2× more photos. No fisheye.

**Exposure (Manual mode).** f/8 · ISO 100 on a tripod or 200–400 handheld ·
shutter 1/125 s handheld with IS on (1/60 minimum), or 0.5–2 s on a tripod with
the 2 s self-timer and IS off. RAW + JPEG; use the JPEGs first.

**Focus.** Manual, set once at about 1.2 m, then tape the ring. At 12 mm f/8
everything from 0.5 m to infinity is sharp.

**White balance.** Custom Kelvin, locked (about 4000 K with the room lights on).
Never Auto. Lock exposure too; if the windows blow out, fine, they get masked.

**Light.** All room lights on, blinds or curtains closed (fabric reconstructs,
bright glass does not). Overcast day or dusk so the light does not move. No
people, no Kitty in frame.

**Problem surfaces, fix before shooting.** Turn the TV and monitors off and cover
them with matte paper or a poster. Cover mirrors and glass tables with paper or
cloth. Glossy laminate: a dusting of dry shampoo kills the shine. Thin chair
legs, cables and plant stems will fail; expect to replace those with simple
shapes later.

**Featureless white walls.** Stick a few posters, patterned tea towels or sticky
notes on them for the shoot; remove them afterwards (or keep; they help
alignment and can be painted out).

**Overlap.** 70–80% between neighbouring frames, never more than about 30° of
viewpoint change, every surface in at least three photos. Move in arcs; do not
stand still and rotate.

### Shot pattern for a ~25 m² room (target 400–600 photos at 12–14 mm)

1. **Perimeter loop** hugging the walls, facing the opposite wall, one frame
   every 0.4–0.5 m, at three heights: 0.6 m tilted up ~20°, 1.4 m level, 2.0 m
   (a step or tall tripod) tilted down ~25°. About 105 frames.
2. **Inner loop** about 1 m in from the walls, same three heights. About 80.
3. **Centre orbit**: stand in the middle, one frame every 15–20°, two heights.
   About 40.
4. **Floor pass**: 1 m high, pointing down 45°, walking a grid. About 40.
5. **Detail orbits** of 20–40 frames around the sofa, the coffee table, the
   kitchen counter, the cat tree, and the corner where the snack machine will
   live. Three heights each.
6. **Doorway tunnels**: a continuous walk through each doorway, one frame every
   0.3 m, turning no more than 15° per frame. This is what glues rooms together.
7. **Scale**: lay a tape measure or two printed AprilTags on the floor, photograph
   them in five or more frames, and later add a distance constraint in
   RealityScan so the model is in metres (three.js units).

### The garden

Overcast, wind-free morning. Mask the sky in RealityScan (black masks are
excluded); never let the solver see sky. Two heights (0.5 m and 1.5 m) around the
perimeter plus a grid over the lawn. Plants reconstruct as blobs, so plan for the
garden to be splat-only visuals with a flat collider, and a three.js sky.

### Joining inside and outside

One project, one session, one lens. Shoot the patio door as a doorway tunnel
from inside towards the garden, then from the garden back inside, and include
frames that show the threshold, the door frame and one patio object from both
sides. If RealityScan produces two components, link them with control points
(at least four each, in two or more images).

## Processing

1. Develop all RAW with identical, flat settings: no sharpening, **no lens
   distortion correction** (RealityScan calibrates that itself). Export JPEG q95.
2. RealityScan: Align → check it is one component → set the distance constraint
   → Reconstruct at Normal detail → Simplify to ~1M triangles → Unwrap with a
   fixed texel size → Texture at 8192 → Export.
3. Export **two** meshes: the visual mesh (GLB or, if GLB export is missing in
   your build, OBJ/FBX which I convert in Blender) and a 30–50k triangle copy for
   the collider.
4. Export Alignment → Registration (XMP + sparse cloud + undistorted images) if
   we go on to splats.
5. Hand me `assets-raw/room/` and I run the web pipeline: KTX2 texture
   compression (a 4096² texture is 67 MB of GPU memory uncompressed, about 8 MB
   compressed; phones die without this), Draco geometry, a joined UV-less
   collider, a flood-fill of the actually walkable floor, and a measured
   manifest. The site loads `/models/room.glb` automatically when it exists.

## The splat upgrade (later)

Trainer: **Brush 0.3** (Apache-2.0, any GPU, WebGPU) or LichtFeld Studio (GPLv3;
the current Windows build is paid, the source and v0.4.2 build are free; needs an
NVIDIA RTX 20-series or newer). Both read COLMAP-style datasets; the simplest
route is to run COLMAP once on the same undistorted photos and align the result
to the RealityScan mesh using three landmarks. Clean up and compress in
**SuperSplat 3.x** (MIT, needs a WebGPU browser) to SOG or SPZ. Render with
**Spark 2.2** (MIT, three ≥ 0.180) inside our R3F scene, with the RealityScan
collider underneath. Budgets from Spark's own docs: ≤ 1M Gaussians on Android,
≤ 1.5M on iOS, ≤ 2.5M on desktop; prune and cap spherical harmonics at degree 1.

## What I need from you before the shoot

- Your PC's GPU model (NVIDIA or not decides the tool).
- Which lens you own (10-18 or only the 18-55).
- Whether your phone is an iPhone with LiDAR (only matters for a rough fallback).
