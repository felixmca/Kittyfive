// The link preview (WhatsApp, iMessage, social): Kitty's photo, her name and
// the tagline, 1200×630. Writes src/app/opengraph-image.jpg and
// twitter-image.jpg, which Next.js turns into the og:/twitter: tags. JPEG,
// and small (≈100 KB): WhatsApp drops previews much over 300 KB.
//
//   node scripts/make-share-image.mjs [photo]
//
// The photo defaults to chapter 1's final frame (already public in
// public/story). Text is set in Georgia (the Windows stand-in for Fraunces).

import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const photo = process.argv[2] ?? join(root, "public/story/01-a-cold-night/extras/end-frame.webp");
const W = 1200;
const H = 630;
const PHOTO_W = 690;

// Kitty's face from the favicon, for the corner of the text panel.
const face = readFileSync(join(root, "src/app/icon.svg"), "utf8")
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");

const meta = await sharp(photo).metadata();
// Her face sits in the upper middle of the frame: crop to the card's photo area around it.
const cropW = Math.min(meta.width, Math.round(meta.height * (PHOTO_W / H) * 0.62));
const cropH = Math.round(cropW * (H / PHOTO_W));
const left = Math.max(0, Math.min(meta.width - cropW, Math.round(meta.width * 0.5 - cropW / 2)));
const top = Math.max(0, Math.min(meta.height - cropH, Math.round(meta.height * 0.06)));
const picture = await sharp(photo).extract({ left, top, width: cropW, height: cropH }).resize(PHOTO_W, H).toBuffer();

const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="#0b0b0c" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#0b0b0c" stop-opacity="0"/>
      <stop offset="0.66" stop-color="#0b0b0c" stop-opacity="0.85"/>
      <stop offset="0.7" stop-color="#0b0b0c" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <g transform="translate(846 150) scale(1.5)">${face}</g>
  <text x="846" y="330" font-family="Georgia, serif" font-size="104" fill="#f4f1ea" letter-spacing="-2">Kitty</text>
  <text x="850" y="386" font-family="Georgia, serif" font-style="italic" font-size="30" fill="#f4f1ea" fill-opacity="0.9">A subtle type of love.</text>
  <rect x="850" y="424" width="56" height="3" rx="1.5" fill="#ffd166"/>
  <text x="850" y="470" font-family="Segoe UI, Inter, sans-serif" font-size="22" fill="#9a958c">Her story in four chapters,</text>
  <text x="850" y="500" font-family="Segoe UI, Inter, sans-serif" font-size="22" fill="#9a958c">and a shop that buys her snacks.</text>
</svg>`;

const out = join(root, "src/app/opengraph-image.jpg");
await sharp({ create: { width: W, height: H, channels: 3, background: "#0b0b0c" } })
  .composite([
    { input: picture, left: 0, top: 0 },
    { input: Buffer.from(overlay), left: 0, top: 0 },
  ])
  .jpeg({ quality: 84, mozjpeg: true })
  .toFile(out);
copyFileSync(out, join(root, "src/app/twitter-image.jpg"));
console.log("wrote src/app/opengraph-image.jpg and twitter-image.jpg");
