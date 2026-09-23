/**
 * Pure 2D drawing for the try-on: where a product sits relative to body
 * landmarks (already in screen pixels) and how to paint it, either from the
 * product's flat mockup image or, when that image is missing (they do not
 * exist yet), as a procedural vector garment in the variant colour.
 *
 * Shared by Overlay.tsx (live camera) and MockupFallback.tsx (no camera).
 * Nothing here holds React state; the only module state is an image cache
 * and one reusable scratch canvas.
 */
import type { Product, ProductId } from "@/config/products";
import type { Pt, ScreenPose } from "./landmarks";

export interface Placement {
  /** Centre of the product box, CSS px. */
  cx: number;
  cy: number;
  /** Box size, CSS px. */
  w: number;
  h: number;
  /** Rotation, radians, clockwise on screen. */
  angle: number;
  /** False when nothing was tracked and the box is pinned to the screen centre. */
  anchored: boolean;
}

export interface DrawOptions {
  /** True when the preview is a mirror (front camera): moves the chest patch to the wearer's left. */
  mirrored: boolean;
  dpr: number;
  alpha?: number;
}

export const CREAM = "#f4f1ea";
export const INK = "#0b0b0c";

/** Landmarks below this visibility are treated as not seen. */
const VISIBLE = 0.35;
/** Head/shoulder tilt is clamped so a glitchy frame never spins the merch. */
const MAX_TILT = 0.6;

/** Box aspect (h / w) of the procedural art, per product. Images use their own. */
export const PROCEDURAL_ASPECT: Record<ProductId, number> = {
  cap: 0.62,
  hoodie: 1.22,
  longsleeve: 1.18,
};

// ---------------------------------------------------------------- geometry

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const seen = (p: Pt) => p.v > VISIBLE;

/** Angle of the line a→b, normalised so it always points screen-right, clamped. */
function lineAngle(a: Pt, b: Pt): number {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx < 0) {
    dx = -dx;
    dy = -dy;
  }
  return clamp(Math.atan2(dy, dx), -MAX_TILT, MAX_TILT);
}

/** Screen-space "up" for a given tilt (y grows downwards on canvas). */
const upVec = (angle: number) => ({ x: Math.sin(angle), y: -Math.cos(angle) });

export function placeProduct(
  product: Product,
  pose: ScreenPose | null,
  vw: number,
  vh: number,
  aspect: number,
): Placement {
  return product.anchor === "head"
    ? placeCap(pose, vw, vh, aspect)
    : placeGarment(pose, vw, vh, aspect);
}

/**
 * Cap: width 1.9 × ear-to-ear, centred above the eyes, rotated by the ear line.
 * Falls back to eyes (× 2.4 ≈ head width), then shoulders, then the screen centre.
 */
function placeCap(pose: ScreenPose | null, vw: number, vh: number, aspect: number): Placement {
  if (pose) {
    const earsOk = seen(pose.leftEar) && seen(pose.rightEar);
    const eyesOk = seen(pose.leftEye) && seen(pose.rightEye);
    const shouldersOk = seen(pose.leftShoulder) && seen(pose.rightShoulder);
    let earDist = 0;
    let angle = 0;
    let ref: { x: number; y: number } | null = null;

    if (earsOk || eyesOk) {
      earDist = earsOk
        ? dist(pose.leftEar, pose.rightEar)
        : dist(pose.leftEye, pose.rightEye) * 2.4;
      angle = earsOk
        ? lineAngle(pose.leftEar, pose.rightEar)
        : lineAngle(pose.leftEye, pose.rightEye);
      ref = eyesOk ? mid(pose.leftEye, pose.rightEye) : mid(pose.leftEar, pose.rightEar);
    } else if (shouldersOk) {
      const sw = dist(pose.leftShoulder, pose.rightShoulder);
      angle = lineAngle(pose.leftShoulder, pose.rightShoulder);
      earDist = sw * 0.42;
      const up = upVec(angle);
      const sm = mid(pose.leftShoulder, pose.rightShoulder);
      ref = { x: sm.x + up.x * sw * 0.55, y: sm.y + up.y * sw * 0.55 };
    }

    if (ref && earDist > 4) {
      const w = 1.9 * earDist;
      const h = w * aspect;
      const up = upVec(angle);
      // Box bottom sits a little above the eye line; the art inside the box
      // leaves a margin so the brim lands around the eyebrows.
      const lift = 0.12 * earDist + h / 2;
      return { cx: ref.x + up.x * lift, cy: ref.y + up.y * lift, w, h, angle, anchored: true };
    }
  }
  const w = Math.min(vw, vh) * 0.52;
  return { cx: vw / 2, cy: vh * 0.3, w, h: w * aspect, angle: 0, anchored: false };
}

/**
 * Hoodie / long-sleeve: width 1.6 × shoulder width, top edge 12% of the
 * shoulder width above the shoulders' midpoint, rotated by the shoulder line.
 */
function placeGarment(pose: ScreenPose | null, vw: number, vh: number, aspect: number): Placement {
  if (pose && seen(pose.leftShoulder) && seen(pose.rightShoulder)) {
    const sw = dist(pose.leftShoulder, pose.rightShoulder);
    if (sw > 6) {
      const angle = lineAngle(pose.leftShoulder, pose.rightShoulder);
      const sm = mid(pose.leftShoulder, pose.rightShoulder);
      const up = upVec(angle);
      const w = 1.6 * sw;
      const h = w * aspect;
      const topX = sm.x + up.x * sw * 0.12;
      const topY = sm.y + up.y * sw * 0.12;
      return {
        cx: topX - up.x * (h / 2),
        cy: topY - up.y * (h / 2),
        w,
        h,
        angle,
        anchored: true,
      };
    }
  }
  const w = Math.min(vw * 0.78, vh * 0.5);
  const h = w * aspect;
  return { cx: vw / 2, cy: vh * 0.34 + h / 2, w, h, angle: 0, anchored: false };
}

// ------------------------------------------------------------- image cache

interface ImageEntry {
  img: HTMLImageElement | null;
  done: boolean;
  waiters: Array<(img: HTMLImageElement | null) => void>;
}

const imageCache = new Map<string, ImageEntry>();

function entryFor(src: string): ImageEntry {
  const existing = imageCache.get(src);
  if (existing) return existing;
  const entry: ImageEntry = { img: null, done: false, waiters: [] };
  imageCache.set(src, entry);
  if (typeof window === "undefined" || !src) {
    entry.done = true;
    return entry;
  }
  try {
    const img = new Image();
    img.decoding = "async";
    const finish = (loaded: boolean) => {
      entry.img = loaded ? img : null;
      entry.done = true;
      const waiters = entry.waiters;
      entry.waiters = [];
      for (const w of waiters) w(entry.img);
    };
    img.onload = () => finish(img.naturalWidth > 0 && img.naturalHeight > 0);
    img.onerror = () => finish(false);
    img.src = src;
  } catch {
    entry.done = true;
  }
  return entry;
}

/** The loaded image, or null while loading / when missing. Starts the load. */
export function peekImage(src: string): HTMLImageElement | null {
  const e = entryFor(src);
  return e.done ? e.img : null;
}

/** Resolves with the image, or null when it 404s or cannot decode. Never rejects. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  const e = entryFor(src);
  if (e.done) return Promise.resolve(e.img);
  return new Promise((resolve) => e.waiters.push(resolve));
}

// ------------------------------------------------------------------ colour

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(n)) return [17, 17, 17];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a hex colour towards white (amt > 0) or black (amt < 0). */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amt < 0 ? 0 : 255;
  const k = Math.min(1, Math.abs(amt));
  const m = (c: number) => Math.round(c + (target - c) * k);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

export function isLight(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

// ------------------------------------------------------------ scratch pad

let scratch: HTMLCanvasElement | null = null;

/** A reusable offscreen canvas so the garment gets ONE shadow and ONE alpha. */
function getScratch(pw: number, ph: number): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== pw || scratch.height !== ph) {
    scratch.width = pw;
    scratch.height = ph;
  }
  const ctx = scratch.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  return ctx;
}

function roundedRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
}

// --------------------------------------------------------------- painting

/**
 * Draw `product` into `place` on `ctx`. Uses `img` when given, otherwise the
 * procedural garment. Slight drop shadow, 92% opacity by default.
 */
export function drawProduct(
  ctx: CanvasRenderingContext2D,
  product: Product,
  colour: string,
  place: Placement,
  img: HTMLImageElement | null,
  opts: DrawOptions,
): void {
  const { cx, cy, w, h, angle } = place;
  if (!(w > 2) || !(h > 2) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.globalAlpha = opts.alpha ?? 0.92;
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = Math.max(6, w * 0.05);
  ctx.shadowOffsetY = Math.max(3, w * 0.02);

  if (img) {
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return;
  }

  const dpr = clamp(opts.dpr || 1, 1, 3);
  const pw = Math.max(1, Math.min(2048, Math.round(w * dpr)));
  const ph = Math.max(1, Math.min(2048, Math.round(h * dpr)));
  const sctx = getScratch(pw, ph);
  if (!sctx) {
    ctx.restore();
    return;
  }
  sctx.scale(pw / w, ph / h);
  sctx.translate(w / 2, h / 2);
  if (product.anchor === "head") paintCap(sctx, w, h, colour);
  else paintGarment(sctx, w, h, colour, product.id === "hoodie", opts.mirrored);
  ctx.drawImage(sctx.canvas, 0, 0, pw, ph, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Six-panel cap, front view, in a w × h box centred on the origin. */
function paintCap(c: CanvasRenderingContext2D, w: number, h: number, colour: string) {
  const crownTop = -0.34 * h;
  const crownBase = 0.16 * h;
  const half = 0.33 * w;
  const light = isLight(colour);

  // crown
  const g = c.createLinearGradient(0, crownTop, 0, crownBase);
  g.addColorStop(0, shade(colour, 0.14));
  g.addColorStop(1, shade(colour, -0.2));
  c.beginPath();
  c.moveTo(-half, crownBase);
  c.bezierCurveTo(-half, -0.5 * h, half, -0.5 * h, half, crownBase);
  c.quadraticCurveTo(0, crownBase + 0.07 * h, -half, crownBase);
  c.closePath();
  c.fillStyle = g;
  c.fill();

  // panel seams
  c.save();
  c.globalAlpha = 0.55;
  c.strokeStyle = shade(colour, light ? -0.18 : 0.16);
  c.lineWidth = Math.max(1, w * 0.006);
  c.beginPath();
  c.moveTo(0, -0.33 * h);
  c.lineTo(0, crownBase + 0.02 * h);
  c.moveTo(0, -0.33 * h);
  c.quadraticCurveTo(-0.22 * w, -0.15 * h, -0.27 * w, crownBase);
  c.moveTo(0, -0.33 * h);
  c.quadraticCurveTo(0.22 * w, -0.15 * h, 0.27 * w, crownBase);
  c.stroke();
  c.restore();

  // brim: a crescent under the crown's front edge
  c.beginPath();
  c.moveTo(-0.37 * w, crownBase - 0.02 * h);
  c.quadraticCurveTo(0, crownBase + 0.1 * h, 0.37 * w, crownBase - 0.02 * h);
  c.quadraticCurveTo(0, crownBase + 0.34 * h, -0.37 * w, crownBase - 0.02 * h);
  c.closePath();
  const bg = c.createLinearGradient(0, crownBase, 0, crownBase + 0.3 * h);
  bg.addColorStop(0, shade(colour, -0.05));
  bg.addColorStop(1, shade(colour, -0.3));
  c.fillStyle = bg;
  c.fill();

  // top button
  c.beginPath();
  c.arc(0, -0.32 * h, w * 0.018, 0, Math.PI * 2);
  c.fillStyle = shade(colour, -0.12);
  c.fill();

  // cream "K" badge
  const br = 0.075 * w;
  const by = -0.04 * h;
  c.beginPath();
  c.arc(0, by, br, 0, Math.PI * 2);
  c.fillStyle = CREAM;
  c.fill();
  c.lineWidth = Math.max(1, w * 0.006);
  c.strokeStyle = "rgba(11, 11, 12, 0.35)";
  c.stroke();
  c.fillStyle = INK;
  c.font = `600 ${Math.max(6, Math.round(br * 1.35))}px Fraunces, "Iowan Old Style", Georgia, serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText("K", 0, by + br * 0.06);
}

/**
 * Hoodie or long-sleeve silhouette (body + sleeves + hood/collar) in a w × h
 * box centred on the origin. Without `sleeves`, the body alone (the fitted
 * try-on draws sleeves of its own along the arms).
 */
export function paintGarment(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  colour: string,
  hoodie: boolean,
  mirrored: boolean,
  sleeves = true,
) {
  const top = -0.5 * h;
  const shoulderY = top + 0.1 * h;
  const hem = 0.47 * h;
  const bodyHalf = 0.3 * w;
  const light = isLight(colour);
  const contrast = light ? INK : CREAM;

  // hood, behind everything
  if (hoodie) {
    c.beginPath();
    c.moveTo(-0.22 * w, shoulderY + 0.02 * h);
    c.bezierCurveTo(-0.22 * w, top - 0.03 * h, 0.22 * w, top - 0.03 * h, 0.22 * w, shoulderY + 0.02 * h);
    c.closePath();
    c.fillStyle = shade(colour, -0.06);
    c.fill();
  }

  // sleeves: thick round-capped strokes from shoulder to cuff
  if (sleeves) paintSleeves(c, w, h, colour, shoulderY);

  // body
  const g = c.createLinearGradient(0, shoulderY, 0, hem);
  g.addColorStop(0, shade(colour, 0.12));
  g.addColorStop(1, shade(colour, -0.16));
  c.beginPath();
  roundedRect(c, -bodyHalf, shoulderY, bodyHalf * 2, hem - shoulderY, 0.08 * w);
  c.fillStyle = g;
  c.fill();
  // hem band
  c.beginPath();
  roundedRect(c, -bodyHalf, hem - 0.035 * h, bodyHalf * 2, 0.035 * h, 0.02 * w);
  c.fillStyle = shade(colour, -0.22);
  c.fill();

  if (hoodie) {
    // kangaroo pocket
    c.beginPath();
    roundedRect(c, -0.2 * w, hem - 0.24 * h, 0.4 * w, 0.17 * h, 0.03 * w);
    c.fillStyle = shade(colour, -0.09);
    c.fill();
    // hood opening
    c.beginPath();
    c.ellipse(0, shoulderY + 0.015 * h, 0.14 * w, 0.055 * h, 0, 0, Math.PI * 2);
    c.fillStyle = shade(colour, -0.4);
    c.fill();
    // hood rim
    c.beginPath();
    c.moveTo(-0.16 * w, shoulderY + 0.04 * h);
    c.quadraticCurveTo(0, shoulderY + 0.14 * h, 0.16 * w, shoulderY + 0.04 * h);
    c.lineWidth = 0.03 * w;
    c.strokeStyle = shade(colour, 0.06);
    c.stroke();
    // drawstrings
    c.save();
    c.globalAlpha = 0.85;
    c.lineWidth = Math.max(1, 0.008 * w);
    c.strokeStyle = contrast;
    c.beginPath();
    c.moveTo(-0.05 * w, shoulderY + 0.12 * h);
    c.lineTo(-0.06 * w, shoulderY + 0.3 * h);
    c.moveTo(0.05 * w, shoulderY + 0.12 * h);
    c.lineTo(0.065 * w, shoulderY + 0.31 * h);
    c.stroke();
    c.restore();
  } else {
    // crew neck with a ribbed band
    c.beginPath();
    c.ellipse(0, shoulderY + 0.01 * h, 0.12 * w, 0.042 * h, 0, 0, Math.PI * 2);
    c.fillStyle = shade(colour, -0.35);
    c.fill();
    c.lineWidth = 0.02 * w;
    c.strokeStyle = shade(colour, -0.12);
    c.stroke();
  }

  // chest patch on the wearer's left (screen-left in a mirror)
  const side = mirrored ? -1 : 1;
  paintKittyPatch(c, side * 0.13 * w, shoulderY + 0.2 * h, 0.085 * w, light);
  if (!hoodie && sleeves) {
    // the long-sleeve also carries a small Kitty on the sleeve
    paintKittyPatch(c, side * 0.35 * w, shoulderY + 0.36 * h, 0.05 * w, light);
  }
}

function paintSleeves(c: CanvasRenderingContext2D, w: number, h: number, colour: string, shoulderY: number) {
  c.lineCap = "round";
  c.lineJoin = "round";
  c.lineWidth = 0.17 * w;
  c.strokeStyle = shade(colour, -0.04);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * 0.25 * w, shoulderY + 0.04 * h);
    c.lineTo(s * 0.4 * w, shoulderY + 0.6 * h);
    c.stroke();
  }
  // cuffs
  c.lineWidth = 0.19 * w;
  c.strokeStyle = shade(colour, -0.14);
  for (const s of [-1, 1]) {
    c.beginPath();
    c.moveTo(s * 0.392 * w, shoulderY + 0.575 * h);
    c.lineTo(s * 0.4 * w, shoulderY + 0.6 * h);
    c.stroke();
  }
}

/** A tiny woven patch: contrast square with a cat-face silhouette. */
export function paintKittyPatch(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  onLight: boolean,
) {
  const bg = onLight ? INK : CREAM;
  const fg = onLight ? CREAM : INK;
  const r = size / 2;
  c.beginPath();
  roundedRect(c, x - r, y - r, size, size, size * 0.22);
  c.fillStyle = bg;
  c.fill();

  const fr = size * 0.27;
  const fy = y + size * 0.06;
  c.fillStyle = fg;
  c.beginPath();
  c.arc(x, fy, fr, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x - fr * 0.95, fy - fr * 0.2);
  c.lineTo(x - fr * 0.85, fy - fr * 1.55);
  c.lineTo(x - fr * 0.1, fy - fr * 0.85);
  c.closePath();
  c.moveTo(x + fr * 0.95, fy - fr * 0.2);
  c.lineTo(x + fr * 0.85, fy - fr * 1.55);
  c.lineTo(x + fr * 0.1, fy - fr * 0.85);
  c.closePath();
  c.fill();
  // white blaze + eyes so it reads as Kitty, not a generic cat
  c.fillStyle = bg;
  c.beginPath();
  c.ellipse(x, fy + fr * 0.35, fr * 0.22, fr * 0.42, 0, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.arc(x - fr * 0.4, fy - fr * 0.1, fr * 0.11, 0, Math.PI * 2);
  c.arc(x + fr * 0.4, fy - fr * 0.1, fr * 0.11, 0, Math.PI * 2);
  c.fill();
}
