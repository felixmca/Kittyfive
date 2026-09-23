"use client";
/**
 * One scene of a chapter: a pinned, full-screen picture with its words.
 *
 * The section is `pinLength × 100dvh` tall and holds a sticky 100dvh stage,
 * so the picture stays put while the scroll moves through it. The reader
 * feeds each scene its progress (0 → 1 through the section); the scene
 * paints from that without touching React state:
 *
 *   · frames (a clip cut into WebP frames) → the frame for that progress on
 *     a canvas, cover-fitted, so scrolling up plays the clip backwards;
 *   · otherwise the photo, with a slow push-in towards its focus point;
 *   · otherwise a designed placeholder, so an unfinished chapter still reads.
 *
 * Beats (lines of text) fade in one after another as the scroll advances and
 * stay, stacked in the lower third over a dark gradient.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import RetryImg from "@/components/RetryImg";
import { useFrameSequence } from "@/components/story/useFrameSequence";
import { frameSize } from "@/components/story/frameLoader";
import { mediaUrl } from "@/lib/supabase/config";
import type { Scene } from "@/lib/stories/types";

export interface SceneRegistry {
  register(el: HTMLElement, update: (progress: number) => void): () => void;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function beatWindow(i: number, n: number): [number, number] {
  const start = 0.06 + (i / Math.max(1, n)) * 0.7;
  return [start, start + 0.09];
}

export default function ReaderScene({
  scene,
  registry,
  seed,
}: {
  scene: Scene;
  registry: SceneRegistry;
  /** For the placeholder's colours. */
  seed: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const beatRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const progress = useRef(0);
  const drawn = useRef(-1);
  const [near, setNear] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const framesDir = scene.frames ? mediaUrl(scene.frames.dir) : null;
  const imageUrl = mediaUrl(scene.image);
  const seq = useFrameSequence(
    { dir: framesDir ?? "", hint: framesDir ? "probe" : "absent", none: !framesDir },
    near,
    0,
  );
  const hasFrames = seq.status === "ready" || (seq.status === "loading" && seq.loaded > 0);
  const showImage = !hasFrames && Boolean(imageUrl) && !imageFailed;

  // Load frames only while the scene is within about a screen of the viewport.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      rootMargin: "120% 0px 120% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Paint the frame for the current progress (only when it changes).
  const paint = useRef(() => {});
  useLayoutEffect(() => {
  paint.current = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasFrames) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    let resized = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      resized = true;
    }
    const total = seq.total;
    const target = total > 1 ? Math.round(progress.current * (total - 1)) : 0;
    // Only frames near the scroll position stay decoded (useFrameSequence).
    seq.focus(target);
    const idx = seq.nearestIndex(target);
    if (idx < 0 || (idx === drawn.current && !resized)) return;
    const img = seq.getFrame(idx);
    if (!img) return;
    const { width: fw, height: fh } = frameSize(img);
    if (!fw || !fh) return;
    const scale = Math.max(w / fw, h / fh);
    const dw = fw * scale;
    const dh = fh * scale;
    const fx = scene.focus?.x ?? 0.5;
    const fy = scene.focus?.y ?? 0.45;
    const dx = Math.min(0, Math.max(w - dw, w / 2 - dw * fx));
    const dy = Math.min(0, Math.max(h - dh, h / 2 - dh * fy));
    ctx.drawImage(img, dx, dy, dw, dh);
    drawn.current = idx;
  };
  });

  useEffect(() => seq.subscribe(() => paint.current()), [seq]);
  useEffect(() => {
    drawn.current = -1;
    paint.current();
  }, [hasFrames]);

  // Progress from the reader: move the photo, reveal beats, pick the frame.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const n = scene.beats.length;
    return registry.register(el, (p) => {
      progress.current = p;
      const img = imgRef.current;
      if (img) {
        const s = 1.03 + 0.11 * p;
        const fx = (scene.focus?.x ?? 0.5) - 0.5;
        const fy = (scene.focus?.y ?? 0.42) - 0.5;
        img.style.transform = `translate3d(${(-fx * 8 * p).toFixed(2)}%, ${(-fy * 8 * p).toFixed(2)}%, 0) scale(${s.toFixed(4)})`;
      }
      for (let i = 0; i < n; i++) {
        const beat = beatRefs.current[i];
        if (!beat) continue;
        const [a, b] = beatWindow(i, n);
        const t = clamp01((p - a) / (b - a));
        beat.style.opacity = t.toFixed(3);
        beat.style.transform = `translate3d(0, ${((1 - t) * 14).toFixed(2)}px, 0)`;
      }
      paint.current();
    });
  }, [registry, scene.beats.length, scene.focus?.x, scene.focus?.y]);

  const pin = Math.max(1.3, scene.pinLength);
  const hue = [...seed].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % 360;

  return (
    <section
      ref={sectionRef}
      className="relative"
      style={{ height: `${pin * 100}dvh` }}
      data-reader-scene={scene.id}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden bg-[#0b0b0c]">
        {/* placeholder: always underneath, so a missing picture still reads */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 80% at 30% 20%, hsl(${hue} 30% 22%), transparent 60%), radial-gradient(100% 70% at 80% 90%, hsl(${(hue + 60) % 360} 34% 16%), transparent 65%), #0d0d0f`,
          }}
        />
        {showImage && imageUrl ? (
          <RetryImg
            ref={imgRef}
            src={imageUrl}
            draggable={false}
            decoding="async"
            loading={near ? "eager" : "lazy"}
            onGiveUp={() => setImageFailed(true)}
            className="absolute inset-0 h-full w-full object-cover will-change-transform"
            style={{ objectPosition: `${(scene.focus?.x ?? 0.5) * 100}% ${(scene.focus?.y ?? 0.42) * 100}%` }}
          />
        ) : null}
        {hasFrames ? <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" /> : null}

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "linear-gradient(to top, rgba(8,8,9,0.94) 0%, rgba(8,8,9,0.6) 30%, rgba(8,8,9,0) 58%)" }}
        />

        <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-[720px] px-6 pb-[max(40px,env(safe-area-inset-bottom))] sm:px-8 sm:pb-14">
          {scene.kicker ? (
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">{scene.kicker}</p>
          ) : null}
          {scene.title ? (
            <h3 className="font-display mt-2 text-[30px] font-light leading-[1.06] text-fg sm:text-[40px]">{scene.title}</h3>
          ) : null}
          <div className="mt-4 flex flex-col gap-3">
            {scene.beats.map((beat, i) => (
              <p
                key={i}
                ref={(el) => {
                  beatRefs.current[i] = el;
                }}
                className="text-[18px] leading-[1.5] text-fg/92 sm:text-[21px]"
                style={{ opacity: 0 }}
              >
                {beat}
              </p>
            ))}
          </div>
        </div>
        {!hasFrames && !showImage ? (
          <p className="absolute left-6 top-[calc(max(12px,env(safe-area-inset-top))+72px)] text-[12px] text-white/35 sm:left-8">
            The clip for this page is still being made.
          </p>
        ) : null}
      </div>
    </section>
  );
}
