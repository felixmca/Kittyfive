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

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "assets-raw", "merch", "build");
mkdirSync(OUT, { recursive: true });

/** The site's Kitty face (KittyFace.tsx), drawn at `size` px. */
function faceSvg(size, outline = "#f4f1ea") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
  <path d="M24 12C26.5 12 28 12.4 29.5 13L37 6.5C38.2 6 39 6.6 39 7.8L39.5 19C43 25 42.5 34 36.5 39C32.5 42.5 28.5 43.5 24 43.5C19.5 43.5 15.5 42.5 11.5 39C5.5 34 5 25 8.5 19L9 7.8C9 6.6 9.8 6 11 6.5L18.5 13C20 12.4 21.5 12 24 12Z" fill="#141414" stroke="${outline}" stroke-width="1.8" stroke-linejoin="round"/>
  <path d="M12.2 10.6L16.6 14.4L12.4 17.6Z" fill="#d98c96"/>
  <path d="M35.8 10.6L31.4 14.4L35.6 17.6Z" fill="#d98c96"/>
  <path d="M24 16.5C25.1 21.5 25.9 25 28.4 27.8C32 30.4 33.1 34 31.6 37C29.6 40.6 18.4 40.6 16.4 37C14.9 34 16 30.4 19.6 27.8C22.1 25 22.9 21.5 24 16.5Z" fill="#f4f1ea"/>
  <ellipse cx="16.6" cy="24" rx="3.5" ry="3.1" fill="#f2cf4a"/>
  <ellipse cx="31.4" cy="24" rx="3.5" ry="3.1" fill="#f2cf4a"/>
  <ellipse cx="16.6" cy="24" rx="1" ry="2.5" fill="#141414"/>
  <ellipse cx="31.4" cy="24" rx="1" ry="2.5" fill="#141414"/>
  <circle cx="17.6" cy="22.9" r=".75" fill="#fff"/>
  <circle cx="32.4" cy="22.9" r=".75" fill="#fff"/>
  <path d="M22.3 30.3H25.7L24 32.4Z" fill="#e59aa5"/>
  <path d="M24 32.4C23.6 34 22.2 34.6 21 34M24 32.4C24.4 34 25.8 34.6 27 34" stroke="#6b6b6b" stroke-width=".9" stroke-linecap="round" fill="none"/>
  <path d="M15.5 32.2L4.5 30.4M15.6 34.2L5 35.6M32.5 32.2L43.5 30.4M32.4 34.2L43 35.6" stroke="${outline}" stroke-width=".8" stroke-linecap="round"/>
</svg>`;
}

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
