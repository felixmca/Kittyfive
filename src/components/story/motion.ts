/**
 * Small pure helpers shared by the scroll story and the turntable.
 * Nothing here touches the DOM except the two feature probes at the bottom,
 * which are SSR-safe.
 */

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Hermite smoothstep, clamped to [0, 1]. */
export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

export function easeOutQuad(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

export function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;
}

/** Where `v` sits inside [a, b], clamped to [0, 1]. Degenerate ranges step. */
export function span(v: number, a: number, b: number): number {
  if (b <= a) return v >= b ? 1 : 0;
  return clamp01((v - a) / (b - a));
}

/** FNV-1a 32-bit, deterministic across runs so placeholders keep their colours. */
export function hashString(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Two hues (degrees) derived from a scene id: a base and a complementary-ish partner. */
export function sceneHues(id: string): [number, number] {
  const h = hashString(id);
  const a = h % 360;
  // Partner sits 110..170 degrees away so the gradient always has some depth.
  const b = (a + 110 + ((h >>> 9) % 60)) % 360;
  return [a, b];
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Device pixel ratio capped so a 3x phone does not triple the canvas work. */
export function cappedDpr(max = 2): number {
  if (typeof window === "undefined") return 1;
  const dpr = window.devicePixelRatio || 1;
  return clamp(dpr, 1, max);
}

/** Two-digit scene label, "01".."11". */
export function sceneNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}
