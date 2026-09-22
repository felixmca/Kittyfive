"use client";
/**
 * SmoothScroll — Lenis-driven smooth scrolling wired into GSAP's ticker so
 * ScrollTrigger and Lenis share one clock.
 *
 * - Lenis drives *native* scroll (window.scrollY still moves), so ScrollTrigger
 *   needs no scrollerProxy; we only forward Lenis' scroll event to
 *   ScrollTrigger.update so pinned scenes never lag a frame behind.
 * - prefers-reduced-motion: Lenis is not created at all (plain native scroll),
 *   ScrollTrigger is still registered so scroll-scrubbed scenes keep working.
 * - syncTouch is false on purpose: iOS keeps its own rubber-band touch
 *   scrolling, which is what we want.
 * - The instance is exposed as window.__lenis for src/lib/store.ts helpers
 *   (scrollToTop / scrollToBottom) and for the chrome's body-scroll lock.
 */
import { useEffect, type ReactNode } from "react";
import type Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

type LenisWindow = Window & { __lenis?: Lenis };

/** The live Lenis instance, or undefined (SSR, reduced motion, not mounted yet). */
export function getLenis(): Lenis | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as LenisWindow).__lenis;
}

/** True when the visitor has asked the OS for reduced motion. SSR-safe. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export default function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    try {
      gsap.registerPlugin(ScrollTrigger);
    } catch (err) {
      console.warn("[SmoothScroll] ScrollTrigger could not be registered", err);
    }

    // Native scroll for people who asked for it. ScrollTrigger listens to the
    // window on its own, so nothing else is needed.
    if (prefersReducedMotion()) return;

    let lenis: Lenis | undefined;
    let tick: ((time: number) => void) | undefined;
    let offScroll: (() => void) | undefined;
    let cancelled = false;
    const w = window as LenisWindow;

    // Lenis is an ES module; importing it lazily keeps it out of the SSR
    // graph entirely and lets a failed load degrade to native scroll.
    import("lenis")
      .then(({ default: LenisCtor }) => {
        if (cancelled) return;
        try {
          lenis = new LenisCtor({
            lerp: 0.1,
            smoothWheel: true,
            syncTouch: false,
            autoRaf: false, // gsap.ticker drives raf below
          });
        } catch (err) {
          console.warn("[SmoothScroll] Lenis failed to start; using native scroll", err);
          return;
        }
        const instance = lenis;
        w.__lenis = instance;

        offScroll = instance.on("scroll", () => ScrollTrigger.update());
        tick = (time: number) => instance.raf(time * 1000);
        gsap.ticker.add(tick);
        gsap.ticker.lagSmoothing(0);

        // Let pinned sections re-measure once Lenis owns the scroll.
        try {
          requestAnimationFrame(() => ScrollTrigger.refresh());
        } catch {
          /* ignore */
        }
      })
      .catch((err) => {
        console.warn("[SmoothScroll] Lenis could not be loaded; using native scroll", err);
      });

    return () => {
      cancelled = true;
      if (offScroll) offScroll();
      if (tick) gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33); // GSAP defaults
      if (lenis) {
        if (w.__lenis === lenis) delete w.__lenis;
        try {
          lenis.destroy();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  return <>{children}</>;
}
