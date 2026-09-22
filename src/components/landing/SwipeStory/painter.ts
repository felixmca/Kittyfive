/**
 * Paints the story's picture layer onto one canvas: the clip frame for the
 * playhead (72 frames cover about five seconds, so the two neighbouring
 * frames are blended), an optional crossfade layer, and the treatments the
 * timeline asks for (push-in, blurred backdrop, dim, winter-night blue).
 *
 * Phones get the frame cover-fitted; a wide stage (desktop, landscape) gets a
 * centred 9:16 column over a blurred, darkened copy of the same frame, as the
 * old scroll story did. Everything is in CSS pixels scaled by a capped dpr.
 */
import { frameSize, type FrameImage } from "@/components/story/frameLoader";
import type { CanvasView, FrameRef } from "./timeline";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageLayout {
  /** The stage, CSS px. */
  W: number;
  H: number;
  /** The part of the stage on screen: below the hero before the story starts, all of it after. */
  view: Rect;
  /** Where the 9:16 picture is drawn: covering the view on phones, a column when wide. */
  pic: Rect;
  wide: boolean;
  dpr: number;
}

/** Frames are 9:16; wider than this (relative) and the picture becomes a column. */
const COLUMN_RATIO = 1.15;
const FRAME_ASPECT = 576 / 1024;

export function computeLayout(W: number, H: number, visibleH: number, dpr: number): StageLayout {
  const view = { x: 0, y: 0, w: W, h: Math.max(1, Math.min(H, visibleH)) };
  // Decide by the whole stage, not the visible part, so the picture grows
  // smoothly (instead of switching fit) as the hero scrolls away.
  const wide = W / Math.max(1, H) > FRAME_ASPECT * COLUMN_RATIO;
  const s = wide ? Math.min(view.w / 576, view.h / 1024) : Math.max(view.w / 576, view.h / 1024);
  const pw = 576 * s;
  const ph = 1024 * s;
  const pic = { x: view.x + (view.w - pw) / 2, y: view.y + (view.h - ph) / 2, w: pw, h: ph };
  return { W, H, view, pic, wide, dpr };
}

/** A frame to draw plus its blend partner. */
interface Picked {
  a: FrameImage;
  b: FrameImage | null;
  f: number;
}

export type FrameLookup = (chapter: number, index: number) => FrameImage | null;

export class StagePainter {
  private ctx: CanvasRenderingContext2D | null;
  private tiny: HTMLCanvasElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false });
  }

  /** Match the backing store to the layout. */
  resize(layout: StageLayout): void {
    const w = Math.max(1, Math.round(layout.W * layout.dpr));
    const h = Math.max(1, Math.round(layout.H * layout.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  /**
   * `inset`: during the chat flight, the rect the frame is drawn into (it is
   * inside the chat's photo), over a blurred, darkened copy of itself.
   */
  draw(view: CanvasView, layout: StageLayout, lookup: FrameLookup, inset: Rect | null = null): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const d = layout.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b0b0c";
    ctx.fillRect(0, 0, W, H);

    const base = view.base ? pick(view.base, lookup) : null;
    const mix = view.mix && view.mixAlpha > 0.003 ? pick(view.mix, lookup) : null;

    if (inset && base) {
      this.backdrop(base.a, W, H, layout.wide ? 0.55 + 0.25 * view.inset : 0.3 + 0.45 * view.inset);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      this.drawPicked(ctx, base, inset, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return true;
    }

    if (layout.wide && (base || mix)) this.backdrop((base ?? mix)!.a, W, H);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    const pic = layout.pic;
    const z = view.zoom;
    const zr =
      z === 1
        ? pic
        : {
            x: pic.x + (pic.w * (1 - z)) / 2,
            y: pic.y + (pic.h * (1 - z)) / 2,
            w: pic.w * z,
            h: pic.h * z,
          };
    const clip = layout.wide && z !== 1;
    if (clip) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pic.x, pic.y, pic.w, pic.h);
      ctx.clip();
    }
    if (base) this.drawPicked(ctx, base, zr, 1);
    if (mix) this.drawPicked(ctx, mix, zr, view.mixAlpha);
    if (clip) ctx.restore();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (view.blur > 0.003) this.blurPass(ctx, view.blur, W, H);
    if (view.night > 0.003) {
      ctx.globalAlpha = 0.64 * view.night;
      ctx.fillStyle = "rgb(8, 16, 38)";
      ctx.fillRect(0, 0, W, H);
    }
    if (view.dim > 0.003) {
      ctx.globalAlpha = view.dim;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 1;
    return Boolean(base || mix);
  }

  private drawPicked(ctx: CanvasRenderingContext2D, p: Picked, r: Rect, alpha: number): void {
    ctx.globalAlpha = alpha;
    ctx.drawImage(p.a, r.x, r.y, r.w, r.h);
    if (p.b && p.f > 0.02) {
      ctx.globalAlpha = alpha * p.f;
      ctx.drawImage(p.b, r.x, r.y, r.w, r.h);
    }
    ctx.globalAlpha = 1;
  }

  private tinyCanvas(w: number, h: number): CanvasRenderingContext2D | null {
    const tiny = this.tiny ?? (this.tiny = document.createElement("canvas"));
    if (tiny.width !== w || tiny.height !== h) {
      tiny.width = w;
      tiny.height = h;
    }
    return tiny.getContext("2d");
  }

  /** A blurred, darkened cover copy of the frame over the whole stage (draw tiny, scale up). */
  private backdrop(img: FrameImage, W: number, H: number, dark = 0.55): void {
    const ctx = this.ctx!;
    const tw = Math.max(8, Math.round(W / 24));
    const th = Math.max(8, Math.round(H / 24));
    const t = this.tinyCanvas(tw, th);
    if (!t) return;
    const { width: fw, height: fh } = frameSize(img);
    const s = Math.max(tw / fw, th / fh);
    t.drawImage(img, (tw - fw * s) / 2, (th - fh * s) / 2, fw * s, fh * s);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tiny!, 0, 0, W, H);
    ctx.fillStyle = `rgba(0, 0, 0, ${dark})`;
    ctx.fillRect(0, 0, W, H);
  }

  /** Blend a blurred copy of what is on the canvas over it. */
  private blurPass(ctx: CanvasRenderingContext2D, amount: number, W: number, H: number): void {
    const tw = Math.max(8, Math.round(W / 14));
    const th = Math.max(8, Math.round(H / 14));
    const t = this.tinyCanvas(tw, th);
    if (!t) return;
    t.imageSmoothingEnabled = true;
    t.drawImage(this.canvas, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = Math.min(1, amount);
    ctx.drawImage(this.tiny!, 0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function pick(ref: FrameRef, lookup: FrameLookup): Picked | null {
  const i0 = Math.floor(ref.pos);
  const f = ref.pos - i0;
  const a = lookup(ref.chapter, i0);
  if (!a) return null;
  const b = f > 0.02 ? lookup(ref.chapter, i0 + 1) : null;
  return { a, b: b && b !== a ? b : null, f };
}
