#!/usr/bin/env node
/**
 * print-files.mjs — the three print files Printful fetches from the live site
 * (NEXT_PUBLIC_SITE_URL + the paths in src/config/printful.ts PRINT_FILES).
 *
 *   node scripts/print-files.mjs        (also: npm run print-files)
 *
 * Writes public/print/ (committed; Printful downloads them when a product is
 * synced or a catalog order is placed, so the site has to be DEPLOYED with
 * them before `node scripts/printful.mjs products sync` can work):
 *
 *   kitty-face-embroidery.png  2000 × 2000, transparent, FLAT colours only, all
 *                              five from Printful's thread palette (fur black,
 *                              bib/outline white, whiskers + mouth grey, eyes
 *                              gold, ears + nose flamingo, pupils black). No
 *                              highlights, gradients, sheen or shadow. Every
 *                              stroke ≥ 3% of the design height, because the
 *                              cap front is 1.75 in tall and embroidery needs
 *                              lines ≥ 0.05 in. Cap front + hoodie left chest.
 *   kitty-face-ink.png         1500 × 1500, ONE colour (black) on transparent for
 *                              the long-sleeve's sleeve: fur filled black, bib and
 *                              eye whites transparent (the white shirt shows
 *                              through), black eye rings + pupils, black
 *                              nose / mouth / whiskers, black-outlined ears.
 *   missing-flyer-back.png     2400 × 3394, the MISSING flyer in black ink only on
 *                              transparent (no background): merch-textures'
 *                              1024 × 1448 flyer with every coordinate and font
 *                              size × 2.34375. DTG wants ≥ 150 dpi; at 16 in
 *                              tall that is 2400 px, so 3394 is comfortable.
 *
 * The face is the site's own mark (scripts/store/kitty-face-svg.mjs, shared
 * with scripts/store/merch-textures.mjs); the flyer's photo is chapter 1's
 * close-up of her (public/story/01-a-cold-night/extras/end-frame.webp).
 *
 * After writing, every file is read back and checked: dimensions, an alpha
 * channel, and the exact colour set (embroidery: the five thread colours and
 * nothing else; ink and flyer: #000000 only). Exit code 1 if anything is off.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { kittyFaceSvg } from "./store/kitty-face-svg.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "print");

/** The five Printful thread colours Kitty's face uses (src/config/printful.ts THREAD). */
const THREAD = {
  black: "#000000",
  white: "#FFFFFF",
  grey: "#96A1A8",
  gold: "#FFCC00",
  flamingo: "#CC3366",
};

const FILES = {
  embroidery: "kitty-face-embroidery.png",
  ink: "kitty-face-ink.png",
  flyer: "missing-flyer-back.png",
};

function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Flat embroidery file. Rendered without anti-aliasing so each pixel is one
 * palette colour; the snap afterwards is the safety net the spec asks for
 * (nearest thread colour for any opaque pixel, alpha thresholded at 128) and
 * reports how many pixels it actually had to move.
 */
async function embroidery() {
  const S = 2000;
  const svg = kittyFaceSvg(S, {
    palette: {
      fur: THREAD.black,
      outline: THREAD.white,
      ears: THREAD.flamingo,
      bib: THREAD.white,
      eyes: THREAD.gold,
      pupils: THREAD.black,
      nose: THREAD.flamingo,
      mouth: THREAD.grey,
      whiskers: THREAD.grey,
    },
    // Stroke widths in 48ths of the design: outline 2.7 (5.6%), whiskers 1.68
    // (3.5%), mouth 1.62 (3.4%) — all ≥ 3%, i.e. ≥ 0.05 in on the 1.75 in cap front.
    strokeScale: { outline: 1.5, whiskers: 2.1, mouth: 1.8 },
    highlights: false,
    crispEdges: true,
  });
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const palette = Object.values(THREAD).map(hexToRgb);
  let snapped = 0;
  let alphaFixed = 0;
  for (let o = 0; o < data.length; o += 4) {
    const a = data[o + 3];
    if (a < 128) {
      if (a !== 0) alphaFixed++;
      data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
      continue;
    }
    if (a !== 255) alphaFixed++;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [r, g, b] = palette[i];
      const d = (data[o] - r) ** 2 + (data[o + 1] - g) ** 2 + (data[o + 2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > 0) snapped++;
    [data[o], data[o + 1], data[o + 2]] = palette[best];
    data[o + 3] = 255;
  }
  await sharp(data, { raw: { width: S, height: S, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, FILES.embroidery));
  console.log(`[print] ${FILES.embroidery}: ${S}×${S}, snapped ${snapped} off-palette px, fixed ${alphaFixed} partial-alpha px`);
}

/**
 * One-colour ink file. Everything that should be the shirt is drawn as pure
 * white, the SVG is flattened onto white, and a 50% luminance threshold turns
 * it into black-or-transparent.
 */
async function ink() {
  const S = 1500;
  const svg = kittyFaceSvg(S, {
    palette: {
      fur: THREAD.black,
      outline: THREAD.black,
      ears: THREAD.white,
      earStroke: THREAD.black,
      bib: THREAD.white,
      eyes: THREAD.white,
      eyeStroke: THREAD.black,
      pupils: THREAD.black,
      nose: THREAD.black,
      mouth: THREAD.black,
      whiskers: THREAD.black,
    },
    strokeScale: { outline: 1, whiskers: 2, mouth: 1.8, ears: 1.2, eyes: 1.2 },
    highlights: false,
  });
  const { data } = await sharp(Buffer.from(svg))
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(S * S * 4, 0);
  let inked = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < 128) {
      out[i * 4 + 3] = 255;
      inked++;
    }
  }
  await sharp(out, { raw: { width: S, height: S, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, FILES.ink));
  console.log(`[print] ${FILES.ink}: ${S}×${S}, ${((100 * inked) / (S * S)).toFixed(1)}% inked`);
}

/**
 * The MISSING flyer, black ink only, no background. The same drawing as
 * scripts/store/merch-textures.mjs flyer() (1024 × 1448) with scale k applied
 * to every coordinate, stroke and font size.
 */
async function flyer() {
  const k = 2.34375;
  const W = 2400;
  const H = Math.round(1448 * k); // 3394
  const s = (v) => +(v * k).toFixed(2);
  const photo = join(ROOT, "public", "story", "01-a-cold-night", "extras", "end-frame.webp");
  const cells = 72;
  const box = s(640);
  const { data } = await sharp(photo)
    .extract({ left: 150, top: 60, width: 700, height: 700 })
    .resize(cells, cells)
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cell = box / cells;
  const px = (W - box) / 2;
  const py = s(330);
  const dots = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const dark = 1 - data[j * cells + i] / 255;
      const r = Math.sqrt(dark) * cell * 0.62;
      if (r > 0.35 * k) dots.push(`<circle cx="${(px + (i + 0.5) * cell).toFixed(1)}" cy="${(py + (j + 0.5) * cell).toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }
  const tabs = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x = s(40 + (i * (1024 - 80)) / n);
    const w = s((1024 - 80) / n);
    const tx = x + w / 2 + s(12);
    tabs.push(`<line x1="${x}" y1="${s(1250)}" x2="${x}" y2="${s(1420)}" stroke="#000" stroke-width="${s(3)}" stroke-dasharray="${s(10)} ${s(8)}"/>`);
    tabs.push(`<text x="${tx}" y="${s(1400)}" transform="rotate(-90 ${tx} ${s(1400)})" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${s(34)}">KITTY</text>`);
  }
  const lines = [0, 1, 2].map(
    (i) => `<rect x="${s(170 + (i === 2 ? 110 : 0))}" y="${s(1110 + i * 42)}" width="${s(684 - (i === 2 ? 220 : 0))}" height="${s(16)}" rx="${s(8)}"/>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g fill="#000">
    <text x="${W / 2}" y="${s(250)}" text-anchor="middle" font-family="Impact, 'Arial Black', Arial, sans-serif" font-weight="900" font-size="${s(230)}" letter-spacing="${s(4)}">MISSING</text>
    ${dots.join("")}
    <rect x="${px - s(10)}" y="${py - s(10)}" width="${box + s(20)}" height="${box + s(20)}" fill="none" stroke="#000" stroke-width="${s(8)}"/>
    <text x="${W / 2}" y="${s(1070)}" text-anchor="middle" font-family="Impact, 'Arial Black', Arial, sans-serif" font-weight="900" font-size="${s(96)}">KITTY</text>
    ${lines.join("")}
    ${tabs.join("")}
  </g>
</svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(OUT, FILES.flyer));
  console.log(`[print] ${FILES.flyer}: ${W}×${H}, ${dots.length} halftone dots`);
}

/** Read each file back and check size, alpha and the exact colour set. */
async function verify() {
  const expected = [
    { file: FILES.embroidery, width: 2000, height: 2000, colours: new Set(Object.values(THREAD)), binaryAlpha: true },
    { file: FILES.ink, width: 1500, height: 1500, colours: new Set([THREAD.black]), binaryAlpha: true },
    { file: FILES.flyer, width: 2400, height: 3394, colours: new Set([THREAD.black]), binaryAlpha: false },
  ];
  let ok = true;
  for (const e of expected) {
    const path = join(OUT, e.file);
    const meta = await sharp(path).metadata();
    const { data } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const seen = new Set();
    let partial = 0;
    let transparent = 0;
    for (let o = 0; o < data.length; o += 4) {
      const a = data[o + 3];
      if (a === 0) {
        transparent++;
        continue;
      }
      if (a !== 255) partial++;
      seen.add(rgbToHex(data[o], data[o + 1], data[o + 2]));
    }
    const problems = [];
    if (meta.width !== e.width || meta.height !== e.height) problems.push(`size ${meta.width}×${meta.height}, wanted ${e.width}×${e.height}`);
    if (!meta.hasAlpha) problems.push("no alpha channel");
    if (transparent === 0) problems.push("no transparent pixels");
    const extra = [...seen].filter((c) => !e.colours.has(c));
    const missing = [...e.colours].filter((c) => !seen.has(c));
    if (extra.length) problems.push(`off-palette colours: ${extra.slice(0, 8).join(" ")}${extra.length > 8 ? ` (+${extra.length - 8})` : ""}`);
    if (missing.length) problems.push(`palette colours never used: ${missing.join(" ")}`);
    if (e.binaryAlpha && partial) problems.push(`${partial} partially transparent pixels`);
    const label = `${e.file}  ${meta.width}×${meta.height}  colours ${[...seen].sort().join(" ")}  transparent ${((100 * transparent) / (meta.width * meta.height)).toFixed(1)}%${partial ? `  partial-alpha px ${partial}` : ""}`;
    if (problems.length) {
      ok = false;
      console.error(`  FAIL  ${label}\n        ${problems.join("; ")}`);
    } else {
      console.log(`  ok    ${label}`);
    }
  }
  return ok;
}

mkdirSync(OUT, { recursive: true });
await Promise.all([embroidery(), ink(), flyer()]);
console.log(`[print] written to ${OUT}; checking…`);
if (!(await verify())) {
  console.error("[print] FAIL: see above");
  process.exitCode = 1;
} else {
  console.log("[print] all three files pass. Commit public/print and deploy before `node scripts/printful.mjs products sync`.");
}
