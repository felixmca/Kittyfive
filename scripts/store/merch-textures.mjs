// Textures for the merch models (scripts/store/merch.py): Kitty's face as an
// embroidered patch, and the MISSING flyer as a one-colour screen print.
//
//   node scripts/store/merch-textures.mjs
//
// Both come from things already public: the face is the site's own mark
// (src/components/chrome/KittyFace.tsx), the flyer's photo is chapter 1's
// close-up of her (public/story/01-a-cold-night/extras/end-frame.webp).
// When Felix's real flyer arrives (assets-raw/ui/flyer/), the print should
// be made from that instead.
//
// Writes assets-raw/merch/build/*.png (not committed; the GLBs carry them).

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { faceSvg } from "./kitty-face-svg.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "assets-raw", "merch", "build");
mkdirSync(OUT, { recursive: true });

/**
 * Embroidery: the face, with satin-stitch sheen (fine diagonal threads that
 * catch the light) and a soft shadow round the raised thread.
 */
async function embroidery() {
  const S = 512;
  const { data, info } = await sharp(Buffer.from(faceSvg(S))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      if (out[o + 3] < 8) continue;
      // Threads at 45°, about 6 px apart; a highlight along each.
      const t = ((x + y) % 7) / 7;
      const k = 0.9 + 0.18 * Math.sin(t * Math.PI);
      for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, out[o + c] * k));
    }
  }
  const shadow = await sharp(Buffer.from(faceSvg(S, "#000000")))
    .ensureAlpha()
    .extractChannel(3)
    .blur(5)
    .linear(0.55, 0)
    .toBuffer();
  const shade = await sharp({ create: { width: S, height: S, channels: 3, background: "#000000" } }).joinChannel(shadow).png().toBuffer();
  const stitched = await sharp(out, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer();
  await sharp(shade)
    .composite([{ input: stitched, top: -3, left: -2 }])
    .png()
    .toFile(join(OUT, "embroidery-face.png"));
  void info;
}

/**
 * The MISSING flyer as a screen print: black ink only (the shirt shows
 * through), the photo as a halftone of dots, tear-off tabs along the bottom.
 * 1024 × 1448 px (A-series proportions).
 */
async function flyer() {
  const W = 1024;
  const H = 1448;
  // Halftone from chapter 1's close-up of her face.
  const photo = join(root, "public", "story", "01-a-cold-night", "extras", "end-frame.webp");
  const cells = 72;
  const box = 640;
  const { data } = await sharp(photo)
    .extract({ left: 150, top: 60, width: 700, height: 700 })
    .resize(cells, cells)
    .greyscale()
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cell = box / cells;
  const px = (W - box) / 2;
  const py = 330;
  const dots = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const dark = 1 - data[j * cells + i] / 255;
      const r = Math.sqrt(dark) * cell * 0.62;
      if (r > 0.35) dots.push(`<circle cx="${(px + (i + 0.5) * cell).toFixed(1)}" cy="${(py + (j + 0.5) * cell).toFixed(1)}" r="${r.toFixed(2)}"/>`);
    }
  }
  const tabs = [];
  const n = 8;
  for (let i = 0; i < n; i++) {
    const x = 40 + (i * (W - 80)) / n;
    const w = (W - 80) / n;
    tabs.push(`<line x1="${x}" y1="1250" x2="${x}" y2="1420" stroke="#000" stroke-width="3" stroke-dasharray="10 8"/>`);
    tabs.push(`<text x="${x + w / 2 + 12}" y="1400" transform="rotate(-90 ${x + w / 2 + 12} 1400)" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="34">KITTY</text>`);
  }
  const lines = [0, 1, 2].map((i) => `<rect x="${170 + (i === 2 ? 110 : 0)}" y="${1110 + i * 42}" width="${684 - (i === 2 ? 220 : 0)}" height="16" rx="8"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <g fill="#000">
    <text x="${W / 2}" y="250" text-anchor="middle" font-family="Impact, 'Arial Black', Arial, sans-serif" font-weight="900" font-size="230" letter-spacing="4">MISSING</text>
    ${dots.join("")}
    <rect x="${px - 10}" y="${py - 10}" width="${box + 20}" height="${box + 20}" fill="none" stroke="#000" stroke-width="8"/>
    <text x="${W / 2}" y="1070" text-anchor="middle" font-family="Impact, 'Arial Black', Arial, sans-serif" font-weight="900" font-size="96">KITTY</text>
    ${lines.join("")}
    ${tabs.join("")}
  </g>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(OUT, "flyer-print.png"));
}

await Promise.all([embroidery(), flyer()]);
console.log(`[merch] textures in ${OUT}`);
