/**
 * SwipeEngine: plays the landing story.
 *
 * One playhead (seconds) moves between stops (timeline.ts). Gestures pick
 * where it goes; every frame is drawn from the playhead alone, so playing
 * backwards and scrubbing need no special cases.
 *
 *   swipe up · wheel down · ↓ · Space · PageDown   play on to the next stop
 *   swipe down · wheel up · ↑ · PageUp             back to the previous stop
 *   a second swipe the same way while moving       hurry
 *   press and hold (250 ms, still)                 pause; drag to scrub
 *   release                                        carry on to where it was going
 *
 * The page around it has three modes, read from the scroll position:
 *
 *   intro     the hero is on screen and the stage sits under it, playing
 *             chapter 1. Nothing scrolls natively: the first swipe glides the
 *             stage up to fill the screen (and moves on if chapter 1 is done).
 *   engaged   the stage fills the screen and owns every swipe, wheel and key.
 *   released  after the last stop, or Skip: the page scrolls normally again.
 *             Scrolling back above the stage starts chapter 1 again.
 *
 * No React state changes per frame: the loop writes canvas pixels and inline
 * styles, and flips a few data attributes on the stage for CSS.
 */
import { getLenis } from "@/components/smooth/SmoothScroll";
import { cappedDpr, clamp, prefersReducedMotion } from "@/components/story/motion";
import type { LandingChapter } from "@/config/story";
import { useUi } from "@/lib/store";
import { StoryMedia } from "./media";
import {
  flightInset,
  renderCaptions,
  renderFlight,
  renderFlyer,
  renderKittens,
  renderMood,
  renderRail,
  type OverlayEls,
} from "./overlays";
import { StagePainter, computeLayout, type StageLayout } from "./painter";
import { StoryReport } from "./report";
import { buildTimeline, canvasView, spanIndexAt, stopIndexAt, type Timeline } from "./timeline";

export interface EngineEls extends OverlayEls {
  stage: HTMLElement;
  canvas: HTMLCanvasElement;
  bottom: HTMLElement;
  splash: HTMLElement;
  splashBar: HTMLElement;
  skip: HTMLButtonElement;
  live: HTMLElement;
  kittenImages: HTMLImageElement[];
}

type Mode = "intro" | "engaged" | "released";

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  at: number;
  onStage: boolean;
  moved: boolean;
  held: boolean;
}

interface Hold {
  t0: number;
  x0: number;
  y0: number;
  /** Seconds one screen of drag moves through, backwards and forwards. */
  back: number;
  fwd: number;
  wasHeading: number | null;
}

const HOLD_MS = 250;
const SPLASH_AFTER_MS = 400;
/** Stop waiting for the chat image's decode() (it has been seen never to settle). */
const CHAT_WAIT_MS = 3000;
/** After this, start with whatever has arrived; playback waits for the rest frame by frame. */
const START_ANYWAY_MS = 7000;
const RATE = { forward: 1, hurry: 2.2, back: 2.5 };
const SCROLL_MS = { engage: 650, release: 900 };

const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function interactive(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  return Boolean(el?.closest("a, button, input, select, textarea, [role='dialog'], [data-story-ignore]"));
}

export class SwipeEngine {
  private readonly reduced = prefersReducedMotion();
  private readonly media: StoryMedia;
  private readonly painter: StagePainter;
  private readonly report: StoryReport;
  /** The furthest stop reached this visit (-1: none), for the story report. */
  private furthest = -1;
  private tl: Timeline | null = null;
  private layout: StageLayout;
  private layoutDirty = true;

  private t = 0;
  private target: number | null = null;
  private hurry = false;
  private started = false;
  private mode: Mode = "intro";
  private released = false;
  private scrolling = false;

  private raf = 0;
  private lastTick = 0;
  private lastDrawn = "";
  private gesture: Gesture | null = null;
  private hold: Hold | null = null;
  private holdTimer = 0;
  private wheel = { acc: 0, last: 0, spent: false };
  private hintTimer = 0;
  private splashTimer = 0;
  private chatTimer = 0;
  private watchdog = 0;
  private bootAt = 0;
  private firstFrameAt = 0;
  private chatReady = false;
  /** Which way the last scrub went, so the decode window leads that way. */
  private scrubDir = 1;
  private drawFailed = false;
  private announced = -1;
  private destroyed = false;
  private cleanups: (() => void)[] = [];

  constructor(
    private readonly els: EngineEls,
    private readonly chapters: LandingChapter[],
  ) {
    this.media = new StoryMedia(chapters);
    this.painter = new StagePainter(els.canvas);
    this.layout = computeLayout(1, 1, 1, 1);
    this.report = new StoryReport(this.reduced);
    this.report.attach(() => ({
      started: this.started,
      mode: this.mode,
      t: this.t,
      furthest: this.furthest,
      media: this.media.stats(),
    }));
  }

  // ─── life cycle ───────────────────────────────────────────────────────────

  start(): void {
    this.listen();
    this.syncMode();
    this.setLocked(!this.released);
    this.els.stage.dataset.reduced = String(this.reduced);
    this.splashTimer = window.setTimeout(() => {
      if (!this.started) this.setSplash(true);
    }, SPLASH_AFTER_MS);
    this.kick();
    void this.boot();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.holdTimer);
    window.clearTimeout(this.hintTimer);
    window.clearTimeout(this.splashTimer);
    window.clearTimeout(this.chatTimer);
    window.clearTimeout(this.watchdog);
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.report.destroy();
    this.media.destroy();
    this.setLocked(false);
  }

  private async boot(): Promise<void> {
    this.bootAt = performance.now();
    // The chat should be decoded before it flies, but never hold the story
    // hostage to it: whichever comes first, decode() settling or a timeout.
    const chat = this.els.chat as HTMLImageElement;
    const chatDone = () => {
      if (this.chatReady) return;
      this.chatReady = true;
      window.clearTimeout(this.chatTimer);
      this.onMedia();
    };
    if (typeof chat.decode === "function") chat.decode().then(chatDone, chatDone);
    else chatDone();
    this.chatTimer = window.setTimeout(chatDone, CHAT_WAIT_MS);
    this.watchdog = window.setTimeout(this.onMedia, START_ANYWAY_MS + 50);

    await this.media.init();
    if (this.destroyed) return;
    this.tl = buildTimeline(this.chapters, this.media.clips, this.reduced);
    this.placeRailDots();
    this.cleanups.push(this.media.subscribe(this.onMedia));
    void this.media.loadFinals();
    this.updateResidency();
    this.onMedia();
  }

  /** Something decoded: maybe start, maybe redraw. */
  private onMedia = (): void => {
    if (this.destroyed || !this.tl) return;
    if (!this.started) {
      this.updateSplash();
      if (this.readyToStart()) this.begin();
      return;
    }
    this.kick();
  };

  private readyToStart(): boolean {
    const tl = this.tl!;
    const first = tl.spans[0];
    if (!first.clip) return true; // a stand-in needs nothing
    // Slow or stuck: start with anything at all to show; playback waits for each frame.
    const late = performance.now() - this.bootAt > START_ANYWAY_MS;
    if (this.reduced) return this.media.hasFinal(0) || (late && this.media.decodedPrefix(0) > 0);
    if (late) return this.media.decodedPrefix(0) > 0 || this.media.hasFinal(0);
    if (!this.chatReady && tl.spans.some((s) => s.enter === "whatsapp")) return false;
    const n = first.clip.frames;
    if (this.media.decodedPrefix(0) < Math.min(n, 4)) return false;
    const have = this.media.fetchedPrefix(0);
    if (have >= n) return true;
    if (have < Math.min(n, 24)) return false;
    // Start early only if the rest will arrive before playback needs it.
    if (!this.firstFrameAt) return false;
    const elapsed = (performance.now() - this.firstFrameAt) / 1000;
    const rate = have / Math.max(0.05, elapsed);
    const playback = first.clipEnd - first.clipStart;
    return (n - have) / rate < (have / n) * playback * 0.8;
  }

  private updateSplash(): void {
    const tl = this.tl;
    const clip = tl?.spans[0].clip;
    if (!clip) return;
    const have = this.reduced ? (this.media.hasFinal(0) ? 1 : 0) : this.media.fetchedPrefix(0);
    if (have && !this.firstFrameAt) this.firstFrameAt = performance.now();
    const need = this.reduced ? 1 : clip.frames;
    const p = (have + (this.chatReady ? 1 : 0)) / (need + 1);
    this.els.splashBar.style.transform = `scaleX(${clamp(p, 0, 1)})`;
  }

  private begin(): void {
    this.started = true;
    this.report.started(this.els.stage.dataset.splash === "true");
    window.clearTimeout(this.splashTimer);
    window.clearTimeout(this.watchdog);
    this.setSplash(false);
    const tl = this.tl!;
    this.els.stage.dataset.ready = "true";
    // The kitten photos only once chapter 1 is safely playing.
    this.els.kittenImages.forEach((img) => {
      if (!img.getAttribute("src") && img.dataset.src) img.src = img.dataset.src;
    });
    if (this.released) {
      this.t = tl.end;
      this.target = null;
    } else {
      this.t = 0;
      this.goTo(tl.stops[0]);
    }
    this.updateResidency();
    this.kick();
  }

  private setSplash(on: boolean): void {
    this.els.stage.dataset.splash = String(on);
  }

  // ─── playback ─────────────────────────────────────────────────────────────

  private kick(): void {
    if (this.raf || this.destroyed) return;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTick) / 1000));
    this.lastTick = now;
    const tl = this.tl;
    let again = false;
    if (tl && this.started && this.target !== null && !this.hold) {
      const dir = Math.sign(this.target - this.t);
      const rate = dir > 0 ? (this.hurry ? RATE.hurry : RATE.forward) : RATE.back * (this.hurry ? 1.6 : 1);
      const next = this.t + dir * rate * dt;
      if (dir === 0 || (dir > 0 ? next >= this.target : next <= this.target)) {
        this.t = this.target;
        this.arrive();
      } else if (dir > 0 && !this.frameReady(next)) {
        again = true; // wait for the frame rather than show the wrong one
      } else {
        this.t = next;
        again = true;
      }
      // The decode window follows the playhead (a no-op until it crosses a frame).
      this.updateResidency();
    }
    this.render();
    if (again) this.kick();
  };

  /** Is the frame needed at time t decoded? */
  private frameReady(t: number): boolean {
    const tl = this.tl!;
    const s = tl.spans[spanIndexAt(tl, t)];
    if (!s.clip || t < s.clipStart || t > s.clipEnd) return true;
    const pos = ((t - s.clipStart) / Math.max(0.001, s.clipEnd - s.clipStart)) * (s.clip.frames - 1);
    return this.media.has(s.index, Math.min(s.clip.frames - 1, Math.floor(pos) + 1));
  }

  private goTo(stop: number): void {
    this.target = stop;
    this.hurry = false;
    this.setHint(false);
    this.updateResidency();
    this.kick();
  }

  private arrive(): void {
    const tl = this.tl!;
    this.target = null;
    this.hurry = false;
    const k = stopIndexAt(tl, this.t);
    if (k >= 0) {
      this.furthest = Math.max(this.furthest, k);
      this.announce(k);
      this.scheduleHint();
    }
    this.updateResidency();
  }

  /**
   * Point the decode window at the playhead: frames around it in the chapter
   * on screen, leading the way it is moving, plus the start of the chapter it
   * plays next. Every chapter's final frame is kept separately, so stops,
   * stand-ins and the chat flight never need a whole clip decoded (media.ts).
   */
  private updateResidency(): void {
    const tl = this.tl;
    if (!tl || this.reduced) return;
    const here = spanIndexAt(tl, this.t);
    const s = tl.spans[here];
    const moving = this.hold ? this.scrubDir : Math.sign((this.target ?? this.t) - this.t);
    const dir = moving < 0 ? -1 : 1;
    const pos = s.clip ? clamp((this.t - s.clipStart) / Math.max(0.001, s.clipEnd - s.clipStart), 0, 1) * (s.clip.frames - 1) : 0;
    let next = -1;
    for (let k = here + dir; k >= 0 && k < tl.spans.length; k += dir) {
      if (tl.spans[k].clip) {
        next = k;
        break;
      }
    }
    this.media.focus({ chapter: s.clip ? here : -1, pos, dir, next });
  }

  private nextStopAfter(t: number): number | null {
    return this.tl!.stops.find((s) => s > t + 1e-3) ?? null;
  }

  private prevStopBefore(t: number): number | null {
    const before = this.tl!.stops.filter((s) => s < t - 1e-3);
    return before.length ? before[before.length - 1] : null;
  }

  // ─── intents ──────────────────────────────────────────────────────────────

  forward(): void {
    const tl = this.tl;
    if (this.released) return;
    this.report.swipe();
    if (!tl || !this.started) {
      // Still loading: bring the stage (its splash and Skip) up; chapter 1
      // starts full screen as soon as it can.
      if (this.mode === "intro") this.engage();
      return;
    }
    this.setHint(false);
    const last = tl.stops.length - 1;
    if (this.mode === "intro") {
      const k = this.target === null ? stopIndexAt(tl, this.t) : -1;
      this.engage();
      if (k >= 0 && k < last) this.goTo(tl.stops[k + 1]);
      return;
    }
    if (this.target !== null) {
      if (this.target > this.t) this.hurry = true;
      else this.goTo(this.nextStopAfter(this.t) ?? tl.end);
      return;
    }
    if (stopIndexAt(tl, this.t) === last || this.t >= tl.end) {
      this.release();
      return;
    }
    this.goTo(this.nextStopAfter(this.t) ?? tl.end);
  }

  back(): void {
    const tl = this.tl;
    if (!tl || this.released) return;
    if (this.mode === "intro") {
      // Part-way down from the hero: back to the very top.
      if (window.scrollY > 2) this.disengage();
      return;
    }
    this.setHint(false);
    if (!this.started) {
      this.disengage();
      return;
    }
    if (this.target !== null && this.target < this.t) {
      this.hurry = true;
      return;
    }
    const prev = this.prevStopBefore(this.t);
    if (prev === null) {
      // Before the first stop, or on it: back up to the hero.
      this.disengage();
      return;
    }
    this.goTo(prev);
  }

  /** Skip the story: rest on a stop and hand the page back. */
  skip = (): void => {
    const tl = this.tl;
    if (tl && this.started) {
      const next = this.target !== null ? Math.max(this.target, this.t) : this.t;
      const k = tl.stops.findIndex((s) => s >= next - 1e-3);
      this.t = k >= 0 ? tl.stops[k] : tl.end;
      this.target = null;
    }
    this.release();
  };

  // ─── page modes ───────────────────────────────────────────────────────────

  private stageTop(): number {
    return this.els.stage.getBoundingClientRect().top + window.scrollY;
  }

  private engage(): void {
    if (this.mode === "engaged") return;
    this.scrollTo(this.stageTop(), SCROLL_MS.engage);
  }

  private disengage(): void {
    this.scrollTo(0, SCROLL_MS.engage);
  }

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.target = null;
    this.hold = null;
    this.setHint(false);
    this.setMode("released");
    this.setLocked(false);
    this.layoutDirty = true;
    this.scrollTo(this.stageTop() + this.els.stage.offsetHeight, SCROLL_MS.release);
    this.kick();
  }

  /** Read the mode from the scroll position (after any scroll we did not start). */
  private syncMode(): void {
    const y = window.scrollY;
    const top = this.stageTop();
    if (this.released) {
      if (y < top - 4) {
        // Back above the stage: the story starts again under the hero.
        this.released = false;
        this.setLocked(true);
        this.setMode("intro");
        if (this.started && this.tl) {
          this.t = 0;
          this.announced = -1;
          this.goTo(this.tl.stops[0]);
        }
      }
    } else if (y > top + 24) {
      // Below the stage some other way (the menu's "Scroll to bottom", a scrollbar, a restored scroll).
      this.released = true;
      this.setLocked(false);
      this.setMode("released");
      if (this.started && this.tl && this.target !== null) {
        this.t = this.target;
        this.target = null;
      }
    } else {
      // At the very top with the stage there too, nothing has pushed it down
      // yet (the hero loads separately): that is still the intro.
      this.setMode(y < top - 2 || (y <= 2 && top <= 2) ? "intro" : "engaged");
    }
    this.layoutDirty = true;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    if (this.els.stage.dataset.mode !== mode) this.els.stage.dataset.mode = mode;
  }

  /** While the story owns the page, touch panning and overscroll are off (pinch-zoom stays). */
  private setLocked(on: boolean): void {
    if (typeof document === "undefined") return;
    document.documentElement.style.overscrollBehavior = on ? "none" : "";
    document.body.style.touchAction = on ? "pinch-zoom" : "";
  }

  private scrollTo(y: number, ms: number): void {
    const finish = () => {
      this.scrolling = false;
      this.syncMode();
      this.kick();
    };
    this.scrolling = true;
    const lenis = getLenis();
    if (this.reduced || ms <= 0) {
      window.scrollTo(0, y);
      finish();
      return;
    }
    if (lenis) {
      try {
        lenis.scrollTo(y, { duration: ms / 1000, easing: easeInOutCubic, force: true, lock: true, onComplete: finish });
        return;
      } catch {
        /* fall through to the manual scroll */
      }
    }
    const y0 = window.scrollY;
    const t0 = performance.now();
    const step = (now: number) => {
      if (this.destroyed) return;
      const p = Math.min(1, (now - t0) / ms);
      window.scrollTo(0, y0 + (y - y0) * easeInOutCubic(p));
      if (p < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  }

  // ─── input ────────────────────────────────────────────────────────────────

  private listen(): void {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      window.addEventListener(type, fn, opts);
      this.cleanups.push(() => window.removeEventListener(type, fn, opts));
    };
    on("wheel", this.onWheel, { passive: false, capture: true });
    on("keydown", this.onKey);
    on("pointerdown", this.onPointerDown, { passive: true });
    on("pointermove", this.onPointerMove, { passive: true });
    on("pointerup", this.onPointerUp, { passive: true });
    on("pointercancel", this.onPointerCancel, { passive: true });
    on("scroll", this.onScroll, { passive: true });
    on("resize", this.onResize);

    const stage = this.els.stage;
    // While the story owns the page, one-finger touch moves never scroll it
    // natively, wherever they start (the hero too). touch-action on <body>
    // should already say so; iOS gets this as well, because a native scroll
    // there cancels the pointer (no swipe) and carries the page past the story.
    const block = (e: TouchEvent) => {
      if (this.released || e.touches.length > 1 || !e.cancelable) return;
      if (useUi.getState().drawerOpen) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("[data-lenis-prevent], [role='dialog'], input, textarea, select")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    this.cleanups.push(() => document.removeEventListener("touchmove", block));

    // Back from another tab or app, or from the back/forward cache: the decode
    // window was given back while hidden, and iOS may have dropped the
    // canvas's pixels, so load and draw again.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        this.media.suspend();
        return;
      }
      this.media.resume();
      this.redraw();
    };
    document.addEventListener("visibilitychange", onVisibility);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
    const onPageShow = () => {
      this.media.resume();
      if (!this.scrolling) this.syncMode();
      this.redraw();
    };
    on("pageshow", onPageShow);
    const canvas = this.els.canvas;
    canvas.addEventListener("contextrestored", this.redraw);
    this.cleanups.push(() => canvas.removeEventListener("contextrestored", this.redraw));

    const onSkip = (e: Event) => {
      e.preventDefault();
      this.skip();
    };
    this.els.skip.addEventListener("click", onSkip);
    this.cleanups.push(() => this.els.skip.removeEventListener("click", onSkip));

    if (typeof ResizeObserver === "function") {
      // The body grows when the hero mounts above the stage; the stage itself
      // changes with the viewport.
      const ro = new ResizeObserver(() => this.onResize());
      ro.observe(stage);
      ro.observe(document.body);
      this.cleanups.push(() => ro.disconnect());
    }
  }

  private onScroll = (): void => {
    this.layoutDirty = true;
    if (!this.scrolling) this.syncMode();
    this.kick();
  };

  private onResize = (): void => {
    this.layoutDirty = true;
    if (!this.scrolling) {
      // Keep an engaged stage exactly on screen when the viewport (and the
      // hero's dvh height with it) changes; otherwise re-read where we are,
      // e.g. once the hero has mounted above the stage.
      if (this.mode === "engaged") window.scrollTo(0, this.stageTop());
      else this.syncMode();
    }
    this.kick();
  };

  private onWheel = (e: WheelEvent): void => {
    if (this.released || useUi.getState().drawerOpen || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    const now = performance.now();
    // One gesture = one move: a trackpad's momentum tail keeps the gesture
    // alive until the wheel has been quiet for a moment.
    if (now - this.wheel.last > 240) {
      this.wheel.acc = 0;
      this.wheel.spent = false;
    }
    this.wheel.last = now;
    if (this.wheel.spent) return;
    this.wheel.acc += dy;
    if (Math.abs(this.wheel.acc) >= 40) {
      this.wheel.spent = true;
      if (this.wheel.acc > 0) this.forward();
      else this.back();
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (this.released || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (useUi.getState().drawerOpen) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
    let dir = 0;
    switch (e.key) {
      case "ArrowDown":
      case "PageDown":
        dir = 1;
        break;
      case "ArrowUp":
      case "PageUp":
        dir = -1;
        break;
      case " ":
      case "Spacebar":
        if (el?.closest("button, a")) return;
        dir = e.shiftKey ? -1 : 1;
        break;
      case "End":
        e.preventDefault();
        this.skip();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (e.repeat) return;
    if (dir > 0) this.forward();
    else this.back();
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (this.released || !e.isPrimary || e.button > 0 || useUi.getState().drawerOpen) return;
    if (interactive(e.target)) return;
    const onStage = e.target instanceof Node && this.els.stage.contains(e.target);
    // Swipes start anywhere while the hero shows; holds only on the stage.
    if (!onStage && this.mode !== "intro") return;
    this.gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, at: performance.now(), onStage, moved: false, held: false };
    window.clearTimeout(this.holdTimer);
    if (onStage) this.holdTimer = window.setTimeout(this.beginHold, HOLD_MS);
  };

  private onPointerMove = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX;
    g.y = e.clientY;
    if (g.held) {
      this.scrub();
      return;
    }
    if (!g.moved && Math.hypot(g.x - g.x0, g.y - g.y0) > 10) {
      g.moved = true;
      window.clearTimeout(this.holdTimer);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    window.clearTimeout(this.holdTimer);
    this.gesture = null;
    if (g.held) {
      this.endHold();
      return;
    }
    const dx = g.x - g.x0;
    const dy = g.y - g.y0;
    const speed = Math.abs(dy) / Math.max(1, performance.now() - g.at);
    if (Math.abs(dy) > Math.abs(dx) * 1.1 && (Math.abs(dy) > 36 || (Math.abs(dy) > 16 && speed > 0.35))) {
      if (dy < 0) this.forward();
      else this.back();
    }
  };

  private onPointerCancel = (e: PointerEvent): void => {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    window.clearTimeout(this.holdTimer);
    this.gesture = null;
    if (g.held) this.endHold();
  };

  private beginHold = (): void => {
    const g = this.gesture;
    const tl = this.tl;
    if (!g || g.moved || !g.onStage || !tl || !this.started || this.released) return;
    g.held = true;
    // One screen of drag ≈ one chapter: the stretch between the stops the
    // playhead sits between (on a stop, the chapter behind for dragging back
    // and the one ahead for dragging on).
    const bounds = [0, ...tl.stops];
    const prev = [...bounds].reverse().find((b) => b < this.t - 1e-3) ?? 0;
    const next = bounds.find((b) => b > this.t + 1e-3) ?? tl.end;
    const onStop = bounds.find((b) => Math.abs(b - this.t) <= 1e-3);
    const back = onStop !== undefined ? this.t - prev : next - prev;
    const fwd = onStop !== undefined ? next - this.t : next - prev;
    this.hold = { t0: this.t, x0: g.x, y0: g.y, back: Math.max(2, back), fwd: Math.max(2, fwd), wasHeading: this.target };
    this.setHint(false);
    this.els.stage.dataset.holding = "true";
    this.kick();
  };

  private scrub(): void {
    const g = this.gesture;
    const h = this.hold;
    const tl = this.tl;
    if (!g || !h || !tl) return;
    const d = (g.x - h.x0 - (g.y - h.y0)) / Math.max(240, this.layout.view.h);
    const t = clamp(h.t0 + d * (d < 0 ? h.back : h.fwd), 0, tl.end);
    if (Math.abs(t - this.t) > 1e-4) this.scrubDir = t > this.t ? 1 : -1;
    this.t = t;
    // Scrubbing back into a chapter whose frames were let go loads them again.
    this.updateResidency();
    this.kick();
  }

  private endHold(): void {
    const h = this.hold;
    const tl = this.tl;
    this.hold = null;
    this.els.stage.dataset.holding = "false";
    if (!h || !tl) return;
    const k = tl.stops.findIndex((s) => Math.abs(s - this.t) < 0.08);
    if (k >= 0) {
      // Scrubbed onto a stop: stay there.
      this.t = tl.stops[k];
      this.target = null;
      this.arrive();
      this.kick();
      return;
    }
    if (h.wasHeading !== null) {
      this.goTo(h.wasHeading);
      return;
    }
    const next = this.t > h.t0 ? this.nextStopAfter(this.t) : this.prevStopBefore(this.t);
    this.goTo(next ?? (this.t > h.t0 ? tl.end : tl.stops[0]));
  }

  // ─── hint, announcements ──────────────────────────────────────────────────

  private scheduleHint(): void {
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => {
      if (this.target === null && !this.hold && !this.released) this.setHint(true);
    }, 700);
  }

  private setHint(on: boolean): void {
    if (!on) window.clearTimeout(this.hintTimer);
    const v = String(on);
    if (this.els.stage.dataset.hint !== v) this.els.stage.dataset.hint = v;
  }

  private announce(k: number): void {
    if (k === this.announced) return;
    this.announced = k;
    const c = this.chapters[k];
    this.els.live.textContent = `Chapter ${k + 1} of ${this.chapters.length}: ${c.title}. ${c.subtitle}`;
  }

  private placeRailDots(): void {
    const tl = this.tl!;
    this.els.railDots.forEach((dot, k) => {
      const s = tl.stops[k];
      if (s === undefined) return;
      dot.style.top = `${(tl.end > 0 ? s / tl.end : 0) * 100}%`;
    });
  }

  // ─── drawing ──────────────────────────────────────────────────────────────

  private measure(): StageLayout {
    const stage = this.els.stage;
    const W = stage.clientWidth || window.innerWidth;
    const H = stage.clientHeight || window.innerHeight;
    const top = stage.getBoundingClientRect().top;
    const visible = !this.released && top > 0 ? window.innerHeight - top : H;
    return computeLayout(W, H, visible, cappedDpr(2));
  }

  /** Draw again from scratch on the next frame. */
  private redraw = (): void => {
    this.layoutDirty = true;
    this.lastDrawn = "";
    this.kick();
  };

  private render(): void {
    try {
      this.paint();
    } catch (err) {
      // One bad frame must not stop the loop; try again on the next change.
      this.lastDrawn = "";
      if (!this.drawFailed) {
        this.drawFailed = true;
        console.warn("[story] draw failed", err);
        this.report.error(`draw: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    }
  }

  private paint(): void {
    if (this.layoutDirty) {
      this.layoutDirty = false;
      const next = this.measure();
      const L = this.layout;
      if (
        next.W !== L.W ||
        next.H !== L.H ||
        next.dpr !== L.dpr ||
        next.view.h !== L.view.h ||
        next.wide !== L.wide
      ) {
        this.layout = next;
        this.painter.resize(next);
        this.els.stage.dataset.wide = String(next.wide);
        const off = `${Math.max(0, next.H - next.view.h)}px`;
        this.els.bottom.style.bottom = off;
        this.els.splash.style.bottom = off;
        this.lastDrawn = "";
      }
    }
    const tl = this.tl;
    if (!tl || !this.started) return;
    const L = this.layout;
    const key = `${this.t.toFixed(4)}|${L.W}x${L.H}|${L.view.h}|${this.media.version}`;
    if (key === this.lastDrawn) return;
    this.lastDrawn = key;
    const t = this.t;
    this.painter.draw(canvasView(tl, t), L, this.media.frame, flightInset(tl, t, L));
    renderMood(this.els, tl, t);
    renderFlight(this.els, tl, t, L);
    renderKittens(this.els, tl, t, L);
    renderFlyer(this.els, tl, t, L);
    renderCaptions(this.els, tl, t, L);
    renderRail(this.els, tl, t, L);
  }

  /** For the verify harness: where the story is. */
  debugState(): {
    t: number;
    target: number | null;
    mode: Mode;
    stops: number[];
    started: boolean;
    holding: boolean;
    media: ReturnType<StoryMedia["stats"]>;
  } {
    return {
      t: this.t,
      target: this.target,
      mode: this.mode,
      stops: this.tl?.stops ?? [],
      started: this.started,
      holding: Boolean(this.hold),
      media: this.media.stats(),
    };
  }

  /** For the verify harness: park the playhead at t (screenshots of exact moments). */
  debugSeek(t: number): void {
    if (!this.tl) return;
    this.t = clamp(t, 0, this.tl.end);
    this.target = null;
    this.updateResidency();
    this.kick();
  }
}
