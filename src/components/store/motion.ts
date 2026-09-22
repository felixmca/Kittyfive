/**
 * Shared motion plumbing for the store scene.
 *
 * KittyMotion is a mutable record owned by Kitty.tsx and read by whichever cat
 * model is mounted (procedural or GLB) inside useFrame, so the walk cycle never
 * goes through React state.
 */
import { useSyncExternalStore } from "react";

export interface KittyMotion {
  /** True while she is walking between spots. */
  moving: boolean;
  /** Current ground speed, m/s (0 when idle). */
  speed: number;
  /** Accumulated stride phase, radians. Advances only while moving. */
  phase: number;
  /** 0 = standing, 1 = fully sat down. Eased by the model. */
  sit: number;
}

export function createMotion(): KittyMotion {
  return { moving: false, speed: 0, phase: 0, sit: 1 };
}

const QUERY = "(prefers-reduced-motion: reduce)";

/** SSR-safe, imperative check. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(QUERY).matches;
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  try {
    const mq = window.matchMedia(QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

/** Reactive version of prefersReducedMotion(); false during SSR. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** Shortest signed angular difference b - a, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
