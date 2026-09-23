"use client";
/**
 * Hero — the top third of the landing page.
 *
 * 34dvh tall on phones (min 260px), 42vh from md up. An R3F canvas fills it
 * with a stylised camera that spins, tilts and bounces; tapping the camera
 * goes to /try-on with a quick shutter squash first. The wordmark, tagline and
 * a pulsing scroll cue sit over the bottom edge.
 *
 * Degradation, in order:
 *   - no WebGL (detected before mounting the canvas) or a canvas that throws
 *     at runtime → HeroFallback, a static inline-SVG camera that is a button;
 *   - /models/camera.glb present (HEAD 200) → real model, else procedural;
 *   - GLB fails to load/parse → procedural (ErrorBoundary inside the canvas);
 *   - prefers-reduced-motion → still pose, frameloop="demand", no squash,
 *     no cue animation (globals.css zeroes animation durations too);
 *   - section off-screen (IntersectionObserver) → frameloop="never".
 *
 * Landing.tsx loads this with dynamic(..., { ssr: false }), but every
 * window/document touch is still guarded so a plain import would not crash.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SITE } from "@/config/site";
import ErrorBoundary from "./ErrorBoundary";
import HeroFallback from "./HeroFallback";

/** The camera model, when there is one (else the procedural camera). */
const CAMERA_GLB = "/models/camera.glb";

// three.js (the landing's biggest script) loads on its own, after the words
// and the story have what they need; if it never arrives, the boundary around
// it shows the SVG camera (see HeroCanvas.tsx).
const HeroCanvas = dynamic(() => import("./HeroCanvas"), { ssr: false });

const TRY_ON = "/try-on";
/** Delay before navigating so the shutter squash is visible. */
const SHUTTER_MS = 170;

/* Scoped keyframes for the scroll cue and the SVG fallback's gentle float.
   prefers-reduced-motion is handled globally (globals.css clamps every
   animation-duration), so these never move for people who asked them not to. */
const CSS = `
@keyframes kh-cue-line { 0%, 100% { transform: scaleY(0.35); opacity: 0.25; } 50% { transform: scaleY(1); opacity: 1; } }
@keyframes kh-cue-text { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
@keyframes kh-float { 0%, 100% { transform: translateY(0) rotate(-3deg); } 50% { transform: translateY(-4%) rotate(-1.5deg); } }
.kh-cue-line { transform-origin: top center; animation: kh-cue-line 1.9s ease-in-out infinite; }
.kh-cue-text { animation: kh-cue-text 1.9s ease-in-out infinite; }
.kh-float { animation: kh-float 5s ease-in-out infinite; }
`;

function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    return Boolean(gl);
  } catch {
    return false;
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const update = () => setReduced(mq.matches);
    update();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
    return undefined;
  }, []);
  return reduced;
}

export default function Hero() {
  const router = useRouter();
  const sectionRef = useRef<HTMLElement>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [webgl, setWebgl] = useState<boolean | null>(null);
  const [inView, setInView] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [hasGlb, setHasGlb] = useState(false);
  const reduced = useReducedMotion();

  // WebGL is probed on the client before the canvas mounts, so an unsupported
  // browser never even tries to create a renderer.
  useEffect(() => {
    setWebgl(detectWebGL());
  }, []);

  // Optional real model: HEAD first, and a 404 is simply "no".
  useEffect(() => {
    if (typeof fetch !== "function") return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(CAMERA_GLB, { method: "HEAD", signal: ctrl.signal });
        const type = res.headers.get("content-type") ?? "";
        // Some hosts answer a missing static file with a 200 HTML page.
        if (res.ok && !/text\/html/i.test(type)) setHasGlb(true);
      } catch {
        /* offline, aborted, or blocked: stay procedural */
      }
    })();
    return () => ctrl.abort();
  }, []);

  // Pause the render loop while the hero is scrolled away.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setInView(entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Hide the scroll cue after the first scroll. Lenis drives native scroll,
  // so window.scrollY still moves and this fires with or without it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      if (window.scrollY > 6) {
        setScrolled(true);
        window.removeEventListener("scroll", check);
      }
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);

  // Tap → shutter squash → /try-on. Reduced motion skips the pause.
  const activate = useCallback(() => {
    if (navTimer.current) return;
    const go = () => {
      navTimer.current = null;
      router.push(TRY_ON);
    };
    if (reduced) {
      go();
      return;
    }
    navTimer.current = setTimeout(go, SHUTTER_MS);
  }, [router, reduced]);

  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  const frameloop = reduced ? "demand" : inView ? "always" : "never";

  return (
    <section
      ref={sectionRef}
      aria-label={`${SITE.name} — ${SITE.tagline}`}
      className="relative h-[34dvh] min-h-[260px] w-full overflow-hidden bg-bg text-fg md:h-[42vh]"
    >
      <style>{CSS}</style>

      {/* The camera: WebGL when we have it, an SVG when we do not. */}
      <div className="absolute inset-0">
        {webgl === false ? (
          <HeroFallback onActivate={activate} />
        ) : webgl === true ? (
          <ErrorBoundary fallback={<HeroFallback onActivate={activate} />} label="hero canvas">
            <HeroCanvas frameloop={frameloop} onActivate={activate} reducedMotion={reduced} useGlb={hasGlb} />
          </ErrorBoundary>
        ) : null}
      </div>

      {/* Legibility gradient behind the type */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[58%] bg-gradient-to-t from-bg via-bg/70 to-transparent" />

      {/* Wordmark, tagline, scroll cue. pointer-events-none so taps reach the camera. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 px-4 pb-3 md:px-8 md:pb-6">
        <div className="min-w-0">
          <h1 className="font-display text-[15vw] leading-[0.85] font-semibold tracking-[-0.045em] md:text-[clamp(4rem,9vw,7rem)]">
            {SITE.name}
          </h1>
          <p className="font-display mt-1.5 text-[clamp(0.95rem,3.6vw,1.35rem)] leading-tight font-light text-fg/80 italic md:mt-3">
            {SITE.tagline}
          </p>
        </div>

        <div
          aria-hidden="true"
          className={`flex shrink-0 flex-col items-center gap-2 pb-1 transition-opacity duration-500 ${
            scrolled ? "opacity-0" : "opacity-100"
          }`}
        >
          <span className="kh-cue-line block h-8 w-px bg-fg/70" />
          <span className="kh-cue-text text-[10px] font-medium tracking-[0.3em] text-muted uppercase">
            scroll
          </span>
        </div>
      </div>

      {/* Keyboard / screen-reader route to the same destination as the camera tap. */}
      <Link
        href={TRY_ON}
        className="glass sr-only rounded-full text-sm text-fg outline-none focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-20 focus:inline-flex focus:min-h-11 focus:items-center focus:px-4 focus-visible:ring-2 focus-visible:ring-accent"
      >
        Open the try-on camera
      </Link>
    </section>
  );
}
