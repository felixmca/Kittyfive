"use client";
/**
 * Turntable — drag sideways to spin Kitty through N photos from
 * /turntable/manifest.json (built by scripts/build-story.mjs).
 *
 * - Square canvas min(86vw, 420px). Frame i is drawn cover-fitted; only the
 *   nearest *loaded* frame is drawn so it spins while still downloading.
 * - Drag: pointer events, horizontal only (touch-action: pan-y keeps vertical
 *   page scroll native). dx / pxPerFrame frames, where
 *   pxPerFrame = width / frames × (degreesPerFrame / (360 / frames)).
 * - Release with inertia (velocity × 0.95 per 60Hz tick), wrap-around.
 * - Auto-rotates slowly until the first interaction; never under
 *   prefers-reduced-motion. The loop only runs while something moves and the
 *   element is on screen.
 * - Loads lazily once within ~a viewport of the section; frames 0, 9, 18, 27
 *   first, then frameLoader's progressive order, through the shared limiter.
 * - No manifest → a circular glass disc with the cat silhouette that still
 *   spins on drag. Nothing here throws on a 404.
 */
import { useEffect, useRef, useState } from "react";
import { TURNTABLE } from "@/config/story";
import {
  fetchManifest,
  frameSize,
  frameUrl,
  loadFrame,
  progressiveOrder,
  releaseFrame,
  schedule,
  type FrameImage,
  type FrameManifest,
} from "@/components/story/frameLoader";
import { cappedDpr, prefersReducedMotion } from "@/components/story/motion";
import CatSilhouette from "@/components/story/transitions/CatSilhouette";

const SIZE = "min(86vw, 420px)";
/** Virtual frame count for the placeholder disc. */
const PLACEHOLDER_FRAMES = 36;
/** Requested first so a quarter-turn preview is ready almost immediately. */
const FIRST_FRAMES = [0, 9, 18, 27];
const AUTO_FRAMES_PER_SECOND = 5;
const DECAY = 0.95;
const STOP_VELOCITY = 0.02;
/** Below the story's current/adjacent scenes (0..2) in the shared limiter. */
const LOAD_PRIORITY = 3;

type Status = "loading" | "ready" | "missing";

interface Spin {
  n: number;
  frames: (FrameImage | null)[];
  /** Current frame position (float, wraps in [0, n)). */
  i: number;
  /** Frames per 60Hz tick. */
  vel: number;
  dragging: boolean;
  pointerId: number | null;
  lastX: number;
  lastT: number;
  auto: boolean;
  visible: boolean;
  raf: number;
  lastTick: number;
  drawn: number;
}

const wrapIndex = (i: number, n: number): number => (n > 0 ? ((i % n) + n) % n : 0);

function nearestLoaded(frames: (FrameImage | null)[], target: number): number {
  const n = frames.length;
  if (!n) return -1;
  const c = wrapIndex(Math.round(target), n);
  if (frames[c]) return c;
  const half = Math.ceil(n / 2);
  for (let d = 1; d <= half; d++) {
    const lo = wrapIndex(c - d, n);
    const hi = wrapIndex(c + d, n);
    if (frames[lo]) return lo;
    if (frames[hi]) return hi;
  }
  return -1;
}

export default function Turntable() {
  const [status, setStatus] = useState<Status>("loading");
  const [interacted, setInteracted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const discRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof window === "undefined") return;

    const reduced = prefersReducedMotion();
    const s: Spin = {
      n: 0,
      frames: [],
      i: 0,
      vel: 0,
      dragging: false,
      pointerId: null,
      lastX: 0,
      lastT: 0,
      auto: !reduced,
      visible: true,
      raf: 0,
      lastTick: 0,
      drawn: -1,
    };
    const ctrl = new AbortController();

    const frameCount = () => s.n || PLACEHOLDER_FRAMES;

    const pxPerFrame = () => {
      const w = wrap.clientWidth || 300;
      const n = frameCount();
      return (w / n) * (TURNTABLE.degreesPerFrame / (360 / n));
    };

    const paint = () => {
      const canvas = canvasRef.current;
      if (canvas && s.n > 0) {
        const idx = nearestLoaded(s.frames, s.i);
        if (idx >= 0 && idx !== s.drawn) {
          const img = s.frames[idx];
          const ctx = canvas.getContext("2d");
          if (img && ctx) {
            const W = canvas.width;
            const H = canvas.height;
            const { width: fw, height: fh } = frameSize(img);
            if (fw && fh) {
              const sc = Math.max(W / fw, H / fh);
              const dw = fw * sc;
              const dh = fh * sc;
              ctx.clearRect(0, 0, W, H);
              ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
              s.drawn = idx;
            }
          }
        }
      }
      const disc = discRef.current;
      if (disc) disc.style.transform = `rotate(${(s.i / frameCount()) * 360}deg)`;
    };

    const loop = (now: number) => {
      s.raf = 0;
      const dt = s.lastTick ? Math.min(48, now - s.lastTick) : 16.67;
      s.lastTick = now;
      const ticks = dt / 16.67;
      if (!s.dragging) {
        if (s.auto) {
          s.i += (AUTO_FRAMES_PER_SECOND * dt) / 1000;
        } else if (Math.abs(s.vel) > STOP_VELOCITY) {
          s.i += s.vel * ticks;
          s.vel *= Math.pow(DECAY, ticks);
        } else {
          s.vel = 0;
        }
      }
      s.i = wrapIndex(s.i, frameCount());
      paint();
      const moving = s.dragging || s.auto || Math.abs(s.vel) > STOP_VELOCITY;
      if (moving && s.visible) s.raf = requestAnimationFrame(loop);
      else s.lastTick = 0;
    };
    const kick = () => {
      if (!s.raf) s.raf = requestAnimationFrame(loop);
    };

    // ── pointer ─────────────────────────────────────────────────────────
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      s.dragging = true;
      s.auto = false;
      s.vel = 0;
      s.pointerId = e.pointerId;
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      try {
        wrap.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      wrap.style.cursor = "grabbing";
      setInteracted(true);
      kick();
    };
    const onMove = (e: PointerEvent) => {
      if (!s.dragging || e.pointerId !== s.pointerId) return;
      const dx = e.clientX - s.lastX;
      const dt = Math.max(1, e.timeStamp - s.lastT);
      s.lastX = e.clientX;
      s.lastT = e.timeStamp;
      const df = dx / pxPerFrame();
      s.i = wrapIndex(s.i + df, frameCount());
      const instant = (df / dt) * 16.67;
      s.vel = s.vel * 0.4 + instant * 0.6;
      kick();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== s.pointerId) return;
      s.dragging = false;
      s.pointerId = null;
      // Held still before letting go → no fling.
      if (e.timeStamp - s.lastT > 90) s.vel = 0;
      try {
        wrap.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      wrap.style.cursor = "grab";
      kick();
    };
    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onUp);

    // ── canvas backing size ─────────────────────────────────────────────
    const fit = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = cappedDpr(2);
      const w = Math.max(1, Math.round((canvas.clientWidth || wrap.clientWidth) * dpr));
      const h = Math.max(1, Math.round((canvas.clientHeight || wrap.clientHeight) * dpr));
      if (w !== canvas.width || h !== canvas.height) {
        canvas.width = w;
        canvas.height = h;
        s.drawn = -1;
        paint();
      }
    };
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(fit);
      ro.observe(wrap);
    } else {
      window.addEventListener("resize", fit);
    }

    // ── loading ─────────────────────────────────────────────────────────
    let started = false;
    const load = async () => {
      let fetched: FrameManifest | null;
      try {
        fetched = await fetchManifest(TURNTABLE.dir, ctrl.signal);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.warn("[turntable] manifest fetch failed", err);
        fetched = null;
      }
      if (ctrl.signal.aborted) return;
      if (!fetched) {
        setStatus("missing");
        return;
      }
      const manifest = fetched;
      const n = manifest.frames;
      s.n = n;
      s.frames = new Array<FrameImage | null>(n).fill(null);
      const first = FIRST_FRAMES.filter((i) => i < n);
      const order = [...first, ...progressiveOrder(n).filter((i) => !first.includes(i))];
      let failed = 0;
      for (const idx of order) {
        schedule(
          async (sig) => {
            const img = await loadFrame(frameUrl(TURNTABLE.dir, manifest.pattern, idx + 1), sig);
            if (sig.aborted) {
              releaseFrame(img);
              return;
            }
            s.frames[idx] = img;
            if (s.drawn < 0) {
              fit();
              setStatus("ready");
            }
            paint();
          },
          () => LOAD_PRIORITY,
          ctrl.signal,
        ).catch(() => {
          if (ctrl.signal.aborted) return;
          failed++;
          if (failed === n) {
            console.warn("[turntable] every frame failed to load");
            setStatus("missing");
          }
        });
      }
    };
    const start = () => {
      if (started) return;
      started = true;
      load().catch((err) => {
        if (!ctrl.signal.aborted) {
          console.warn("[turntable] load failed", err);
          setStatus("missing");
        }
      });
    };

    // ── visibility: load when near, animate only when on screen ─────────
    let ioNear: IntersectionObserver | undefined;
    let ioVisible: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === "function") {
      ioNear = new IntersectionObserver(
        (entries) => {
          if (entries.some((en) => en.isIntersecting)) {
            start();
            ioNear?.disconnect();
          }
        },
        { rootMargin: "120% 0px" },
      );
      ioNear.observe(wrap);
      ioVisible = new IntersectionObserver((entries) => {
        s.visible = entries.some((en) => en.isIntersecting);
        if (s.visible) kick();
      });
      ioVisible.observe(wrap);
    } else {
      start();
    }

    fit();
    kick();

    return () => {
      ctrl.abort();
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onUp);
      ro?.disconnect();
      window.removeEventListener("resize", fit);
      ioNear?.disconnect();
      ioVisible?.disconnect();
      if (s.raf) cancelAnimationFrame(s.raf);
      for (const f of s.frames) releaseFrame(f);
      s.frames = [];
    };
  }, []);

  const missing = status === "missing";

  return (
    <div className="flex flex-col items-center" data-turntable data-turntable-status={status}>
      <div
        ref={wrapRef}
        data-lenis-prevent
        role="img"
        aria-label="Kitty, all the way round. Drag sideways to spin her."
        className="relative select-none"
        style={{ width: SIZE, height: SIZE, touchAction: "pan-y", cursor: "grab" }}
      >
        {missing ? (
          <div className="glass flex h-full w-full items-center justify-center overflow-hidden rounded-full">
            <div ref={discRef} className="aspect-[130/92] w-[62%]" style={{ willChange: "transform" }}>
              <CatSilhouette body="#f4f1ea" patch="#0b0b0c" outline="rgba(11, 11, 12, 0.55)" />
            </div>
          </div>
        ) : (
          <div className="glass h-full w-full overflow-hidden rounded-[24px]">
            <canvas
              ref={canvasRef}
              className={`block h-full w-full transition-opacity duration-500 ${
                status === "ready" ? "opacity-100" : "opacity-0"
              }`}
              aria-hidden
            />
          </div>
        )}
      </div>
      <p
        aria-hidden={interacted}
        className={`mt-4 text-[13px] tracking-[0.02em] text-muted transition-opacity duration-500 ${
          interacted ? "opacity-0" : "opacity-100"
        }`}
      >
        swipe to spin Kitty
      </p>
    </div>
  );
}
