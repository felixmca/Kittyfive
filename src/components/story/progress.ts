/**
 * A tiny synchronous "bus" that carries a scene's scroll state from the
 * ScrollTrigger callbacks in StoryScene to the pieces that paint it (canvas,
 * text, transition props). Listeners mutate DOM styles directly, so nothing
 * here goes through React state — scroll updates never cause renders.
 */

export interface SceneProgress {
  /** 0..1 while the scene is pinned (outer top at viewport top → outer bottom at viewport bottom). */
  main: number;
  /** 0..1 while the scene's top travels from the viewport bottom to the viewport top. */
  enter: number;
  /** 0..1 while the scene's bottom travels from the viewport bottom to the viewport top. */
  exit: number;
  mainActive: boolean;
  enterActive: boolean;
  exitActive: boolean;
  /** Viewport size in CSS px, measured from the sticky container (100dvh × 100%). */
  vw: number;
  vh: number;
}

export type ProgressListener = (value: SceneProgress) => void;

export interface ProgressBus {
  readonly value: SceneProgress;
  set(patch: Partial<SceneProgress>): void;
  /** Re-notify every listener with the current value (after a resize, a frame load, ...). */
  notify(): void;
  subscribe(fn: ProgressListener): () => void;
}

export function createProgressBus(initial?: Partial<SceneProgress>): ProgressBus {
  const value: SceneProgress = {
    main: 0,
    enter: 0,
    exit: 0,
    mainActive: false,
    enterActive: false,
    exitActive: false,
    vw: 390,
    vh: 844,
    ...initial,
  };
  const listeners = new Set<ProgressListener>();

  const notify = () => {
    listeners.forEach((fn) => {
      try {
        fn(value);
      } catch (err) {
        // One misbehaving listener must never take the scroll story down.
        console.warn("[story] progress listener failed", err);
      }
    });
  };

  return {
    value,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof SceneProgress)[]) {
        const next = patch[key];
        if (next !== undefined && value[key] !== next) {
          (value as unknown as Record<string, unknown>)[key] = next;
          changed = true;
        }
      }
      if (changed) notify();
    },
    notify,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

export type ScenePhase = "before" | "enter" | "main" | "exit" | "after";

/**
 * Which window the scene is in. Enter wins over main at the shared boundary
 * (both report active there) so the incoming transition finishes cleanly.
 */
export function phaseOf(v: SceneProgress): ScenePhase {
  if (v.enterActive) return "enter";
  if (v.exitActive) return "exit";
  if (v.mainActive) return "main";
  if (v.exit >= 1) return "after";
  if (v.main <= 0 && v.enter <= 0) return "before";
  return "main";
}
