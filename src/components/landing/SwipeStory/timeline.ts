/**
 * The landing story as one timeline, in seconds, and what the stage shows at
 * any moment of it. Everything here is a pure function of the playhead `t`
 * (plus the chapters' clip lengths), so playing, playing backwards and
 * scrubbing are all the same thing: pick a t, draw it.
 *
 *   [ch1 clip][caption 1][STOP 1]
 *     [whatsapp flight][ch2 clip + kittens][caption 2][STOP 2]
 *       [flyer][ch3 clip or stand-in][caption 3][STOP 3]
 *         [crossfade][ch4 clip or stand-in][caption 4][STOP 4]
 *
 * With prefers-reduced-motion the same chapters become stills joined by short
 * crossfades: no clips, no flights, captions already set.
 */
import type { ChapterEntrance, LandingChapter } from "@/config/story";
import { clamp01, smoothstep, span as between } from "@/components/story/motion";

export interface ClipInfo {
  frames: number;
  width: number;
  height: number;
  /** Seconds of the source clip. */
  duration: number;
}

export interface Span {
  index: number;
  chapter: LandingChapter;
  /** Null while the chapter has no clip: it plays its stand-in. */
  clip: ClipInfo | null;
  /** The entrance actually used (the chat flight needs a frame to land on). */
  enter: ChapterEntrance;
  enterStart: number;
  clipStart: number;
  clipEnd: number;
  stop: number;
}

export interface Timeline {
  spans: Span[];
  stops: number[];
  end: number;
  reduced: boolean;
}

/** Seconds each entrance takes. */
export const ENTER_SECONDS: Record<ChapterEntrance, number> = {
  none: 0,
  whatsapp: 2.1,
  flyer: 1.3,
  crossfade: 0.9,
};

/** How long a stand-in holds the screen, and the pause after a clip before its stop. */
const STAND_IN_SECONDS = 2.4;
const TAIL = 0.4;
/** Chapter 2 needs longer after its clip: the kittens leave, then the words set. */
const KITTENS_TAIL = 1.7;
const REDUCED_FADE = 0.6;

/** Caption choreography (seconds). The title starts setting `lead` before the stop. */
export const CAPTION = { lead: 1.35, stagger: 0.045, letter: 0.6, subtitle: 0.7, out: 0.45 };

/**
 * The chat flight's beats, as fractions of the entrance: the chat airdrops in
 * while chapter 1's final frame shrinks into its photo (to `airdrop`), it is
 * read for a beat (to `hold`), then the camera zooms into the photo (to 1).
 */
export const FLIGHT = { airdrop: 0.4, hold: 0.7 };

export function buildTimeline(chapters: LandingChapter[], clips: (ClipInfo | null)[], reduced: boolean): Timeline {
  const spans: Span[] = [];
  let t = 0;
  chapters.forEach((chapter, index) => {
    const clip = clips[index] ?? null;
    const prev = spans[index - 1];
    let enter: ChapterEntrance = index === 0 ? "none" : chapter.enter === "none" ? "crossfade" : chapter.enter;
    if (enter === "whatsapp" && !prev?.clip) enter = "crossfade";
    if (reduced && index > 0) enter = "crossfade";
    const enterStart = t;
    const clipStart = enterStart + (reduced ? (index ? REDUCED_FADE : 0) : ENTER_SECONDS[enter]);
    const playback = reduced ? 0 : clip ? (chapter.playback ?? clip.duration) : STAND_IN_SECONDS;
    const clipEnd = clipStart + playback;
    const tail = reduced ? 0 : chapter.overlay === "kittens" && clip ? KITTENS_TAIL : TAIL;
    const stop = clipEnd + tail;
    spans.push({ index, chapter, clip, enter, enterStart, clipStart, clipEnd, stop });
    t = stop;
  });
  return { spans, stops: spans.map((s) => s.stop), end: t, reduced };
}

/** The chapter that owns time t: t sits in (previous stop, this stop]. */
export function spanIndexAt(tl: Timeline, t: number): number {
  for (let i = 0; i < tl.spans.length; i++) if (t <= tl.spans[i].stop + 1e-6) return i;
  return tl.spans.length - 1;
}

/** Index of the stop at t (within `eps`), or -1. */
export function stopIndexAt(tl: Timeline, t: number, eps = 1e-3): number {
  return tl.stops.findIndex((s) => Math.abs(s - t) <= eps);
}

// ─── the picture ─────────────────────────────────────────────────────────────

/** A clip frame: chapter index and a fractional frame position (blended). */
export interface FrameRef {
  chapter: number;
  pos: number;
}

export interface CanvasView {
  base: FrameRef | null;
  /** Drawn over the base with `mixAlpha` (crossfades). */
  mix: FrameRef | null;
  mixAlpha: number;
  /** Slow push-in, 1 = none. */
  zoom: number;
  /** 0..1 blend of a blurred copy of the whole picture. */
  blur: number;
  /** 0..1 black over everything. */
  dim: number;
  /** 0..1 winter-night blue (chapter 3's stand-in). */
  night: number;
  /**
   * The chat flight: 0..1 how far the frame has shrunk into the chat's photo.
   * The engine turns it into a rect (it needs the layout); the painter then
   * draws the frame there over a blurred, darkened copy of itself.
   */
  inset: number;
}

/** The final frame of chapter i, or of the closest chapter before it with a clip. */
export function finalRef(tl: Timeline, i: number): FrameRef | null {
  for (let k = Math.min(i, tl.spans.length - 1); k >= 0; k--) {
    const clip = tl.spans[k].clip;
    if (clip) return { chapter: k, pos: clip.frames - 1 };
  }
  return null;
}

/** What a chapter without a clip shows: the frame named in its config, else the previous chapter's end. */
export function standInRef(tl: Timeline, i: number): FrameRef | null {
  const want = tl.spans[i].chapter.standInFrame;
  if (want) {
    const k = tl.spans.findIndex((s) => s.chapter.id === want);
    if (k >= 0 && tl.spans[k].clip) return finalRef(tl, k);
  }
  return finalRef(tl, i - 1);
}

/** The picture a chapter rests on at its stop. */
export function stopRef(tl: Timeline, i: number): FrameRef | null {
  return tl.spans[i].clip ? finalRef(tl, i) : standInRef(tl, i);
}

/** Night, rain, warm river light and push-in carried by the stand-ins. */
export interface Mood {
  night: number;
  rain: number;
  river: number;
  zoom: number;
}

export function moodAt(tl: Timeline, t: number): Mood {
  let night = 0;
  let river = 0;
  let zoom = 1;
  for (const s of tl.spans) {
    if (t < s.enterStart) break;
    const len = Math.max(0.001, s.stop - s.enterStart);
    const u = clamp01((t - s.enterStart) / len);
    if (s.clip) {
      // A real clip clears whatever the stand-ins left behind, over its entrance.
      const k = tl.reduced ? smoothstep(between(t, s.enterStart, s.clipStart)) : smoothstep(between(t, s.enterStart, s.clipStart + 0.2));
      night *= 1 - k;
      river *= 1 - k;
      zoom = 1 + (zoom - 1) * (1 - k);
    } else if (s.chapter.standIn === "night") {
      const k = tl.reduced ? smoothstep(between(t, s.enterStart, s.clipStart)) : smoothstep(between(u, 0.2, 0.8));
      night = night + (1 - night) * k;
      river *= 1 - k;
      zoom = 1 + 0.06 * (tl.reduced ? k : u);
    } else {
      const k = tl.reduced ? smoothstep(between(t, s.enterStart, s.clipStart)) : smoothstep(between(t, s.enterStart, s.clipStart + 0.3));
      river = river + (1 - river) * k;
      night *= 1 - k;
      zoom = tl.reduced ? 1 : 1 + 0.035 * u;
    }
  }
  return { night, rain: night * (1 - river), river, zoom };
}

export function canvasView(tl: Timeline, t: number): CanvasView {
  const i = spanIndexAt(tl, t);
  const s = tl.spans[i];
  const mood = moodAt(tl, t);
  const v: CanvasView = { base: null, mix: null, mixAlpha: 0, zoom: mood.zoom, blur: 0, dim: 0, night: mood.night, inset: 0 };
  const outgoing = i > 0 ? stopRef(tl, i - 1) : null;

  if (tl.reduced) {
    v.base = stopRef(tl, i);
    const f = smoothstep(between(t, s.enterStart, s.clipStart));
    if (outgoing && f < 1) {
      v.mix = outgoing;
      v.mixAlpha = 1 - f;
    }
    return v;
  }

  if (t < s.clipStart) {
    const u = between(t, s.enterStart, s.clipStart);
    const incoming = s.clip ? { chapter: i, pos: 0 } : standInRef(tl, i);
    switch (s.enter) {
      case "whatsapp": {
        v.base = outgoing;
        v.inset = flightBackdrop(u);
        break;
      }
      case "flyer": {
        // The flyer passes over the join; the next picture fades in under it.
        v.base = outgoing;
        const f = smoothstep(between(u, 0.5, 0.95));
        if (incoming && f > 0) {
          v.base = incoming;
          v.mix = outgoing;
          v.mixAlpha = 1 - f;
        }
        break;
      }
      default: {
        v.base = incoming ?? outgoing;
        const f = smoothstep(u);
        if (outgoing && incoming && f < 1) {
          v.mix = outgoing;
          v.mixAlpha = 1 - f;
        }
      }
    }
    return v;
  }

  if (s.clip) {
    const p = between(t, s.clipStart, s.clipEnd);
    v.base = { chapter: i, pos: p * (s.clip.frames - 1) };
    // Seedance redrew chapter 2's first frame, so the chat's photo (chapter 1's
    // final frame) dissolves into the clip as it starts moving.
    if (s.enter === "whatsapp" && outgoing) {
      const d = between(t, s.clipStart, s.clipStart + 0.55);
      if (d < 1) {
        v.mix = outgoing;
        v.mixAlpha = 1 - smoothstep(d);
      }
    }
  } else {
    v.base = standInRef(tl, i);
  }
  return v;
}

/** 0..1: how far the frame has gone into the chat (and how dim the room behind it is) at flight progress u. */
export function flightBackdrop(u: number): number {
  if (u <= FLIGHT.airdrop) return smoothstep(between(u, 0.06, FLIGHT.airdrop));
  if (u <= FLIGHT.hold) return 1;
  return 1 - smoothstep(between(u, FLIGHT.hold, 1));
}

/** Flight progress 0..1 while chapter i's chat entrance plays at t, else null. */
export function flightProgress(tl: Timeline, t: number): { span: Span; u: number } | null {
  if (tl.reduced) return null;
  const s = tl.spans[spanIndexAt(tl, t)];
  if (s.enter !== "whatsapp" || t < s.enterStart || t > s.clipStart) return null;
  return { span: s, u: between(t, s.enterStart, s.clipStart) };
}

// ─── captions ────────────────────────────────────────────────────────────────

export interface CaptionState {
  index: number;
  /** Seconds since this caption's title started setting (negative: not yet). */
  local: number;
  /** 0..1 as it clears away after its stop. */
  out: number;
  /** Overall opacity (reduced motion crossfades whole captions). */
  opacity: number;
  /** Reduced motion: letters are already set. */
  still: boolean;
}

export function captionStates(tl: Timeline, t: number): CaptionState[] {
  const out: CaptionState[] = [];
  tl.spans.forEach((s, index) => {
    const next = tl.spans[index + 1];
    if (tl.reduced) {
      const fadeIn = s.clipStart > s.enterStart ? smoothstep(between(t, s.enterStart + (s.clipStart - s.enterStart) * 0.4, s.clipStart)) : 1;
      const fadeOut = next ? 1 - smoothstep(between(t, next.enterStart, next.enterStart + (next.clipStart - next.enterStart) * 0.6)) : 1;
      const opacity = t < s.enterStart ? 0 : Math.min(fadeIn, fadeOut);
      if (opacity > 0.001) out.push({ index, local: CAPTION.lead, out: 0, opacity, still: true });
      return;
    }
    const start = s.stop - CAPTION.lead;
    if (t < start - 0.05) return;
    const gone = next ? between(t, s.stop, s.stop + CAPTION.out) : 0;
    if (gone >= 1) return;
    out.push({ index, local: t - start, out: gone, opacity: 1, still: false });
  });
  return out;
}

// ─── kittens (chapter 2) ─────────────────────────────────────────────────────

/** When each kitten photo lands and leaves (absolute seconds), for a span with the kittens overlay. */
export function kittenTimes(s: Span): { land: number[]; leave: number[]; dawn: number } {
  const first = s.clipStart + 0.75;
  const last = s.clipEnd - 0.85;
  const gap = (last - first) / 4;
  const land = [0, 1, 2, 3, 4].map((j) => first + j * gap);
  // Adopted one by one; the calico sitting up (the fourth photo) leaves last.
  const order = [0, 1, 2, 4, 3];
  const leave = new Array<number>(5);
  order.forEach((j, k) => {
    leave[j] = s.clipEnd - 0.15 + k * 0.28;
  });
  return { land, leave, dawn: s.clipEnd - 0.2 };
}
