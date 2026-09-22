"use client";
/**
 * Chrome — the fixed controls every page wears on top of its content:
 *
 *  1. a 44px glass round button, top-right (safe-area aware), showing three
 *     stacked bars that fold into an X while the drawer is open;
 *  2. a side drawer from the right (min(320px, 84vw)) with four big rows:
 *     Kitty Stories · Kitty Store · Scroll to top · Scroll to bottom, plus the
 *     wordmark and tagline at the foot. Backdrop tap and Escape close it,
 *     focus is trapped inside, and page scroll is locked through Lenis
 *     (stop/start) or, without Lenis, through overflow on <html>;
 *  3. a 52px glass camera button, bottom-right, linking to /try-on. With
 *     `hideCameraUntilScrolled` it stays hidden until the page has scrolled
 *     past 60% of the viewport (so the landing's hero camera is not doubled);
 *  4. the toast renderer for useUi().toast, bottom-centre.
 *
 * Pages render this themselves (not the root layout) so the landing can pass
 * `hideCameraUntilScrolled`. Icons are inline SVG / CSS only; no icon library.
 * All motion is plain CSS transitions, which globals.css collapses to ~0ms
 * under prefers-reduced-motion.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { SITE } from "@/config/site";
import { scrollToBottom, scrollToTop, useUi } from "@/lib/store";
import { getLenis } from "@/components/smooth/SmoothScroll";

const TRY_ON_HREF = "/try-on";
const DRAWER_ID = "kitty-drawer";

/** Safe-area aware offsets. `max()` keeps a floor on devices with no notch. */
const SAFE_TOP = "max(12px, env(safe-area-inset-top))";
const SAFE_RIGHT = "max(12px, env(safe-area-inset-right))";
const SAFE_BOTTOM = "max(16px, env(safe-area-inset-bottom))";
const SAFE_LEFT = "max(16px, env(safe-area-inset-left))";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface ChromeProps {
  /** Keep the small camera button hidden until scrollY > 0.6 × innerHeight. */
  hideCameraUntilScrolled?: boolean;
}

export default function Chrome({ hideCameraUntilScrolled = false }: ChromeProps) {
  const drawerOpen = useUi((s) => s.drawerOpen);
  const setDrawerOpen = useUi((s) => s.setDrawerOpen);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setDrawerOpen(false), [setDrawerOpen]);
  const toggle = useCallback(
    () => setDrawerOpen(!useUi.getState().drawerOpen),
    [setDrawerOpen],
  );

  // Never leave a page with the drawer flag stuck on (drawerOpen is global).
  useEffect(() => () => setDrawerOpen(false), [setDrawerOpen]);

  // Body scroll lock while the drawer is open.
  useEffect(() => {
    if (!drawerOpen || typeof document === "undefined") return;
    const lenis = getLenis();
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    try {
      if (lenis) lenis.stop();
      else html.style.overflow = "hidden";
    } catch {
      html.style.overflow = "hidden";
    }
    return () => {
      try {
        if (lenis) lenis.start();
      } catch {
        /* ignore */
      }
      html.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // Escape closes; Tab cycles between the menu button and the drawer's rows;
  // focus moves into the drawer on open and back to the button on close.
  useEffect(() => {
    if (!drawerOpen || typeof document === "undefined") return;
    const panel = panelRef.current;
    const button = menuButtonRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const cycle = (): HTMLElement[] => {
      const inPanel = panel
        ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null || el === document.activeElement,
          )
        : [];
      return button ? [button, ...inPanel] : inPanel;
    };

    const raf = requestAnimationFrame(() => {
      const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel)?.focus({ preventScroll: true });
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = cycle();
      if (nodes.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      const index = current ? nodes.indexOf(current) : -1;
      let next: number;
      if (e.shiftKey) next = index <= 0 ? nodes.length - 1 : index - 1;
      else next = index === -1 || index === nodes.length - 1 ? 0 : index + 1;
      e.preventDefault();
      nodes[next]?.focus({ preventScroll: true });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      const target = button ?? previouslyFocused;
      try {
        target?.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    };
  }, [drawerOpen, close]);

  return (
    <>
      <MenuButton ref={menuButtonRef} open={drawerOpen} onClick={toggle} />
      <Drawer ref={panelRef} open={drawerOpen} onClose={close} />
      <CameraButton hideUntilScrolled={hideCameraUntilScrolled} />
      <Toast />
    </>
  );
}

/* ---------------------------------------------------------------- menu */

function MenuButton({
  ref,
  open,
  onClick,
}: {
  ref: Ref<HTMLButtonElement>;
  open: boolean;
  onClick: () => void;
}) {
  const bar = "absolute left-0 h-[1.5px] w-full rounded-full bg-current";
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      aria-controls={DRAWER_ID}
      className={`glass group fixed z-[70] flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-fg ${FOCUS_RING}`}
      style={{ top: SAFE_TOP, right: SAFE_RIGHT }}
    >
      <PressTint />
      <span aria-hidden className="relative block h-[14px] w-[18px]">
        <span
          className={`${bar} top-0 transition-transform duration-300 ease-out ${
            open ? "translate-y-[6.25px] rotate-45" : ""
          }`}
        />
        <span
          className={`${bar} top-1/2 -translate-y-1/2 transition-opacity duration-200 ${
            open ? "opacity-0" : "opacity-100"
          }`}
        />
        <span
          className={`${bar} bottom-0 transition-transform duration-300 ease-out ${
            open ? "-translate-y-[6.25px] -rotate-45" : ""
          }`}
        />
      </span>
    </button>
  );
}

/* -------------------------------------------------------------- drawer */

function Drawer({
  ref,
  open,
  onClose,
}: {
  ref: Ref<HTMLDivElement>;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  // Closing lifts the scroll lock in an effect *after* this render commits,
  // and Lenis ignores scrollTo() while stopped, so the scroll itself waits a
  // frame. Without Lenis (reduced motion) the deferral is harmless.
  const closeThen = (scroll: () => void) => () => {
    onClose();
    const go = () => {
      try {
        scroll();
      } catch {
        /* ignore */
      }
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(go);
    else setTimeout(go, 0);
  };
  const onScrollTop = closeThen(scrollToTop);
  const onScrollBottom = closeThen(scrollToBottom);

  return (
    <>
      {/* Backdrop: tap anywhere outside the panel to close. */}
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-[60] bg-black/55 transition-opacity duration-400 ease-out ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <div
        ref={ref}
        id={DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        data-lenis-prevent
        className={`glass fixed inset-y-0 right-0 z-[65] flex w-[min(320px,84vw)] flex-col overflow-y-auto text-fg outline-none transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{
          // Layer the frosted white over a deep tint so rows stay legible on
          // top of a bright hero. .glass still supplies the backdrop blur.
          // (.glass is unlayered CSS, so it out-cascades Tailwind utilities;
          // background and border are therefore set inline here.)
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)), rgba(11,11,12,0.78)",
          borderWidth: "0 0 0 1px",
          paddingTop: `calc(${SAFE_TOP} + 64px)`,
          paddingBottom: SAFE_BOTTOM,
          paddingRight: SAFE_RIGHT,
          paddingLeft: SAFE_LEFT,
        }}
      >
        <p className="px-4 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">
          Menu
        </p>

        <nav aria-label="Site" className="mt-3 flex flex-col gap-1">
          <DrawerRow
            href={SITE.nav.stories.href}
            current={pathname === SITE.nav.stories.href}
            onClick={onClose}
            glyph={<ArrowGlyph />}
          >
            {SITE.nav.stories.label}
          </DrawerRow>
          <DrawerRow
            href={SITE.nav.store.href}
            current={pathname === SITE.nav.store.href}
            onClick={onClose}
            glyph={<ArrowGlyph />}
          >
            {SITE.nav.store.label}
          </DrawerRow>
        </nav>

        <div aria-hidden className="mx-4 my-4 h-px bg-white/10" />

        <div className="flex flex-col gap-1">
          <DrawerRow onClick={onScrollTop} glyph={<ChevronGlyph direction="up" />}>
            Scroll to top
          </DrawerRow>
          <DrawerRow onClick={onScrollBottom} glyph={<ChevronGlyph direction="down" />}>
            Scroll to bottom
          </DrawerRow>
        </div>

        <div className="mt-auto px-4 pt-10">
          <Link
            href="/"
            onClick={onClose}
            className={`font-display inline-block rounded-md text-[28px] font-light leading-none tracking-[-0.01em] text-fg ${FOCUS_RING}`}
          >
            {SITE.name}
          </Link>
          <p className="mt-2 text-[13px] leading-snug text-muted">{SITE.tagline}</p>
        </div>
      </div>
    </>
  );
}

function DrawerRow({
  href,
  current,
  onClick,
  glyph,
  children,
}: {
  href?: string;
  current?: boolean;
  onClick: () => void;
  glyph: ReactNode;
  children: ReactNode;
}) {
  const className = `group flex min-h-[60px] w-full items-center justify-between gap-4 rounded-2xl px-4 text-left transition-colors hover:bg-white/8 active:bg-white/12 ${FOCUS_RING} ${
    current ? "bg-white/6" : ""
  }`;
  const label = (
    <span className="font-display text-[26px] font-light leading-none tracking-[-0.01em]">
      {children}
    </span>
  );
  const icon = (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-colors group-hover:text-fg"
    >
      {glyph}
    </span>
  );
  if (href) {
    return (
      <Link
        href={href}
        onClick={onClick}
        aria-current={current ? "page" : undefined}
        className={className}
      >
        {label}
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {label}
      {icon}
    </button>
  );
}

/* -------------------------------------------------------------- camera */

function CameraButton({ hideUntilScrolled }: { hideUntilScrolled: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!hideUntilScrolled || typeof window === "undefined") return;
    let raf = 0;
    const check = () => {
      raf = 0;
      setScrolled(window.scrollY > 0.6 * window.innerHeight);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    // Lenis drives native scroll, so window 'scroll' fires under it too; the
    // extra Lenis subscription only makes the fade land on the same frame.
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    let offLenis: (() => void) | undefined;
    try {
      offLenis = getLenis()?.on("scroll", schedule);
    } catch {
      offLenis = undefined;
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      offLenis?.();
    };
  }, [hideUntilScrolled]);

  const visible = !hideUntilScrolled || scrolled;

  return (
    <Link
      href={TRY_ON_HREF}
      aria-label="Try on Kitty merch with your camera"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={`glass group fixed z-[50] flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full text-fg transition-[opacity,transform] duration-400 ease-out ${FOCUS_RING} ${
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"
      }`}
      style={{ bottom: SAFE_BOTTOM, right: SAFE_RIGHT }}
    >
      <PressTint />
      <CameraGlyph />
    </Link>
  );
}

/* --------------------------------------------------------------- toast */

function Toast() {
  const toast = useUi((s) => s.toast);
  // Hold the last message so it can fade out after the store clears it.
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (toast) setMessage(toast);
  }, [toast]);

  const shown = toast !== null && toast !== undefined;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4"
      style={{ bottom: `calc(${SAFE_BOTTOM} + 76px)` }}
    >
      <div
        className={`glass max-w-[min(360px,100%)] rounded-full px-5 py-3 text-center text-[14px] leading-snug text-fg transition-[opacity,transform] duration-300 ease-out ${
          shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        {shown ? toast : message}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- glyphs */

/**
 * Hover/press feedback for .glass controls. `.glass` is an unlayered rule in
 * globals.css, so it out-cascades Tailwind's layered `hover:bg-*` utilities;
 * tinting a child overlay instead keeps the feedback visible.
 */
function PressTint() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-full bg-white/0 transition-colors duration-200 group-hover:bg-white/10 group-active:bg-white/16"
    />
  );
}

function CameraGlyph() {
  return (
    <svg aria-hidden width="24" height="24" viewBox="0 0 24 24" fill="none">
      {/* rounded body */}
      <rect x="2.5" y="7" width="19" height="13" rx="3" stroke="currentColor" strokeWidth="1.6" />
      {/* viewfinder bump */}
      <path
        d="M8 7V5.6A1.6 1.6 0 0 1 9.6 4h4.8A1.6 1.6 0 0 1 16 5.6V7"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      {/* lens */}
      <circle cx="12" cy="13.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="13.5" r="1.1" fill="currentColor" />
      {/* flash */}
      <rect x="17" y="9.4" width="2" height="2" rx="0.6" fill="var(--accent)" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M4 10h11M11 5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronGlyph({ direction }: { direction: "up" | "down" }) {
  const d = direction === "up" ? "M10 15V5M5 10l5-5 5 5" : "M10 5v10M5 10l5 5 5-5";
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
