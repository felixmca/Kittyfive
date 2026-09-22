"use client";
/**
 * StoryScene — one pinned scene of the scroll story.
 *
 * Layout: an outer section `pinLength × 100dvh` tall with a sticky
 * 100dvh child. While the outer scrolls through, the sticky child stays put,
 * so the scene is "pinned" without ScrollTrigger pinning anything.
 *
 * Three ScrollTriggers on the outer feed the scene's progress bus:
 *
 *   enter  start "top bottom"    end "top top"       → v.enter, v.enterActive
 *   main   start "top top"       end "bottom bottom" → v.main,  v.mainActive
 *   exit   start "bottom bottom" end "bottom top"    → v.exit,  v.exitActive
 *
 * Scene N's exit window is exactly scene N+1's enter window (their edges
 * touch), so one scroll position gives both sides the same t. Everything
 * visual is a pure function of (phase, t, main) via transitions/index.ts,
 * so scrolling back plays every transition in reverse.
 *
 * Painting order: later scenes come later in the DOM, so the incoming scene
 * paints over the outgoing one. The outgoing frame is counter-translated to
 * stay pinned while it is covered; the incoming is counter-translated when it
 * should fade in in place, or left to slide up natively.
 *
 * Transition props (the walking cat, the falling flyer and the rain) belong to
 * the *incoming* scene of a pair — it is on top — and live in a separate
 * overlay that is always counter-translated to viewport coordinates.
 *
 * Frame loading: a scene is active (fetching / holding frames) when it is
 * within one scene of the current one, so at most three are resident.
 *
 * No React state is touched per scroll frame: the bus listener writes styles
 * and classes on DOM nodes directly.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { SceneTransition, StoryScene as SceneDef } from "@/config/story";
import SceneCanvas from "./SceneCanvas";
import { createProgressBus, phaseOf, type ScenePhase, type SceneProgress } from "./progress";
import { useFrameSequence, type FrameSequence, type FrameSource, type MediaHint } from "./useFrameSequence";
import { frameSize, type FrameImage } from "./frameLoader";
import { cappedDpr, clamp, lerp, prefersReducedMotion, smoothstep, span } from "./motion";
import { CARD, cardEdges, computeLayers, resolvePair, textWindow } from "./transitions";
import CatSilhouette from "./transitions/CatSilhouette";
import MissingFlyer from "./transitions/MissingFlyer";
import styles from "./story.module.css";
import tr from "./transitions/transitions.module.css";

export interface StorySceneProps {
  scene: SceneDef;
  index: number;
  prev: SceneDef | null;
  next: SceneDef | null;
  /** What /story/index.json said about this scene's media. */
  hint: MediaHint;
  /** Index of the scene currently pinned (drives activation and priority). */
  current: number;
  /** Called with this scene's index when its main window becomes active. */
  onCurrent: (index: number) => void;
}

const WALK_DIR = "/story/cutouts/walk";
/** Enter-window t by which Kitty has fully left the outgoing card (right edge). */
const WALK_OUT_END = 0.32;
/** Enter-window t at which she steps in from the incoming card's left edge. */
const WALK_IN_START = 0.6;

type WalkMode = "sequence" | "png" | "svg";

const KIND_WALK: SceneTransition = "walk-out-of-frame";
const KIND_FALL: SceneTransition = "fall";

// ─── small helpers ──────────────────────────────────────────────────────────

/** Does a decoded cut-out frame actually contain anything? (The synthetic
 *  pipeline can produce fully transparent frames; those must fall back.) */
function frameHasContent(img: FrameImage): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  } catch {
    return true;
  }
}

/** Paints the walk cut-out clip into a small transparent canvas. */
class WalkPainter {
  private ctx: CanvasRenderingContext2D | null;
  private drawn = -1;
  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }
  paint(seq: FrameSequence, progress: number, cssW: number, cssH: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = cappedDpr(2);
    const W = Math.max(1, Math.round(cssW * dpr));
    const H = Math.max(1, Math.round(cssH * dpr));
    let resized = false;
    if (W !== this.canvas.width || H !== this.canvas.height) {
      this.canvas.width = W;
      this.canvas.height = H;
      resized = true;
    }
    const n = seq.total;
    const idx = seq.nearestIndex(n > 1 ? Math.round(progress * (n - 1)) : 0);
    if (idx < 0 || (idx === this.drawn && !resized)) return;
    const img = seq.getFrame(idx);
    if (!img) return;
    const { width: fw, height: fh } = frameSize(img);
    if (!fw || !fh) return;
    ctx.clearRect(0, 0, W, H);
    const s = Math.min(W / fw, H / fh);
    const dw = fw * s;
    const dh = fh * s;
    ctx.drawImage(img, (W - dw) / 2, H - dh, dw, dh);
    this.drawn = idx;
  }
}

function fadeStyle(el: HTMLElement, f: number, reduced: boolean): void {
  el.style.opacity = String(f);
  el.style.transform = reduced ? "none" : `translate3d(0, ${(1 - f) * 12}px, 0)`;
}

// ─── component ──────────────────────────────────────────────────────────────

export default function StoryScene({ scene, index, prev, next, hint, current, onCurrent }: StorySceneProps) {
  const enterKind: SceneTransition | null = prev ? resolvePair(prev, scene) : null;
  const exitKind: SceneTransition | null = next ? resolvePair(scene, next) : null;
  const cutoutSrc = prev?.cutout ?? scene.cutout;
  // Only use the cut-out once it has actually loaded: until the owner adds
  // one, the walk falls back to the drawn silhouette instead of nothing.
  const [cutoutOk, setCutoutOk] = useState(false);
  useEffect(() => {
    if (!cutoutSrc || typeof Image === "undefined") return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setCutoutOk(true);
    img.src = cutoutSrc;
    return () => {
      live = false;
    };
  }, [cutoutSrc]);
  const cutout = cutoutOk ? cutoutSrc : undefined;

  const distance = Math.abs(index - current);
  const active = distance <= 1;

  const bus = useMemo(() => createProgressBus(), []);

  // Scene frames.
  const source = useMemo<FrameSource>(() => {
    const dir = `/story/${scene.id}`;
    const m = scene.media;
    if (m.kind === "none") return { dir, hint: "absent", none: true };
    if (m.kind === "image") return { dir, hint: "absent", poster: m.src };
    return { dir, hint, poster: m.fallbackPoster };
  }, [scene, hint]);
  const seq = useFrameSequence(source, active, distance);

  // Walk cut-out clip, only for the incoming side of a walk-out-of-frame pair.
  const hasWalk = enterKind === KIND_WALK;
  const walkSource = useMemo<FrameSource>(
    () => (hasWalk ? { dir: WALK_DIR, hint: "probe" } : { dir: WALK_DIR, hint: "absent", none: true }),
    [hasWalk],
  );
  const walkActive = hasWalk && (current === index || current === index - 1);
  const walkSeq = useFrameSequence(walkSource, walkActive, distance + 1);
  const [walkUsable, setWalkUsable] = useState<boolean | null>(null);
  const { status: walkStatus, getFrame: getWalkFrame } = walkSeq;
  useEffect(() => {
    if (walkStatus !== "ready" || walkUsable !== null) return;
    const img = getWalkFrame(0);
    if (img) setWalkUsable(frameHasContent(img));
  }, [walkStatus, walkUsable, getWalkFrame]);
  const walkMode: WalkMode = !hasWalk
    ? "svg"
    : walkStatus === "ready" && walkUsable
      ? "sequence"
      : cutout
        ? "png"
        : "svg";
  const walkSeqRef = useRef(walkSeq);
  useEffect(() => {
    walkSeqRef.current = walkSeq;
  }, [walkSeq]);

  // DOM refs — read only inside effects and listeners.
  const outerRef = useRef<HTMLElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const borderRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const textShadeRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const beatRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const catWrapRef = useRef<HTMLDivElement>(null);
  const catRef = useRef<HTMLDivElement>(null);
  const catCanvasRef = useRef<HTMLCanvasElement>(null);
  const rainRef = useRef<HTMLDivElement>(null);
  const flyerRef = useRef<HTMLDivElement>(null);

  // ── ScrollTriggers + viewport measurement → bus ─────────────────────────
  useEffect(() => {
    const outer = outerRef.current;
    const sticky = stickyRef.current;
    if (!outer || !sticky || typeof window === "undefined") return;
    try {
      gsap.registerPlugin(ScrollTrigger);
    } catch (err) {
      console.warn("[story] ScrollTrigger could not be registered", err);
      return;
    }

    const main = ScrollTrigger.create({
      trigger: outer,
      start: "top top",
      end: "bottom bottom",
      scrub: true,
      onUpdate: (self) => bus.set({ main: self.progress, mainActive: self.isActive }),
      onToggle: (self) => {
        bus.set({ main: self.progress, mainActive: self.isActive });
        if (self.isActive) onCurrent(index);
      },
    });
    const enter = ScrollTrigger.create({
      trigger: outer,
      start: "top bottom",
      end: "top top",
      scrub: true,
      onUpdate: (self) => bus.set({ enter: self.progress, enterActive: self.isActive }),
      onToggle: (self) => bus.set({ enter: self.progress, enterActive: self.isActive }),
    });
    const exit = ScrollTrigger.create({
      trigger: outer,
      start: "bottom bottom",
      end: "bottom top",
      scrub: true,
      onUpdate: (self) => bus.set({ exit: self.progress, exitActive: self.isActive }),
      onToggle: (self) => bus.set({ exit: self.progress, exitActive: self.isActive }),
    });

    const seed = () => {
      bus.set({
        main: main.progress,
        mainActive: main.isActive,
        enter: enter.progress,
        enterActive: enter.isActive,
        exit: exit.progress,
        exitActive: exit.isActive,
        vw: sticky.clientWidth || bus.value.vw,
        vh: sticky.clientHeight || bus.value.vh,
      });
      if (main.isActive) onCurrent(index);
    };
    seed();
    ScrollTrigger.addEventListener("refresh", seed);

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r && r.width > 0 && r.height > 0) bus.set({ vw: r.width, vh: r.height });
      });
      ro.observe(sticky);
    }

    return () => {
      ScrollTrigger.removeEventListener("refresh", seed);
      ro?.disconnect();
      main.kill();
      enter.kill();
      exit.kill();
    };
  }, [bus, index, onCurrent]);

  // ── bus → DOM (layers, text, props) ─────────────────────────────────────
  const beatCount = scene.beats.length;
  const hasKicker = Boolean(scene.kicker);
  useEffect(() => {
    const sticky = stickyRef.current;
    const frame = frameRef.current;
    const stage = stageRef.current;
    if (!sticky || !frame || !stage) return;

    const reduced = prefersReducedMotion();
    const tw = textWindow(enterKind, exitKind);
    const walkPainter = catCanvasRef.current ? new WalkPainter(catCanvasRef.current) : null;
    let walkTimer = 0;

    const setWalking = (on: boolean) => {
      const cat = catRef.current;
      if (!cat) return;
      if (on && !reduced) {
        cat.classList.add(tr.walk);
        window.clearTimeout(walkTimer);
        walkTimer = window.setTimeout(() => cat.classList.remove(tr.walk), 240);
      } else {
        window.clearTimeout(walkTimer);
        cat.classList.remove(tr.walk);
      }
    };

    const applyText = (main: number) => {
      const text = textRef.current;
      if (!text) return;
      const u = span(main, tw.inStart, tw.outStart);
      const leave = span(main, tw.outStart, Math.min(1, tw.outStart + 0.08));
      const block = reduced ? (leave > 0 ? 0 : 1) : 1 - leave;
      const on = main > 0 && main < 1 && u > 0 && block > 0;
      text.classList.toggle(styles.textBlockOn, on);
      if (!on) {
        if (textShadeRef.current) textShadeRef.current.style.opacity = "0";
        return;
      }
      const kickerF = reduced ? (u > 0.02 ? 1 : 0) : span(u, 0, 0.08);
      const titleF = reduced ? (u > 0.03 ? 1 : 0) : span(u, 0.03, 0.12);
      if (kickerRef.current) fadeStyle(kickerRef.current, kickerF * block, reduced);
      if (titleRef.current) fadeStyle(titleRef.current, titleF * block, reduced);
      if (textShadeRef.current) textShadeRef.current.style.opacity = String(Math.max(kickerF, titleF) * block);

      const ub = span(main, tw.inStart + 0.1, tw.outStart);
      const n = beatCount;
      for (let k = 0; k < n; k++) {
        const el = beatRefs.current[k];
        if (!el) continue;
        const a = k / (n + 1);
        const b = (k + 1) / (n + 1) + 0.15;
        const last = k === n - 1;
        const fin = span(ub, a, a + 0.12);
        const fout = last ? 1 : 1 - span(ub, b - 0.12, b);
        let o: number;
        let y: number;
        if (reduced) {
          o = fin >= 0.5 && fout >= 0.5 ? 1 : 0;
          y = 0;
        } else {
          o = Math.min(fin, fout);
          y = (1 - fin) * 12 - (1 - fout) * 12;
        }
        el.style.opacity = String(o * block);
        el.style.transform = `translate3d(0, ${y}px, 0)`;
      }
    };

    const applyWalk = (phase: ScenePhase, t: number, main: number, vw: number, vh: number) => {
      const wrap = catWrapRef.current;
      if (!wrap) return;
      let side: 1 | -1 = 1;
      let p = 1;
      let opacity = 0;
      let moving = false;
      if (phase === "enter") {
        if (t < WALK_OUT_END) {
          side = -1;
          p = span(t, 0, WALK_OUT_END);
          opacity = 1;
          moving = true;
        } else if (t >= WALK_IN_START) {
          side = 1;
          p = span(t, WALK_IN_START, 1);
          opacity = 1;
          moving = true;
        }
      } else if (phase === "main") {
        side = 1;
        p = 1;
        opacity = 1 - span(main, 0.03, 0.12);
      }
      const visible = opacity > 0.001;
      wrap.style.visibility = visible ? "" : "hidden";
      if (!visible) {
        setWalking(false);
        return;
      }
      const edges = cardEdges(side, vw);
      const cardW = edges.right - edges.left;
      const cardH = vh * CARD.scale;
      const cardBottom = vh * 0.5 + cardH / 2;
      wrap.style.left = `${edges.left}px`;
      wrap.style.right = `${vw - edges.right}px`;
      wrap.style.opacity = String(opacity);

      const canvas = catCanvasRef.current;
      if (walkPainter && canvas) {
        // The clip is contain-fitted into the card, bottom-aligned, hugging
        // the edge she crosses: right edge on the way out, left on the way in.
        const ws = walkSeqRef.current;
        const cw = ws.width || 720;
        const ch = ws.height || 1280;
        const s = Math.min(cardW / cw, cardH / ch);
        const w = cw * s;
        const h = ch * s;
        const left = side < 0 ? cardW - w : 0;
        const top = cardBottom - h;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        walkPainter.paint(ws, side < 0 ? 0.5 + 0.5 * p : 0.5 * p, w, h);
        return;
      }

      const cat = catRef.current;
      if (!cat) return;
      const catW = clamp(vw * 0.3, 96, 180);
      const catH = catW * (92 / 130);
      const x = side < 0 ? lerp(cardW / 2 - catW / 2, cardW, p) : lerp(-catW, cardW / 2 - catW / 2, p);
      const top = vh * CARD.catFloor - catH;
      cat.style.width = `${catW}px`;
      cat.style.height = `${catH}px`;
      cat.style.transform = `translate3d(${x}px, ${top}px, 0)`;
      setWalking(moving);
    };

    const applyFall = (phase: ScenePhase, t: number, main: number, vw: number, vh: number) => {
      const rain = rainRef.current;
      const flyer = flyerRef.current;
      if (!rain || !flyer) return;
      if (phase === "enter") {
        const fw = clamp(vw * 0.32, 110, 170);
        const fh = (fw * 4) / 3;
        const e = t * t * 0.45 + t * 0.55; // a touch of gravity
        const y = lerp(-1.25 * fh, vh + 0.35 * fh, e);
        const x = vw * 0.5 - fw / 2 + Math.sin(t * Math.PI * 2.2) * vw * 0.14;
        const rot = -14 + t * 372;
        flyer.style.visibility = "";
        flyer.style.width = `${fw}px`;
        flyer.style.height = `${fh}px`;
        flyer.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
        rain.style.visibility = "";
        rain.style.opacity = String(0.9 * smoothstep(span(t, 0, 0.2)));
        rain.style.transform = `translate3d(0, ${t * 42}%, 0)`;
      } else if (phase === "main" && main < 0.16) {
        flyer.style.visibility = "hidden";
        rain.style.visibility = "";
        rain.style.opacity = String(0.9 * (1 - span(main, 0.02, 0.14)));
        rain.style.transform = "translate3d(0, 42%, 0)";
      } else {
        flyer.style.visibility = "hidden";
        rain.style.visibility = "hidden";
      }
    };

    const apply = (v: SceneProgress) => {
      const phase = phaseOf(v);
      const t = phase === "enter" ? v.enter : phase === "exit" ? v.exit : 0;
      const L = computeLayers({ phase, t, main: v.main, vw: v.vw, vh: v.vh, enterKind, exitKind });

      frame.style.transform = `translate3d(0, ${L.frameY}px, 0)`;
      frame.style.opacity = String(L.frameOpacity);
      const st = L.stage;
      stage.style.transform = `translate3d(${st.x}px, ${st.y}px, 0) scale(${st.scale}) rotate(${st.rotate}deg)`;
      stage.style.borderRadius = `${st.radius}px`;
      stage.style.filter = st.blur > 0.05 ? `blur(${st.blur}px)` : "none";
      if (borderRef.current) borderRef.current.style.opacity = String(st.border);
      if (shadeRef.current) shadeRef.current.style.opacity = String(L.shade);

      const live = v.enterActive || v.mainActive || v.exitActive;
      sticky.classList.toggle(styles.live, live);

      const overlay = overlayRef.current;
      if (overlay) {
        const overlayY = phase === "enter" ? -(1 - t) * v.vh : phase === "exit" ? t * v.vh : 0;
        overlay.style.transform = `translate3d(0, ${overlayY}px, 0)`;
        overlay.style.visibility = phase === "before" || phase === "after" ? "hidden" : "";
      }

      applyText(v.main);
      if (enterKind === KIND_WALK) applyWalk(phase, t, v.main, v.vw, v.vh);
      else if (enterKind === KIND_FALL) applyFall(phase, t, v.main, v.vw, v.vh);
    };

    const off = bus.subscribe(apply);
    apply(bus.value);

    // A walk frame landing may change which frame is nearest; repaint in place.
    const offWalk = walkMode === "sequence" ? walkSeqRef.current.subscribe(() => apply(bus.value)) : undefined;

    return () => {
      off();
      offWalk?.();
      window.clearTimeout(walkTimer);
    };
  }, [bus, enterKind, exitKind, beatCount, hasKicker, walkMode]);

  const pin = scene.pinLength ?? 2;
  const outerStyle = { "--pin": pin } as CSSProperties;
  const cutoutStyle: CSSProperties | undefined =
    walkMode === "png" && cutout
      ? {
          backgroundImage: `url("${cutout}")`,
          backgroundSize: "contain",
          backgroundPosition: "bottom center",
          backgroundRepeat: "no-repeat",
          filter: "drop-shadow(0 10px 12px rgba(0, 0, 0, 0.45))",
        }
      : undefined;

  return (
    <section
      ref={outerRef}
      className={styles.outer}
      style={outerStyle}
      data-scene={scene.id}
      data-scene-index={index}
      aria-label={scene.title}
    >
      <div ref={stickyRef} className={styles.sticky}>
        <div ref={frameRef} className={styles.frame}>
          <div ref={stageRef} className={styles.stage}>
            <SceneCanvas seq={seq} bus={bus} sceneId={scene.id} index={index} />
            <div ref={borderRef} className={styles.cardBorder} aria-hidden />
          </div>
          <div ref={shadeRef} className={styles.shade} aria-hidden />
          <div ref={textShadeRef} className={styles.textShade} aria-hidden />
          <div ref={textRef} className={styles.textBlock}>
            <div className={styles.textInner}>
              {scene.kicker ? (
                <p ref={kickerRef} className={styles.kicker}>
                  {scene.kicker}
                </p>
              ) : null}
              <h2 ref={titleRef} className={`${styles.title} font-display`}>
                {scene.title}
              </h2>
              <div className={styles.beats}>
                {scene.beats.map((beat, k) => (
                  <p
                    key={k}
                    ref={(el) => {
                      beatRefs.current[k] = el;
                    }}
                    className={styles.beat}
                  >
                    {beat}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>

        {enterKind === KIND_WALK || enterKind === KIND_FALL ? (
          <div ref={overlayRef} className={styles.overlay} aria-hidden>
            {enterKind === KIND_WALK ? (
              <div ref={catWrapRef} className={tr.catWrap} style={{ left: 0, right: 0, visibility: "hidden" }}>
                {walkMode === "sequence" ? (
                  <canvas ref={catCanvasRef} className={tr.cat} />
                ) : walkMode === "png" ? (
                  <div ref={catRef} className={tr.cat} style={cutoutStyle} />
                ) : (
                  <div ref={catRef} className={tr.cat}>
                    <CatSilhouette />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div ref={rainRef} className={tr.rain} style={{ visibility: "hidden" }} />
                <div ref={flyerRef} className={tr.flyer} style={{ visibility: "hidden" }}>
                  <MissingFlyer />
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
