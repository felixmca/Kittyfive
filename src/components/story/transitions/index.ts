/**
 * Transition maths. Pure functions from scroll progress to layer styles, so
 * scrolling backwards plays every transition in reverse for free.
 *
 * Model (see StoryScene): each scene has three scroll windows —
 *   enter  its top travels viewport-bottom → viewport-top   (shared with prev's exit)
 *   main   pinned                                            (progress 0..1)
 *   exit   its bottom travels viewport-bottom → viewport-top (shared with next's enter)
 * Scene N's exit window IS scene N+1's enter window, so one value t drives
 * both sides. The later scene paints on top. The outgoing frame is
 * counter-translated so it appears pinned while the incoming arrives; the
 * incoming is counter-translated too when it should fade in in place, or left
 * alone when it should slide up natively.
 */
import type { SceneTransition, StoryScene as SceneDef } from "@/config/story";
import { easeInOutSine, easeOutCubic, lerp, smoothstep, span } from "../motion";
import type { ScenePhase } from "../progress";

/** Photo-card geometry used by walk-out-of-frame (fractions of the viewport). */
export const CARD = {
  scale: 0.7,
  /** Horizontal offset of the card centre, so a cat-sized gap opens beside it. */
  shift: 0.14,
  tilt: 3,
  /** Radius before scaling: 20px × 0.7 ≈ 14px on screen. */
  radius: 20,
  /** Where the cat's feet sit, as a fraction of viewport height. */
  catFloor: 0.72,
} as const;

export interface StageStyle {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  radius: number;
  border: number;
  blur: number;
}

export interface LayerStyle {
  frameY: number;
  frameOpacity: number;
  stage: StageStyle;
  shade: number;
}

export const IDENTITY_STAGE: StageStyle = {
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0,
  radius: 0,
  border: 0,
  blur: 0,
};

/** Which transition plays between two adjacent scenes. */
export function resolvePair(a: SceneDef, b: SceneDef): SceneTransition {
  return a.exit ?? b.enter ?? "crossfade";
}

/** Card pose, `k` = 0 full-bleed → 1 fully a card. sign −1 shifts left (exit), +1 right (enter). */
export function card(sign: 1 | -1, k: number, vw: number): StageStyle {
  return {
    x: sign * CARD.shift * vw * k,
    y: 0,
    scale: lerp(1, CARD.scale, k),
    rotate: sign * CARD.tilt * k,
    radius: CARD.radius * k,
    border: k,
    blur: 0,
  };
}

/** Left/right edges of the fully-formed card in px. */
export function cardEdges(sign: 1 | -1, vw: number): { left: number; right: number } {
  const cx = vw * 0.5 + sign * CARD.shift * vw;
  const half = (vw * CARD.scale) / 2;
  return { left: cx - half, right: cx + half };
}

export interface ComputeArgs {
  phase: ScenePhase;
  /** enter or exit progress, whichever phase we are in. */
  t: number;
  main: number;
  vw: number;
  vh: number;
  enterKind: SceneTransition | null;
  exitKind: SceneTransition | null;
}

export function computeLayers(a: ComputeArgs): LayerStyle {
  const { phase, t, main, vw, vh, enterKind, exitKind } = a;
  const L: LayerStyle = { frameY: 0, frameOpacity: 1, stage: { ...IDENTITY_STAGE }, shade: 0 };

  switch (phase) {
    case "before": {
      // Not reached yet: hold the pose the enter window starts from.
      if (enterKind === "walk-out-of-frame") L.stage = card(1, 1, vw);
      if (enterKind === "crossfade" || enterKind === "zoom" || enterKind === "fall") L.frameOpacity = 0;
      break;
    }
    case "enter": {
      const pinned = -(1 - t) * vh;
      switch (enterKind) {
        case "crossfade":
          L.frameY = pinned;
          L.frameOpacity = smoothstep(t);
          L.stage.scale = lerp(1.04, 1, t);
          break;
        case "zoom":
          L.frameY = pinned;
          L.frameOpacity = smoothstep(t);
          L.stage.scale = lerp(1.12, 1, easeOutCubic(t));
          break;
        case "fall":
          L.frameY = pinned;
          L.frameOpacity = smoothstep(span(t, 0.08, 1));
          break;
        case "walk-out-of-frame":
          // Slides up natively as a photo card laid on top of the last one.
          L.stage = card(1, 1, vw);
          break;
        case "slide-up":
        default:
          // Native slide; the outgoing does the work.
          break;
      }
      break;
    }
    case "main": {
      if (enterKind === "walk-out-of-frame") {
        const r = span(main, 0.1, 0.2);
        if (r < 1) L.stage = card(1, 1 - easeInOutSine(r), vw);
      }
      if (exitKind === "walk-out-of-frame") {
        const q = span(main, 0.75, 1);
        if (q > 0) L.stage = card(-1, easeInOutSine(q), vw);
      } else if (exitKind === "zoom") {
        L.stage.scale = lerp(1, 1.08, span(main, 0.85, 1));
      } else if (exitKind === "fall") {
        L.shade = 0.25 * span(main, 0.75, 1);
      }
      break;
    }
    case "exit": {
      if (!exitKind) break; // last scene scrolls away naturally into StoryEnd
      L.frameY = t * vh; // appear pinned under the incoming scene
      switch (exitKind) {
        case "crossfade":
          L.stage.scale = lerp(1, 1.06, t);
          L.shade = 0.4 * t;
          break;
        case "zoom":
          L.stage.scale = lerp(1.08, 1.25, t);
          L.stage.blur = 10 * t;
          L.shade = 0.5 * t;
          break;
        case "slide-up":
          L.stage.scale = lerp(1, 0.94, t);
          L.shade = 0.5 * t;
          break;
        case "walk-out-of-frame":
          L.stage = card(-1, 1, vw);
          L.shade = 0.35 * t;
          break;
        case "fall":
          L.shade = 0.25 + 0.3 * t;
          break;
        default:
          break;
      }
      break;
    }
    case "after":
    default:
      break;
  }
  return L;
}

/** When the kicker/title come in and when the whole text block leaves, per transition. */
export function textWindow(
  enterKind: SceneTransition | null,
  exitKind: SceneTransition | null,
): { inStart: number; outStart: number } {
  const inStart = enterKind === "walk-out-of-frame" ? 0.16 : enterKind === "fall" ? 0.04 : 0;
  const outStart = exitKind === "walk-out-of-frame" ? 0.68 : exitKind === "fall" ? 0.8 : 0.88;
  return { inStart, outStart };
}
