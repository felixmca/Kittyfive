"use client";
/**
 * SceneCanvas — the picture layer of one story scene.
 *
 * A full-viewport <canvas> (device pixels capped at 2x) paints the nearest
 * decoded frame for the current main progress, cover-fitted. On a wide
 * viewport (desktop, landscape phone) a portrait clip is pillarboxed: a
 * blurred, darkened copy fills the canvas and the sharp frame sits centred
 * on top. It only repaints when the frame index, the canvas size or the
 * frame set changes — scroll updates that resolve to the same frame cost
 * nothing.
 *
 * Under the canvas lives the designed placeholder: a gradient from
 * sceneHues(id), a soft glow that drifts with progress, and — when the scene
 * has no media — the big faint scene number and a "still being drawn"
 * caption. While frames are loading the gradient shows; the canvas fades in
 * over it once the first frame lands. Film grain and a vignette sit on top of
 * both so the look is continuous between real footage and placeholders.
 *
 * Nothing here goes through React state per scroll frame: the progress bus
 * and the frame-sequence subscription drive the painter directly.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import type { FrameSequence } from "./useFrameSequence";
import type { ProgressBus, SceneProgress } from "./progress";
import { frameSize, type FrameImage } from "./frameLoader";
import { cappedDpr, sceneHues, sceneNumber } from "./motion";
import styles from "./story.module.css";

export interface SceneCanvasProps {
  seq: FrameSequence;
  bus: ProgressBus;
  sceneId: string;
  /** Zero-based position in STORY, for the placeholder's number. */
  index: number;
}

/** Wider than the frame by this factor → pillarbox instead of cropping. */
const LETTERBOX_RATIO = 1.15;

class Painter {
  private ctx: CanvasRenderingContext2D | null;
  private off: HTMLCanvasElement | null = null;
  private drawn = -1;
  private shown = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false });
  }

  /** Match the backing store to the CSS size × capped dpr. Returns true when it changed. */
  resize(vw: number, vh: number): boolean {
    const dpr = cappedDpr(2);
    const w = Math.max(1, Math.round(vw * dpr));
    const h = Math.max(1, Math.round(vh * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return false;
    this.canvas.width = w;
    this.canvas.height = h;
    this.drawn = -1;
    return true;
  }

  /** Paint the nearest frame for `main` if it differs from what is on screen. */
  paint(seq: FrameSequence, main: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const total = seq.total;
    const target = total > 1 ? Math.round(main * (total - 1)) : 0;
    const idx = seq.nearestIndex(target);
    if (idx < 0 || idx === this.drawn) return;
    const img = seq.getFrame(idx);
    if (!img) return;
    this.draw(ctx, img);
    this.drawn = idx;
    if (!this.shown) {
      this.shown = true;
      this.canvas.classList.add(styles.canvasVisible);
    }
  }

  private draw(ctx: CanvasRenderingContext2D, img: FrameImage): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const { width: fw, height: fh } = frameSize(img);
    if (!fw || !fh) return;

    const pillarbox = W / H > (fw / fh) * LETTERBOX_RATIO;
    if (!pillarbox) {
      const s = Math.max(W / fw, H / fh);
      const dw = fw * s;
      const dh = fh * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }

    // Blurred, darkened cover copy: draw tiny, then upscale with smoothing.
    // Cheaper than ctx.filter and it works on browsers without it.
    const off = this.off ?? (this.off = document.createElement("canvas"));
    const ow = Math.max(8, Math.round(W / 24));
    const oh = Math.max(8, Math.round(H / 24));
    if (off.width !== ow || off.height !== oh) {
      off.width = ow;
      off.height = oh;
    }
    const octx = off.getContext("2d");
    if (octx) {
      const s = Math.max(ow / fw, oh / fh);
      const dw = fw * s;
      const dh = fh * s;
      octx.drawImage(img, (ow - dw) / 2, (oh - dh) / 2, dw, dh);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(0, 0, W, H);
    } else {
      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(0, 0, W, H);
    }

    const s = Math.min(W / fw, H / fh);
    const dw = fw * s;
    const dh = fh * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
}

export default function SceneCanvas({ seq, bus, sceneId, index }: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const painterRef = useRef<Painter | null>(null);
  const seqRef = useRef(seq);

  // Painter + progress subscription live for the life of the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const painter = new Painter(canvas);
    painterRef.current = painter;

    let lastVw = 0;
    let lastVh = 0;
    const onProgress = (v: SceneProgress) => {
      if (v.vw !== lastVw || v.vh !== lastVh) {
        lastVw = v.vw;
        lastVh = v.vh;
        painter.resize(v.vw, v.vh);
      }
      painter.paint(seqRef.current, v.main);
      const glow = glowRef.current;
      if (glow) {
        glow.style.transform = `translate3d(${(v.main - 0.5) * -8}%, ${(v.main - 0.5) * -14}%, 0) scale(${
          0.9 + 0.25 * v.main
        })`;
      }
    };
    const off = bus.subscribe(onProgress);
    onProgress(bus.value);
    return () => {
      off();
      painterRef.current = null;
    };
  }, [bus]);

  // Frames land → repaint if a nearer frame is now available.
  const { subscribe } = seq;
  useEffect(() => {
    const off = subscribe(() => {
      painterRef.current?.paint(seqRef.current, bus.value.main);
    });
    return off;
  }, [subscribe, bus]);

  // The sequence snapshot (total, status) changes rarely; keep the painter's
  // view of it current and repaint once so a freshly-known `total` remaps
  // progress onto the right frame.
  useEffect(() => {
    seqRef.current = seq;
    painterRef.current?.paint(seq, bus.value.main);
  }, [seq, bus]);

  const [hueA, hueB] = sceneHues(sceneId);
  const backdrop: CSSProperties = {
    background: `linear-gradient(160deg, hsl(${hueA} 42% 17%) 0%, hsl(${hueB} 38% 9%) 100%)`,
  };
  const glow: CSSProperties = {
    background: `radial-gradient(circle at 50% 50%, hsl(${hueA} 70% 48% / 0.26) 0%, hsl(${hueB} 60% 30% / 0.1) 32%, transparent 62%)`,
  };

  const missing = seq.status === "missing";
  const errored = seq.status === "error";

  return (
    <>
      <div className={styles.ph} aria-hidden>
        <div className={styles.phBackdrop} style={backdrop} />
        <div ref={glowRef} className={styles.phGlow} style={glow} />
        {(missing || errored) && (
          <>
            <div className={`${styles.phNumber} font-display`}>{sceneNumber(index)}</div>
            <div className={styles.phCaption}>
              <span className={styles.phDot} />
              <span>{missing ? "still being drawn" : "this scene didn't load"}</span>
            </div>
          </>
        )}
      </div>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden />
      <div className={styles.grain} aria-hidden />
      <div className={styles.vignette} aria-hidden />
    </>
  );
}
