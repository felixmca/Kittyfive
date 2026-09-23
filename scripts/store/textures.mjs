// Textures for the store's living room, garden and river, from Felix's
// photos (assets-raw/room, never committed) and from code.
//
//   node scripts/store/textures.mjs
//
// Writes:
//   assets-raw/room/build/*.png      what the Blender build (room.py) paints on:
//                                    the flattened pictures on the walls, the
//                                    rug, the beech floor, brick and paving.
//                                    The GLB carries them, so only it is
//                                    committed, like the story's frames.
//   public/store/farbank-evening.webp  the far bank of the Thames at dusk, cut
//   public/store/farbank-day.webp      out of the gate photo (sky removed), and
//                                      a daylight version of the same skyline,
//                                      for the river shader (RiverWindow.tsx).
//
// The photos are the reference Felix sent on 23 Sep 2026 (see
// docs/HANDOVER-04-STORE-PHOTOS.md for the shot list). Corners below are in
// the photos' own pixels (1536×2048).

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { warpQuad } from "./warp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW = join(root, "assets-raw", "room");
const OUT = join(RAW, "build");
const PUB = join(root, "public", "store");
mkdirSync(OUT, { recursive: true });
mkdirSync(PUB, { recursive: true });

// ─── small helpers ───────────────────────────────────────────────────────────

/** Deterministic random numbers, so a rebuild paints the same floor. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1], tileable with period `px` × `py` cells. */
function makeNoise(seed, px, py) {
  const r = rng(seed);
  const grid = Array.from({ length: px * py }, () => r());
  const at = (x, y) => grid[((y % py) + py) % py * px + (((x % px) + px) % px)];
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const a = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx;
    const b = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx;
    return a * (1 - fy) + b * fy;
  };
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function readRaw(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

async function savePng(buf, w, h, channels, file) {
  await sharp(buf, { raw: { width: w, height: h, channels } }).png().toFile(file);
}

// ─── pictures on the walls, lifted flat out of the photos ────────────────────

async function wallPictures() {
  const sofa = await readRaw(join(RAW, "living", "08-sofa-bookcase-cat-tree.jpg"));
  const pictures = {
    // The Beauty Parlour sign over the bookcase (frame included).
    "art-beauty-parlour": [[[392, 728], [661, 740], [662, 897], [398, 908]], 1024, 584],
    // The op-art maze print in its pine frame, left of it.
    "art-maze": [[[122, 725], [248, 735], [263, 873], [146, 878]], 420, 504],
    // The small pink print, right of it.
    "art-pink": [[[726, 757], [779, 758], [780, 853], [728, 852]], 240, 420],
  };
  for (const [name, [corners, w, h]] of Object.entries(pictures)) {
    const raw = warpQuad(sofa, corners, w, h);
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
      .modulate({ brightness: 1.06, saturation: 1.08 })
      .png()
      .toFile(join(OUT, `${name}.png`));
  }
  // The row of five small framed maps on the left wall, and the botanical print by the window.
  const dining = await readRaw(join(RAW, "living", "06-window-and-dining-table.jpg"));
  const maps = warpQuad(dining, [[948, 562], [1316, 571], [1314, 632], [949, 627]], 1024, 168);
  await savePng(maps, 1024, 168, 3, join(OUT, "art-maps.png"));
  const botanical = warpQuad(dining, [[626, 658], [716, 662], [716, 823], [628, 823]], 300, 540);
  await savePng(botanical, 300, 540, 3, join(OUT, "art-botanical.png"));
}

// ─── the far bank, cut out of the gate photo ─────────────────────────────────

/**
 * For each column, the skyline is where the bright blue sky gives way to dark
 * buildings (the first run of dark pixels from the top). Above it is sky and
 * goes transparent; below it the photo stays, lit windows and all. Evening is
 * the photo as taken (it was dusk); day is the same skyline repainted in hazy
 * daylight colours with the windows put out, until Felix sends a daytime one.
 */
async function farBank() {
  const src = join(RAW, "garden", "07-gate-to-river.jpg");
  // The strip between the gate posts, from above the tower block down to the water.
  const box = { left: 392, top: 858, width: 760, height: 118 };
  const scale = 2;
  const w = box.width * scale;
  const h = box.height * scale;
  const { data } = await sharp(src)
    .extract(box)
    .resize(w, h, { kernel: "lanczos3" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const L = (i) => (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  const edge = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let top = h - 1;
    for (let y = 0; y < h - 3; y++) {
      let dark = 0;
      for (let k = 0; k < 3; k++) if (L(((y + k) * w + x) * 3) < 0.36) dark++;
      if (dark === 3) {
        top = y;
        break;
      }
    }
    edge[x] = top;
  }
  // Tidy the skyline: a 3-wide median removes single-column spikes of noise.
  const med = Float32Array.from(edge, (_, x) => {
    const a = [edge[Math.max(0, x - 1)], edge[x], edge[Math.min(w - 1, x + 1)]].sort((p, q) => p - q);
    return a[1];
  });

  const eve = Buffer.alloc(w * h * 4);
  const day = Buffer.alloc(w * h * 4);
  const haze = hex("#b4c3d2");
  // Daylight facades, one per building: the skyline's steps (a jump in the
  // roof line) start a new building, which takes the next colour.
  const facades = ["#8e6452", "#a88c6b", "#c7bba5", "#7f5a49", "#b39c7c", "#9aa1a6", "#bfae8f"].map(hex);
  const building = new Int32Array(w);
  for (let x = 1, id = 0, since = 0; x < w; x++, since++) {
    if (Math.abs(med[x] - med[x - 1]) > 8 && since > 36) {
      id++;
      since = 0;
    }
    building[x] = id;
  }
  // Right of the tower block the far bank is a line of trees (and a spire).
  const treesFrom = Math.round(w * 0.795);
  const trees = hex("#5f6d55");
  const tower = hex("#8d9398");
  const glass = hex("#56616d");
  const grain = makeNoise(7, 256, 32);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const o = (y * w + x) * 4;
      const a = Math.round(255 * smooth(med[x] - 1.5, med[x] + 1.5, y));
      eve[o] = data[i];
      eve[o + 1] = data[i + 1];
      eve[o + 2] = data[i + 2];
      eve[o + 3] = a;
      // Daylight: the facade colour of this building, a little of the
      // photo's own light and shade as texture, lit windows turned into the
      // dark glass they are by day, and a touch of haze over the water.
      const lum = L(i);
      const warm = data[i] - data[i + 2];
      const lit = smooth(0.3, 0.5, lum) * smooth(10, 40, warm);
      const tall = med[x] < h * 0.28; // the tower block stands above everything
      const base = tall ? tower : x > treesFrom ? trees : facades[building[x] % facades.length];
      const k = 0.9 + 0.16 * (grain(x / 3, y / 3) - 0.5) + 0.25 * Math.min(0.3, lum);
      for (let c = 0; c < 3; c++) {
        let v = base[c] * k;
        v = v + (glass[c] - v) * lit * 0.4;
        day[o + c] = clamp(v + (haze[c] - v) * 0.22);
      }
      day[o + 3] = a;
    }
  }
  await sharp(eve, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(join(PUB, "farbank-evening.webp"));
  await sharp(day, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 86, alphaQuality: 90 }).toFile(join(PUB, "farbank-day.webp"));
  await sharp(eve, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(OUT, "farbank-evening.png"));
  await sharp(day, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(OUT, "farbank-day.png"));
  return { width: w, height: h };
}

// ─── the beech floor ─────────────────────────────────────────────────────────

/**
 * Light beech laminate like the flat's: boards of three strips, the strips
 * made of blocks of slightly different honey tones, faint grain along them,
 * a thin dark seam between boards. 1024 px = 1.28 m square, tiling.
 */
async function floor() {
  const S = 1024;
  const buf = Buffer.alloc(S * S * 3);
  const r = rng(11);
  const tones = ["#e3bd86", "#d9ae74", "#e8c796", "#d4a56c", "#dfb57c", "#eccc9e", "#cfa068"].map(hex);
  const lanes = 6;
  const laneW = S / lanes;
  const stripW = laneW / 3;
  const grain = makeNoise(3, 16, 256);
  const fine = makeNoise(5, 256, 32);
  // Each strip is a list of blocks [start, end, tone] along y, wrapping at S.
  const strips = [];
  for (let s = 0; s < lanes * 3; s++) {
    const blocks = [];
    let y = Math.floor(r() * S);
    const start = y;
    while (y < start + S) {
      const len = 180 + Math.floor(r() * 360);
      blocks.push([y, Math.min(start + S, y + len), tones[Math.floor(r() * tones.length)], r()]);
      y += len;
    }
    strips.push(blocks);
  }
  const jointOf = Array.from({ length: lanes }, () => Math.floor(r() * S));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const lane = Math.floor(x / laneW);
      const s = Math.floor(x / stripW);
      const blocks = strips[s];
      const yy = y < blocks[0][0] ? y + S : y;
      const b = blocks.find(([a, e]) => yy >= a && yy < e) ?? blocks[blocks.length - 1];
      const [, , tone, jitter] = b;
      const g = grain(x / 9, y / 4) * 0.6 + fine(x / 2.2, y / 32) * 0.4;
      let k = 0.9 + 0.1 * jitter + (g - 0.5) * 0.12;
      const xl = x - lane * laneW;
      if (xl < 1.5 || xl > laneW - 1.5) k *= 0.72; // seam between boards
      const dj = Math.abs(((y - jointOf[lane] + S) % S) - 0);
      if (dj < 1.5) k *= 0.78; // end joint
      const blockEdge = Math.min(Math.abs(yy - b[0]), Math.abs(yy - b[1]));
      if (blockEdge < 1) k *= 0.93;
      const o = (y * S + x) * 3;
      for (let c = 0; c < 3; c++) buf[o + c] = clamp(tone[c] * k);
    }
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).png().toFile(join(OUT, "floor-beech.png"));
}

// ─── London stock brick and paving, for the garden ───────────────────────────

async function brick() {
  const S = 1024; // 0.9 m square: 4 bricks of 225 mm, 12 courses of 75 mm
  const buf = Buffer.alloc(S * S * 3);
  const r = rng(21);
  const palette = ["#b4895a", "#a47a4c", "#c39b69", "#937052", "#9d8c71", "#7a5d42", "#b99466", "#a88a6a"].map(hex);
  const mortar = hex("#bdb4a3");
  const course = S / 12;
  const brickL = S / 4;
  const joint = 11;
  const speck = makeNoise(9, 128, 128);
  const soft = makeNoise(13, 32, 32);
  const colours = Array.from({ length: 12 * 5 }, () => palette[Math.floor(r() * palette.length)]);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / course);
    const off = row % 2 ? brickL / 2 : 0;
    const yIn = y - row * course;
    for (let x = 0; x < S; x++) {
      const xs = (x + off) % S;
      const col = Math.floor(xs / brickL);
      const xIn = xs - col * brickL;
      const o = (y * S + x) * 3;
      const isMortar = yIn < joint || xIn < joint;
      if (isMortar) {
        const m = 0.92 + 0.12 * speck(x / 3, y / 3);
        for (let c = 0; c < 3; c++) buf[o + c] = clamp(mortar[c] * m);
        continue;
      }
      const base = colours[(row * 5 + col) % colours.length];
      const sp = speck(x / 2.5, y / 2.5);
      let k = 0.86 + 0.22 * soft(x / 40, y / 40) + (sp > 0.82 ? -0.35 : 0) + (sp < 0.12 ? 0.12 : 0);
      // Slightly darker at the arrises, so the courses read.
      const edge = Math.min(yIn - joint, course - yIn, xIn - joint, brickL - xIn);
      if (edge < 4) k *= 0.9;
      for (let c = 0; c < 3; c++) buf[o + c] = clamp(base[c] * k);
    }
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).png().toFile(join(OUT, "brick-stock.png"));
}

async function paving() {
  const S = 1024; // 1.2 m square: four 600 mm slabs
  const buf = Buffer.alloc(S * S * 3);
  const r = rng(31);
  const tones = ["#c9bea8", "#c2b59c", "#cfc5b0", "#bcae96"].map(hex);
  const slab = S / 2;
  const speck = makeNoise(17, 256, 256);
  const stain = makeNoise(19, 16, 16);
  const slabTone = [0, 1, 2, 3].map(() => tones[Math.floor(r() * tones.length)]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const sx = Math.floor(x / slab);
      const sy = Math.floor(y / slab);
      const base = slabTone[sy * 2 + sx];
      const xi = x % slab;
      const yi = y % slab;
      const o = (y * S + x) * 3;
      let k = 0.9 + 0.1 * speck(x / 1.6, y / 1.6) + (stain(x / 60, y / 60) - 0.5) * 0.12;
      if (xi < 3 || yi < 3 || xi > slab - 3 || yi > slab - 3) k *= 0.62;
      for (let c = 0; c < 3; c++) buf[o + c] = clamp(base[c] * k);
    }
  }
  await sharp(buf, { raw: { width: S, height: S, channels: 3 } }).png().toFile(join(OUT, "paving.png"));
}

// ─── the folk rug under the coffee table ─────────────────────────────────────

/**
 * Painted from the photo rather than lifted (the coffee table stands on half
 * of it): black field, dark green scalloped border, a line of red dots, a
 * red and cream medallion in the middle, sprays of red berries, green leaves
 * and white flowers around it. 1024 × 1440 px = 1.42 × 2.0 m.
 */
async function rug() {
  const W = 1024;
  const H = 1440;
  const G = "#1f3b2b";
  const R = "#b3302a";
  const CREAM = "#efe6d2";
  const Y = "#d9a032";
  const LEAF = "#2f6b44";
  const LEAF2 = "#5d8f58";
  const GREY = "#9a9a94";
  const parts = [];
  // Border band with scallops on its inner edge.
  const b = 64;
  parts.push(`<rect width="${W}" height="${H}" fill="${G}"/>`);
  parts.push(`<rect x="${b}" y="${b}" width="${W - 2 * b}" height="${H - 2 * b}" fill="#141414"/>`);
  const sc = 44;
  for (let x = b + sc / 2; x < W - b; x += sc) {
    parts.push(`<circle cx="${x}" cy="${b}" r="${sc / 2}" fill="${G}"/>`, `<circle cx="${x}" cy="${H - b}" r="${sc / 2}" fill="${G}"/>`);
  }
  for (let y = b + sc / 2; y < H - b; y += sc) {
    parts.push(`<circle cx="${b}" cy="${y}" r="${sc / 2}" fill="${G}"/>`, `<circle cx="${W - b}" cy="${y}" r="${sc / 2}" fill="${G}"/>`);
  }
  // Dotted red line inside the scallops.
  const d = b + 48;
  for (let x = d; x <= W - d; x += 17) parts.push(`<circle cx="${x}" cy="${d}" r="4.5" fill="${R}"/>`, `<circle cx="${x}" cy="${H - d}" r="4.5" fill="${R}"/>`);
  for (let y = d; y <= H - d; y += 17) parts.push(`<circle cx="${d}" cy="${y}" r="4.5" fill="${R}"/>`, `<circle cx="${W - d}" cy="${y}" r="4.5" fill="${R}"/>`);

  const cx = W / 2;
  const cy = H / 2;
  // Medallion.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(`<ellipse cx="${cx + Math.cos(a) * 118}" cy="${cy + Math.sin(a) * 118}" rx="30" ry="16" transform="rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * 118} ${cy + Math.sin(a) * 118})" fill="${Y}"/>`);
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="104" fill="${R}"/>`, `<circle cx="${cx}" cy="${cy}" r="84" fill="${CREAM}"/>`);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(`<ellipse cx="${cx + Math.cos(a) * 46}" cy="${cy + Math.sin(a) * 46}" rx="30" ry="12" transform="rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * 46} ${cy + Math.sin(a) * 46})" fill="${R}"/>`);
  }
  parts.push(`<circle cx="${cx}" cy="${cy}" r="16" fill="${Y}"/>`);
  // Swirls and leaves either side of the medallion.
  const swirl = (x, y, s, flip) =>
    `<path d="M ${x} ${y} c ${40 * s * flip} ${-60 * s}, ${120 * s * flip} ${-40 * s}, ${100 * s * flip} ${10 * s} s ${-60 * s * flip} ${50 * s}, ${-20 * s * flip} ${60 * s}" stroke="${LEAF}" stroke-width="${22 * s}" fill="none" stroke-linecap="round"/>`;
  const leaf = (x, y, rot, col = LEAF2, s = 1) =>
    `<ellipse cx="${x}" cy="${y}" rx="${34 * s}" ry="${13 * s}" transform="rotate(${rot} ${x} ${y})" fill="${col}"/>`;
  const berries = (x, y, s = 1) => {
    const out = [];
    const r2 = rng(Math.round(x * 7 + y));
    for (let i = 0; i < 14; i++) {
      const a = r2() * Math.PI * 2;
      const rr = r2() * 46 * s;
      out.push(`<circle cx="${x + Math.cos(a) * rr}" cy="${y + Math.sin(a) * rr * 0.7}" r="${(10 + r2() * 6) * s}" fill="${R}"/>`);
    }
    return out.join("");
  };
  const whiteFlower = (x, y, s = 1) => {
    const out = [`<path d="M ${x} ${y + 40 * s} L ${x} ${y - 10 * s}" stroke="${GREY}" stroke-width="${5 * s}"/>`];
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6) * Math.PI;
      out.push(`<ellipse cx="${x + Math.cos(a) * 26 * s}" cy="${y + Math.sin(a) * 26 * s}" rx="${16 * s}" ry="${6 * s}" transform="rotate(${(a * 180) / Math.PI} ${x + Math.cos(a) * 26 * s} ${y + Math.sin(a) * 26 * s})" fill="${CREAM}"/>`);
    }
    return out.join("");
  };
  parts.push(swirl(cx - 250, cy - 40, 1, 1), swirl(cx + 250, cy + 40, 1, -1));
  parts.push(leaf(cx - 170, cy + 150, 30), leaf(cx + 170, cy - 150, 30), leaf(cx - 60, cy + 190, -40, LEAF), leaf(cx + 60, cy - 190, -40, LEAF));
  // Four sprays of berries on grey stems, with leaves.
  const sprays = [
    [cx - 250, cy - 330, 1],
    [cx + 240, cy - 300, -1],
    [cx - 240, cy + 310, 1],
    [cx + 250, cy + 330, -1],
  ];
  for (const [x, y, f] of sprays) {
    parts.push(`<path d="M ${x} ${y} q ${60 * f} 60 ${140 * f} 90" stroke="${GREY}" stroke-width="7" fill="none"/>`);
    parts.push(berries(x, y));
    parts.push(leaf(x + 110 * f, y + 70, 20 * f, LEAF2, 0.9), leaf(x + 150 * f, y + 110, -10 * f, "#c9c6bd", 0.7));
  }
  // White flower sprigs near the corners, and small cream leaves scattered.
  for (const [x, y] of [
    [cx - 330, cy - 520],
    [cx + 320, cy - 520],
    [cx - 330, cy + 540],
    [cx + 330, cy + 520],
    [cx, cy - 470],
    [cx, cy + 470],
  ]) {
    parts.push(whiteFlower(x, y, 1.1));
  }
  const r3 = rng(41);
  for (let i = 0; i < 26; i++) {
    const x = 180 + r3() * (W - 360);
    const y = 180 + r3() * (H - 360);
    if (Math.hypot(x - cx, y - cy) < 190) continue;
    parts.push(leaf(x, y, r3() * 180, r3() > 0.5 ? "#d8d2c2" : LEAF2, 0.55));
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join("")}</svg>`;
  // A woven feel: fine noise over the painted design.
  const base = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = makeNoise(51, 512, 720);
  const px = base.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const k = 0.9 + 0.2 * n(x / 2, y / 2);
      for (let c = 0; c < 3; c++) px[o + c] = clamp(px[o + c] * k);
    }
  }
  await sharp(px, { raw: { width: W, height: H, channels: 3 } }).blur(0.6).png().toFile(join(OUT, "rug-folk.png"));
}

// ─── soft light and shade ────────────────────────────────────────────────────

/**
 * Two greyscale-with-alpha helpers the room uses a lot: a soft contact shadow
 * (black, fading out from a rounded rectangle) under furniture, and the warm
 * wash an uplighter throws on the wall above it (white, fading out upwards).
 */
async function softShapes() {
  const S = 256;
  const shadow = Buffer.alloc(S * S * 4);
  const wash = Buffer.alloc(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      // Rounded-rectangle distance, 0 inside the core, 1 at the edge.
      const dx = Math.max(0, Math.abs(u) - 0.16) / 0.34;
      const dy = Math.max(0, Math.abs(v) - 0.16) / 0.34;
      const d = Math.min(1, Math.hypot(dx, dy));
      const o = (y * S + x) * 4;
      shadow[o + 3] = Math.round(255 * 0.62 * Math.pow(1 - d, 2.2));
      // The wash: brightest at the bottom centre (the lamp), fading up and out.
      const up = 1 - (y + 0.5) / S; // 0 at the bottom row
      const r = Math.hypot(u / 0.5, (up - 0.02) / 1.0);
      const a = Math.max(0, 1 - r) ** 2.2;
      wash[o] = 255;
      wash[o + 1] = 236;
      wash[o + 2] = 205;
      wash[o + 3] = Math.round(255 * a);
    }
  }
  await sharp(shadow, { raw: { width: S, height: S, channels: 4 } }).png().toFile(join(OUT, "shadow-soft.png"));
  // Row 0 of the PNG is the top of the wall; the lamp is at the bottom.
  await sharp(wash, { raw: { width: S, height: S, channels: 4 } }).png().toFile(join(OUT, "glow-wash.png"));
}

// ─── the koi rug by the kitchen ──────────────────────────────────────────────

/**
 * The carp-shaped rug (a koinobori): a long fish outline in black, rows of
 * white and blue scales, a big round eye with a red ring and the tail fins.
 * Transparent round the outline, so the rug is the shape of the fish.
 */
async function koi() {
  const W = 512;
  const H = 1400;
  const INK = "#161616";
  const parts = [];
  // Body outline: head at the top (y small), tail at the bottom.
  const body = `M 256 40 C 390 60 440 250 432 520 C 426 800 380 1040 330 1180 L 300 1180 C 312 1250 360 1320 420 1360 L 256 1300 L 92 1360 C 152 1320 200 1250 212 1180 L 182 1180 C 132 1040 86 800 80 520 C 72 250 122 60 256 40 Z`;
  parts.push(`<clipPath id="b"><path d="${body}"/></clipPath>`);
  parts.push(`<path d="${body}" fill="#e9e6de"/>`);
  // Scales: rows of arcs, alternating blue and ink, inside the body.
  const scales = [];
  for (let row = 0; row < 30; row++) {
    const y = 420 + row * 26;
    for (let col = -1; col < 11; col++) {
      const x = 40 + col * 48 + (row % 2) * 24;
      const fill = row % 3 === 0 ? "#3e5b86" : "#26282c";
      scales.push(`<path d="M ${x - 24} ${y} a 24 24 0 0 0 48 0" stroke="${fill}" stroke-width="7" fill="none"/>`);
    }
  }
  parts.push(`<g clip-path="url(#b)">${scales.join("")}</g>`);
  // Head: a dark cap, the eye (white, red ring, black pupil with a blue glint), red gills.
  parts.push(`<path d="M 110 330 C 150 250 360 250 402 330 L 402 380 C 330 360 180 360 110 380 Z" fill="${INK}" clip-path="url(#b)"/>`);
  parts.push(`<path d="M 120 400 C 200 380 312 380 392 400" stroke="#c0392b" stroke-width="16" fill="none"/>`);
  parts.push(`<circle cx="256" cy="200" r="104" fill="#f2efe8"/>`, `<circle cx="256" cy="200" r="84" fill="#c0392b"/>`, `<circle cx="256" cy="200" r="64" fill="#f2efe8"/>`, `<circle cx="256" cy="200" r="46" fill="${INK}"/>`, `<circle cx="240" cy="184" r="14" fill="#5a82b8"/>`);
  parts.push(`<path d="M 200 70 C 230 52 282 52 312 70" stroke="#e3b43c" stroke-width="12" fill="none"/>`);
  // Tail fins: ink with pale veins.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      parts.push(`<path d="M 256 ${1200 + i * 10} L ${256 + s * (60 + i * 38)} ${1330 - i * 8}" stroke="#8f8b82" stroke-width="5"/>`);
    }
  }
  parts.push(`<path d="${body}" fill="none" stroke="${INK}" stroke-width="14"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${parts.shift()}</defs>${parts.join("")}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, "rug-koi.png"));
}

// ─── run ─────────────────────────────────────────────────────────────────────

const need = [join(RAW, "living", "08-sofa-bookcase-cat-tree.jpg"), join(RAW, "garden", "07-gate-to-river.jpg")];
const missing = need.filter((f) => !existsSync(f));
if (missing.length) {
  console.log(`[room] photos not here (${missing.length} missing); nothing to do. They live in assets-raw/room on Felix's machine.`);
  process.exit(0);
}
const t0 = Date.now();
await wallPictures();
const fb = await farBank();
await Promise.all([floor(), brick(), paving(), rug(), softShapes(), koi()]);
console.log(`[room] textures in ${Math.round((Date.now() - t0) / 100) / 10}s; far bank ${fb.width}×${fb.height} → public/store`);
