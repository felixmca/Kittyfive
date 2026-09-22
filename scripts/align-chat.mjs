// Where does the WhatsApp chat's photo sit inside chapter 1's final frame?
//
//   node scripts/align-chat.mjs                       # the defaults below
//   node scripts/align-chat.mjs public/story/01-a-cold-night/0072.webp
//
// The landing's chat flight (src/components/landing/SwipeStory) lands the
// chat so that its photo covers the frame exactly, then hands over to the
// canvas. Clip 1's final frame is a 9:16 crop of that photo, so this searches
// for the scale and offset that line the two up (grey levels, mean absolute
// difference) and prints the rect to paste into WHATSAPP.landsOn in
// src/config/story.ts. Re-run it whenever clip 1 or the screenshot changes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chatPath = join(root, "public/story/whatsapp-chat.webp");
const { photo: P } = JSON.parse(readFileSync(join(root, "public/story/whatsapp-chat.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(root, "public/story/01-a-cold-night/manifest.json"), "utf8"));
const framePath = process.argv[2] ?? join(root, "public/story/01-a-cold-night", `${String(manifest.frames).padStart(4, "0")}.webp`);
const FW = manifest.width;
const FH = manifest.height;

const D = 4; // compare at a quarter of the frame's resolution
const M = 40; // margin sampled around the photo
const S = 2; // the photo is sampled at half resolution

async function gray(path, extract, w, h) {
  let s = sharp(path);
  if (extract) s = s.extract(extract);
  const { data, info } = await s.resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

const F = await gray(framePath, null, FW / D, FH / D);
const ext = { left: P.x - M, top: P.y - M, width: P.w + 2 * M, height: P.h + 2 * M };
const C = await gray(chatPath, ext, Math.round(ext.width / S), Math.round(ext.height / S));

function sample(u, v) {
  const x = (u + M) / S;
  const y = (v + M) / S;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= C.w || y0 + 1 >= C.h) return -1;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * C.w + x0;
  return (C.data[i] * (1 - fx) + C.data[i + 1] * fx) * (1 - fy) + (C.data[i + C.w] * (1 - fx) + C.data[i + C.w + 1] * fx) * fy;
}

/** Mean absolute difference if the photo is drawn at rect (x, y, w, h) in frame pixels. */
function error(rx, ry, rw, rh) {
  let sum = 0;
  let n = 0;
  for (let j = 0; j < F.h; j += 2) {
    for (let i = 0; i < F.w; i += 2) {
      const s = sample((((i + 0.5) * D - rx) / rw) * P.w, (((j + 0.5) * D - ry) / rh) * P.h);
      if (s < 0) continue;
      sum += Math.abs(s - F.data[j * F.w + i]);
      n++;
    }
  }
  return n > (F.w * F.h) / 8 ? sum / n : Infinity;
}

let best = { e: Infinity };
for (let rh = FH * 0.9; rh <= FH * 1.2; rh += 8) {
  const rw = (rh * P.w) / P.h;
  for (let ry = -80; ry <= 80; ry += 6) {
    for (let rx = FW - rw - 60; rx <= 60; rx += 6) {
      const e = error(rx, ry, rw, rh);
      if (e < best.e) best = { e, rx, ry, rw, rh };
    }
  }
}
for (const step of [2, 0.5]) {
  const b = best;
  for (let rh = b.rh - 8; rh <= b.rh + 8; rh += step) {
    const rw = (rh * P.w) / P.h;
    for (let ry = b.ry - 6; ry <= b.ry + 6; ry += step) {
      for (let rx = b.rx - 6; rx <= b.rx + 6; rx += step) {
        const e = error(rx, ry, rw, rh);
        if (e < best.e) best = { e, rx, ry, rw, rh };
      }
    }
  }
}

const r = (v) => Math.round(v * 10) / 10;
console.log(`frame: ${framePath}`);
console.log(`mean difference ${best.e.toFixed(2)} of 255 (below ~10 is a clean match)`);
console.log(`landsOn: { x: ${r(best.rx)}, y: ${r(best.ry)}, w: ${r(best.rw)}, h: ${r(best.rh)} },`);
