/**
 * The hoodie and the long-sleeve fitted to the body (Phase 4, behind
 * /try-on?fit=1 until it has been tried on real people).
 *
 * The flat garment (drawMerch's painter, sleeves left off) is a texture that
 * is warped onto the person every frame:
 *
 *   body     a grid between the shoulders and the hem, so it tilts, narrows
 *            to the hips and leans with the torso (hips estimated from the
 *            shoulders when they are out of frame, as in most selfies)
 *   sleeves  two strips along each arm, shoulder → elbow → wrist, bending at
 *            the elbow; hanging down when the arms are not seen. A forearm in
 *            front of the body is drawn over it
 *   light    the camera's own picture, in grey and normalised to its average,
 *            multiplied through the garment, so folds, shadows and the room's
 *            light show on it
 *   shape    trimmed to the person's silhouette (body segmentation) when the
 *            silhouette plausibly covers the body
 *
 * Every warp is piecewise affine: each grid cell is two triangles, each drawn
 * with a clip and a transform. Nothing here allocates per frame beyond a few
 * small objects.
 */
import type { Product, ProductId } from "@/config/products";
import { PROCEDURAL_ASPECT, isLight, paintGarment, paintKittyPatch, shade } from "./drawMerch";
import type { Pt, ScreenPose } from "./landmarks";

interface V {
  x: number;
  y: number;
}

const TEX_W = 480;
/** The body's box inside the texture (see paintGarment): x 20–80 %, y 0–97 %. */
const BODY_U0 = 0.2;
const BODY_U1 = 0.8;
const BODY_V1 = 0.97;
/** Where the shoulder line is, as a fraction of the body box's height. */
const SHOULDER_V = 0.1 / BODY_V1;
const SLEEVE_W = 96;
const SLEEVE_H = 384;
const COLS = 3;
const ROWS = 5;
const SLEEVE_ROWS = 3;

export interface FitOptions {
  cw: number;
  ch: number;
  dpr: number;
  mirrored: boolean;
  video: HTMLVideoElement | null;
  /** The person's silhouette in video space (alpha), or null. */
  mask: HTMLCanvasElement | null;
}

const seen = (p?: Pt): p is Pt => !!p && p.v > 0.5;
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: V, k: number): V => ({ x: a.x * k, y: a.y * k });
const len = (a: V) => Math.hypot(a.x, a.y);
const norm = (a: V): V => {
  const l = len(a) || 1;
  return { x: a.x / l, y: a.y / l };
};
const lerpV = (a: V, b: V, t: number): V => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Where the garment goes this frame, in container pixels. */
interface Fit {
  /** Body corners: screen-left/right at the shoulder line and at the hem. */
  topL: V;
  topR: V;
  hemL: V;
  hemR: V;
  /** Sleeves, screen-left first: root, elbow, wrist and half-widths there. */
  sleeves: { root: V; elbow: V; wrist: V; wide: [number, number, number]; front: boolean; left: boolean }[];
  /** Middle of the body, for the silhouette check. */
  centre: V;
}

function fitTo(pose: ScreenPose): Fit | null {
  const ls = pose.leftShoulder;
  const rs = pose.rightShoulder;
  if (!seen(ls) || !seen(rs)) return null;
  // Screen-left and screen-right, whichever of the person's sides they are.
  const personLeftOnScreenLeft = ls.x <= rs.x;
  const A = personLeftOnScreenLeft ? ls : rs;
  const B = personLeftOnScreenLeft ? rs : ls;
  const sw = len(sub(B, A));
  if (sw < 12) return null;
  const across = norm(sub(B, A));
  const down: V = { x: -across.y, y: across.x };
  const mid = lerpV(A, B, 0.5);

  const lh = pose.leftHip;
  const rh = pose.rightHip;
  let hipA: V;
  let hipB: V;
  if (seen(lh) && seen(rh)) {
    hipA = personLeftOnScreenLeft ? lh : rh;
    hipB = personLeftOnScreenLeft ? rh : lh;
  } else {
    // Out of frame (a selfie): where hips usually are for these shoulders.
    const hm = add(mid, mul(down, sw * 1.5));
    hipA = add(hm, mul(across, -sw * 0.36));
    hipB = add(hm, mul(across, sw * 0.36));
  }
  const hipMid = lerpV(hipA, hipB, 0.5);
  const hemMid = lerpV(mid, hipMid, 1.12);
  const hipW = len(sub(hipB, hipA));
  const hemAcross = hipW > 4 ? norm(sub(hipB, hipA)) : across;
  const hemHalf = Math.max(hipW * 0.85, sw * 0.5);

  // The tracker's shoulders are the joints: the garment's shoulder line is
  // above and outside them (tried on a real person, 23 Sep 2026).
  const topL = add(add(A, mul(across, -sw * 0.16)), mul(down, -sw * 0.2));
  const topR = add(add(B, mul(across, sw * 0.16)), mul(down, -sw * 0.2));
  const hemL = add(hemMid, mul(hemAcross, -hemHalf));
  const hemR = add(hemMid, mul(hemAcross, hemHalf));

  const sleeves: Fit["sleeves"] = [];
  for (const screenLeft of [true, false]) {
    const shoulder = screenLeft ? A : B;
    const personLeft = screenLeft === personLeftOnScreenLeft;
    const elbowPt = personLeft ? pose.leftElbow : pose.rightElbow;
    const wristPt = personLeft ? pose.leftWrist : pose.rightWrist;
    const out = mul(across, screenLeft ? -1 : 1);
    const root = add(add(shoulder, mul(out, sw * 0.06)), mul(down, -sw * 0.04));
    const elbow: V = seen(elbowPt) ? elbowPt : add(root, mul(norm(add(down, mul(out, 0.22))), sw * 0.85));
    const upper = norm(sub(elbow, root));
    const wrist: V = seen(wristPt) ? wristPt : add(elbow, mul(seen(elbowPt) ? upper : norm(add(down, mul(out, 0.1))), sw * 0.78));
    // A hand in front of the body: its forearm is drawn over the body.
    const rel = sub(wrist, mid);
    const alongAcross = (rel.x * across.x + rel.y * across.y) / sw;
    const alongDown = (rel.x * down.x + rel.y * down.y) / Math.max(1, len(sub(hemMid, mid)));
    const front = seen(wristPt) && Math.abs(alongAcross) < 0.5 && alongDown > 0.05 && alongDown < 1;
    sleeves.push({ root, elbow, wrist, wide: [sw * 0.2, sw * 0.15, sw * 0.125], front, left: personLeft });
  }
  return { topL, topR, hemL, hemR, sleeves, centre: lerpV(mid, hemMid, 0.45) };
}

// ─── textures ────────────────────────────────────────────────────────────────

interface Textures {
  body: HTMLCanvasElement;
  sleeve: HTMLCanvasElement;
  /** The sleeve on the wearer's left carries the long-sleeve's patch. */
  sleevePatched: HTMLCanvasElement;
}

let texKey = "";
let tex: Textures | null = null;

function textures(id: ProductId, colour: string, mirrored: boolean): Textures {
  const key = `${id}|${colour}|${mirrored}`;
  if (tex && key === texKey) return tex;
  const hoodie = id === "hoodie";
  const aspect = PROCEDURAL_ASPECT[id] ?? 1.2;
  const body = document.createElement("canvas");
  body.width = TEX_W;
  body.height = Math.round(TEX_W * aspect);
  const b = body.getContext("2d")!;
  b.translate(body.width / 2, body.height / 2);
  paintGarment(b, body.width, body.height, colour, hoodie, mirrored, false);

  const sleeveOf = (patched: boolean) => {
    const c = document.createElement("canvas");
    c.width = SLEEVE_W;
    c.height = SLEEVE_H;
    const s = c.getContext("2d")!;
    // Rounded across, like an arm in a sleeve: darker at both edges.
    const g = s.createLinearGradient(0, 0, SLEEVE_W, 0);
    g.addColorStop(0, shade(colour, -0.2));
    g.addColorStop(0.45, shade(colour, 0.06));
    g.addColorStop(1, shade(colour, -0.2));
    s.fillStyle = g;
    s.beginPath();
    if (typeof s.roundRect === "function") s.roundRect(0, 0, SLEEVE_W, SLEEVE_H, [SLEEVE_W / 2, SLEEVE_W / 2, 10, 10]);
    else s.rect(0, 0, SLEEVE_W, SLEEVE_H); // Safari before 16
    s.fill();
    // Ribbed cuff.
    s.fillStyle = shade(colour, -0.16);
    s.fillRect(0, SLEEVE_H * 0.9, SLEEVE_W, SLEEVE_H * 0.1);
    s.strokeStyle = shade(colour, -0.26);
    s.lineWidth = 2;
    for (let x = 6; x < SLEEVE_W; x += 8) {
      s.beginPath();
      s.moveTo(x, SLEEVE_H * 0.905);
      s.lineTo(x, SLEEVE_H * 0.995);
      s.stroke();
    }
    if (patched) paintKittyPatch(s, SLEEVE_W / 2, SLEEVE_H * 0.3, SLEEVE_W * 0.42, isLight(colour));
    return c;
  };
  const plain = sleeveOf(false);
  tex = { body, sleeve: plain, sleevePatched: hoodie ? plain : sleeveOf(true) };
  texKey = key;
  return tex;
}

// ─── warping ─────────────────────────────────────────────────────────────────

/** Draw the triangle s0 s1 s2 of `img` onto d0 d1 d2 (container px). */
function tri(c: CanvasRenderingContext2D, img: HTMLCanvasElement, s0: V, s1: V, s2: V, d0: V, d1: V, d2: V) {
  const u1x = s1.x - s0.x;
  const u1y = s1.y - s0.y;
  const u2x = s2.x - s0.x;
  const u2y = s2.y - s0.y;
  const det = u1x * u2y - u2x * u1y;
  if (Math.abs(det) < 1e-6) return;
  const D1x = d1.x - d0.x;
  const D1y = d1.y - d0.y;
  const D2x = d2.x - d0.x;
  const D2y = d2.y - d0.y;
  const a = (D1x * u2y - D2x * u1y) / det;
  const b = (D1y * u2y - D2y * u1y) / det;
  const cc = (u1x * D2x - u2x * D1x) / det;
  const d = (u1x * D2y - u2x * D1y) / det;
  const e = d0.x - a * s0.x - cc * s0.y;
  const f = d0.y - b * s0.x - d * s0.y;
  // Grow the clip by ~0.7 px so neighbouring triangles leave no hairline seams.
  const cx = (d0.x + d1.x + d2.x) / 3;
  const cy = (d0.y + d1.y + d2.y) / 3;
  const grow = (p: V): V => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const l = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / l) * 0.7, y: p.y + (dy / l) * 0.7 };
  };
  const g0 = grow(d0);
  const g1 = grow(d1);
  const g2 = grow(d2);
  c.save();
  c.beginPath();
  c.moveTo(g0.x, g0.y);
  c.lineTo(g1.x, g1.y);
  c.lineTo(g2.x, g2.y);
  c.closePath();
  c.clip();
  c.transform(a, b, cc, d, e, f);
  const x0 = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x) - 2));
  const y0 = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y) - 2));
  const x1 = Math.min(img.width, Math.ceil(Math.max(s0.x, s1.x, s2.x) + 2));
  const y1 = Math.min(img.height, Math.ceil(Math.max(s0.y, s1.y, s2.y) + 2));
  if (x1 > x0 && y1 > y0) c.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  c.restore();
}

/** Warp a grid: `src(i, j)` and `dst(i, j)` give the texture and screen point of grid vertex (i across, j down). */
function grid(
  c: CanvasRenderingContext2D,
  img: HTMLCanvasElement,
  cols: number,
  rows: number,
  src: (i: number, j: number) => V,
  dst: (i: number, j: number) => V,
) {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const s00 = src(i, j);
      const s10 = src(i + 1, j);
      const s01 = src(i, j + 1);
      const s11 = src(i + 1, j + 1);
      const d00 = dst(i, j);
      const d10 = dst(i + 1, j);
      const d01 = dst(i, j + 1);
      const d11 = dst(i + 1, j + 1);
      tri(c, img, s00, s10, s11, d00, d10, d11);
      tri(c, img, s00, s11, s01, d00, d11, d01);
    }
  }
}

function drawBody(c: CanvasRenderingContext2D, t: Textures, fit: Fit) {
  const tw = t.body.width;
  const th = t.body.height;
  // The sides of the body run shoulder → hem; above the shoulder line
  // (collar, hood) they carry on in the same direction.
  const side = (top: V, hem: V, v: number) => lerpV(top, hem, (v - SHOULDER_V) / (1 - SHOULDER_V));
  grid(
    c,
    t.body,
    COLS,
    ROWS,
    (i, j) => ({ x: tw * (BODY_U0 + ((BODY_U1 - BODY_U0) * i) / COLS), y: th * BODY_V1 * (j / ROWS) }),
    (i, j) => {
      const v = j / ROWS;
      return lerpV(side(fit.topL, fit.hemL, v), side(fit.topR, fit.hemR, v), i / COLS);
    },
  );
}

function drawSleeve(c: CanvasRenderingContext2D, img: HTMLCanvasElement, s: Fit["sleeves"][number], part: "upper" | "fore" | "both") {
  const pts = [s.root, s.elbow, s.wrist];
  const dirs = [norm(sub(s.elbow, s.root)), norm(sub(s.wrist, s.elbow))];
  // The perpendicular at each joint (the elbow's is the average, so the sleeve bends).
  const perp = (d: V): V => ({ x: -d.y, y: d.x });
  const normals = [perp(dirs[0]), norm(add(perp(dirs[0]), perp(dirs[1]))), perp(dirs[1])];
  const segs: [number, number][] = part === "upper" ? [[0, 1]] : part === "fore" ? [[1, 2]] : [[0, 1], [1, 2]];
  for (const [k0, k1] of segs) {
    grid(
      c,
      img,
      1,
      SLEEVE_ROWS,
      (i, j) => ({ x: i * SLEEVE_W, y: (SLEEVE_H / 2) * (k0 + j / SLEEVE_ROWS) }),
      (i, j) => {
        const t = j / SLEEVE_ROWS;
        const centre = lerpV(pts[k0], pts[k1], t);
        const n = norm(lerpV(normals[k0], normals[k1], t));
        const half = s.wide[k0] + (s.wide[k1] - s.wide[k0]) * t;
        return add(centre, mul(n, i === 0 ? -half : half));
      },
    );
  }
}

// ─── the whole garment ───────────────────────────────────────────────────────

/** Draws the fitted garment; one per overlay (it keeps its offscreen canvases). */
export class FittedGarment {
  private layer = document.createElement("canvas");
  private light = document.createElement("canvas");
  private probe = document.createElement("canvas");
  private maskProbe = document.createElement("canvas");
  private lastProbe = 0;
  /** Brightness gain that brings the picture's average to ~0.85. */
  private gain = 1.4;
  /** Milliseconds a frame of this costs (smoothed); a slow phone gets fewer pixels. */
  private cost = 0;
  /** Drawn at full sharpness while it is cheap; 1× and coarser light when it is not. */
  private slow = false;

  /** For the verify harness: what a frame costs and whether it has dropped to 1×. */
  stats(): { costMs: number; slow: boolean } {
    return { costMs: Math.round(this.cost * 10) / 10, slow: this.slow };
  }

  /** Draw `product` fitted to `pose` on `ctx` (already scaled for dpr). False when the pose is not enough. */
  draw(ctx: CanvasRenderingContext2D, pose: ScreenPose, product: Product, colour: string, o: FitOptions): boolean {
    const fit = fitTo(pose);
    if (!fit) return false;
    const t0 = performance.now();
    const t = textures(product.id, colour, o.mirrored);
    // Over ~12 ms a frame (the camera and tracking need the rest), drop to 1×
    // resolution; back to full once it is well under.
    if (this.cost > 12) this.slow = true;
    else if (this.cost < 6) this.slow = false;
    const scale = this.slow ? Math.min(1, o.dpr) : o.dpr;
    const pw = Math.max(1, Math.round(o.cw * scale));
    const ph = Math.max(1, Math.round(o.ch * scale));
    if (this.layer.width !== pw || this.layer.height !== ph) {
      this.layer.width = pw;
      this.layer.height = ph;
    }
    const g = this.layer.getContext("2d");
    if (!g) return false;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, pw, ph);
    g.setTransform(scale, 0, 0, scale, 0, 0);

    // Behind the body: the sleeves (a forearm in front comes after it).
    fit.sleeves.forEach((s) => drawSleeve(g, s.left ? t.sleevePatched : t.sleeve, s, s.front ? "upper" : "both"));
    drawBody(g, t, fit);
    fit.sleeves.forEach((s) => {
      if (s.front) drawSleeve(g, s.left ? t.sleevePatched : t.sleeve, s, "fore");
    });

    g.setTransform(1, 0, 0, 1, 0, 0);
    if (o.mask) this.trim(g, fit, o);
    if (o.video && o.video.readyState >= 2 && o.video.videoWidth > 0) this.shadeWith(g, o);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.97;
    ctx.drawImage(this.layer, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    const spent = performance.now() - t0;
    this.cost = this.cost ? this.cost * 0.9 + spent * 0.1 : spent;
    return true;
  }

  /** Where the video (object-fit: cover, maybe mirrored) sits in a w × h box. */
  private cover(vw: number, vh: number, w: number, h: number) {
    const s = Math.max(w / vw, h / vh);
    return { x: (w - vw * s) / 2, y: (h - vh * s) / 2, w: vw * s, h: vh * s };
  }

  private drawVideoSpace(c: CanvasRenderingContext2D, src: CanvasImageSource, vw: number, vh: number, w: number, h: number, mirrored: boolean) {
    const r = this.cover(vw, vh, w, h);
    c.save();
    if (mirrored) {
      c.translate(w, 0);
      c.scale(-1, 1);
    }
    c.drawImage(src, r.x, r.y, r.w, r.h);
    c.restore();
  }

  /** Trim to the silhouette, if it covers the middle of the body (else it is not to be trusted). */
  private trim(g: CanvasRenderingContext2D, fit: Fit, o: FitOptions) {
    const m = o.mask!;
    const video = o.video;
    const vw = video?.videoWidth || m.width;
    const vh = video?.videoHeight || m.height;
    // The body's middle in mask pixels.
    const r = this.cover(vw, vh, o.cw, o.ch);
    let nx = (fit.centre.x - r.x) / r.w;
    const ny = (fit.centre.y - r.y) / r.h;
    if (o.mirrored) nx = 1 - nx;
    const p = this.maskProbe;
    p.width = 1;
    p.height = 1;
    const pc = p.getContext("2d", { willReadFrequently: true });
    if (!pc) return;
    pc.clearRect(0, 0, 1, 1);
    pc.drawImage(m, Math.floor(nx * m.width), Math.floor(ny * m.height), 1, 1, 0, 0, 1, 1);
    if (pc.getImageData(0, 0, 1, 1).data[3] < 128) return;
    g.globalCompositeOperation = "destination-in";
    g.imageSmoothingEnabled = true;
    this.drawVideoSpace(g, m, vw, vh, this.layer.width, this.layer.height, o.mirrored);
    g.globalCompositeOperation = "source-over";
  }

  /** Multiply the camera's own light (grey, normalised) through the garment. */
  private shadeWith(g: CanvasRenderingContext2D, o: FitOptions) {
    const video = o.video!;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const now = performance.now();
    if (now - this.lastProbe > 500) {
      this.lastProbe = now;
      this.probe.width = 8;
      this.probe.height = 8;
      const pc = this.probe.getContext("2d", { willReadFrequently: true });
      if (pc) {
        try {
          pc.drawImage(video, 0, 0, 8, 8);
          const d = pc.getImageData(0, 0, 8, 8).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const mean = sum / (d.length / 4) / 255;
          this.gain = Math.min(2.4, Math.max(0.8, 0.85 / Math.max(0.05, mean)));
        } catch {
          /* keep the last gain */
        }
      }
    }
    // Half resolution is plenty for light (a quarter on a slow phone).
    const div = this.slow ? 4 : 2;
    const lw = Math.max(1, Math.round(this.layer.width / div));
    const lh = Math.max(1, Math.round(this.layer.height / div));
    if (this.light.width !== lw || this.light.height !== lh) {
      this.light.width = lw;
      this.light.height = lh;
    }
    const l = this.light.getContext("2d");
    if (!l) return;
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.globalCompositeOperation = "source-over";
    l.fillStyle = "#fff";
    l.fillRect(0, 0, lw, lh);
    // The picture's brightness only (white has no colour to give it).
    l.globalCompositeOperation = "luminosity";
    this.drawVideoSpace(l, video, vw, vh, lw, lh, o.mirrored);
    // Normalise: ×gain (colour-dodge by 1 − 1/gain brightens, multiply darkens).
    const k = this.gain;
    if (k > 1.01) {
      const v = Math.round(255 * (1 - 1 / k));
      l.globalCompositeOperation = "color-dodge";
      l.fillStyle = `rgb(${v},${v},${v})`;
      l.fillRect(0, 0, lw, lh);
    } else if (k < 0.99) {
      const v = Math.round(255 * k);
      l.globalCompositeOperation = "multiply";
      l.fillStyle = `rgb(${v},${v},${v})`;
      l.fillRect(0, 0, lw, lh);
    }
    // Lift the shadows a little: 0.25 + 0.75 × light.
    l.globalCompositeOperation = "screen";
    l.fillStyle = "rgb(64,64,64)";
    l.fillRect(0, 0, lw, lh);
    // Only where the garment is, then through it.
    l.globalCompositeOperation = "destination-in";
    l.drawImage(this.layer, 0, 0, lw, lh);
    g.globalCompositeOperation = "multiply";
    g.drawImage(this.light, 0, 0, this.layer.width, this.layer.height);
    g.globalCompositeOperation = "source-over";
  }
}
