"use client";
/**
 * Chrome — the fixed controls every page wears on top of its content:
 *
 *  1. Kitty's face in a 44px glass round button, top-left (safe-area aware):
 *     home, from every page. On the landing itself it goes back to the top,
 *     where the story starts again under the camera;
 *  2. a 44px glass round button, top-right, showing three stacked bars that
 *     fold into an X while the drawer is open;
 *  3. a side drawer from the right (min(320px, 84vw)): Kitty (home) at the
 *     top with her face, then Kitty Stories · Kitty Store · Try it on ·
 *     Sign in / Your account (and Admin, for an account last seen as one in
 *     this browser), then Scroll to top · Scroll to bottom. The page
 *     you are on is marked. Backdrop tap and Escape close it, focus is
 *     trapped inside, and page scroll is locked through Lenis (stop/start) or,
 *     without Lenis, through overflow on <html>;
 *  4. a 52px glass camera button, bottom-right, linking to /try-on. With
 *     `hideCameraUntilScrolled` it stays hidden until the page has scrolled
 *     past 60% of the viewport (so the landing's hero camera is not doubled);
 *  5. the toast renderer for useUi().toast, bottom-centre.
 *
 * Pages render this themselves (not the root layout) so each can choose its
 * camera button (`hideCamera`, `hideCameraUntilScrolled`). Pages that put
 * their own controls near the top corners keep clear of the two buttons with
 * ./layout.ts. Icons are inline SVG / CSS only; no icon library. All motion
 * is plain CSS transitions, which globals.css collapses to ~0ms under
 * prefers-reduced-motion.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode, type Ref } from "react";
import { SITE } from "@/config/site";
import { scrollToBottom, scrollToTop, useUi } from "@/lib/store";
import { hasStoredSession, wasAdmin } from "@/lib/supabase/sessionHint";
import { getLenis } from "@/components/smooth/SmoothScroll";
import KittyFace from "./KittyFace";
import { CHROME_LEFT, CHROME_TOP } from "./layout";

const TRY_ON_HREF = "/try-on";
const HOME_HREF = "/";
const DRAWER_ID = "kitty-drawer";

/** Safe-area aware offsets. `max()` keeps a floor on devices with no notch. */
const SAFE_TOP = CHROME_TOP;
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
  /** No floating camera at all: the try-on itself, and pages whose own controls sit bottom-right. */
  hideCamera?: boolean;
}

export default function Chrome({ hideCameraUntilScrolled = false, hideCamera = false }: ChromeProps) {
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
      {/* A landmark for the fixed controls, so screen readers can jump to them
          (they are position: fixed; the nav itself takes no space). */}
      <nav aria-label="Quick links">
        <HomeButton />
        <MenuButton ref={menuButtonRef} open={drawerOpen} onClick={toggle} />
        {hideCamera ? null : <CameraButton hideUntilScrolled={hideCameraUntilScrolled} />}
      </nav>
      <Drawer ref={panelRef} open={drawerOpen} onClose={close} />
      <Toast />
    </>
  );
}

/* ---------------------------------------------------------------- home */

/**
 * Home: a link to the landing from every page. On the landing it is the way
 * back to the top instead (a same-page link would do nothing visible).
 */
function useGoHome(after?: () => void) {
  const pathname = usePathname();
  const onLanding = pathname === HOME_HREF;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    after?.();
    if (!onLanding || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // The drawer's scroll lock lifts in an effect after this render commits,
    // and Lenis ignores scrollTo() while stopped, so wait a frame.
    requestAnimationFrame(() => {
      try {
        scrollToTop();
      } catch {
        /* ignore */
      }
    });
  };
  return { onLanding, onClick };
}

function HomeButton() {
  const { onLanding, onClick } = useGoHome();
  return (
    <Link
      href={HOME_HREF}
      onClick={onClick}
      aria-label={onLanding ? "Kitty: back to the top" : "Kitty: back to the story"}
      title={onLanding ? "Back to the top" : "Back to Kitty's story"}
      data-home
      // Under the drawer's backdrop (z-60), so an open menu dims it like the page.
      className={`glass group fixed z-[55] flex h-11 w-11 items-center justify-center overflow-hidden rounded-full ${FOCUS_RING}`}
      style={{ top: SAFE_TOP, left: CHROME_LEFT }}
    >
      <PressTint />
      <KittyFace size={31} className="relative transition-transform duration-300 ease-out group-hover:scale-110 group-active:scale-95" />
    </Link>
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
  // Read when the drawer opens, so it is right after signing in or out.
  const [signedIn, setSignedIn] = useState(false);
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!open) return;
    setSignedIn(hasStoredSession());
    setAdmin(wasAdmin());
  }, [open]);
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
  const home = useGoHome(onClose);
  const inStories = pathname === SITE.nav.stories.href || pathname.startsWith(`${SITE.nav.stories.href}/`);

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
          // The home row (64px) is centred on the close button (44px) beside it.
          paddingTop: `calc(${SAFE_TOP} - 10px)`,
          paddingBottom: SAFE_BOTTOM,
          paddingRight: SAFE_RIGHT,
          paddingLeft: SAFE_LEFT,
        }}
      >
        {/* Home first: Kitty, her face and the tagline, level with the close button. */}
        <Link
          href={HOME_HREF}
          onClick={home.onClick}
          aria-current={home.onLanding ? "page" : undefined}
          data-drawer-home
          className={`group -ml-1 mr-[52px] flex min-h-[64px] items-center gap-3 rounded-2xl px-2 py-1 transition-colors hover:bg-white/8 active:bg-white/12 ${FOCUS_RING}`}
        >
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] transition-transform duration-300 ease-out group-hover:scale-105"
          >
            <KittyFace size={36} />
          </span>
          <span className="min-w-0">
            <span className="font-display block text-[30px] font-light leading-none tracking-[-0.01em] text-fg">
              {SITE.name}
            </span>
            <span className="mt-1.5 block truncate text-[12.5px] leading-snug text-muted">
              {home.onLanding ? "Back to the top of her story" : "Home: her story"}
            </span>
          </span>
        </Link>

        <p className="mt-6 px-4 text-[11px] font-medium uppercase tracking-[0.22em] text-accent">Menu</p>

        <nav aria-label="Site" className="mt-2 flex flex-col gap-1">
          <DrawerRow
            href={SITE.nav.stories.href}
            current={inStories}
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
          <DrawerRow
            href={TRY_ON_HREF}
            current={pathname === TRY_ON_HREF}
            onClick={onClose}
            glyph={<CameraGlyph size={20} />}
          >
            Try it on
          </DrawerRow>
          <DrawerRow
            href={SITE.nav.account.href}
            current={pathname === SITE.nav.account.href}
            onClick={onClose}
            glyph={<ArrowGlyph />}
          >
            {signedIn ? SITE.nav.account.label : "Sign in"}
          </DrawerRow>
          {admin ? (
            <DrawerRow
              href={SITE.nav.admin.href}
              current={pathname === SITE.nav.admin.href}
              onClick={onClose}
              glyph={<ArrowGlyph />}
            >
              {SITE.nav.admin.label}
            </DrawerRow>
          ) : null}
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

        <p className="mt-auto px-4 pt-10 text-[13px] leading-snug text-muted">{SITE.tagline}</p>
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
  const className = `group relative flex min-h-[58px] w-full items-center justify-between gap-4 rounded-2xl px-4 text-left transition-colors hover:bg-white/8 active:bg-white/12 ${FOCUS_RING} ${
    current ? "bg-white/[0.07]" : ""
  }`;
  const label = (
    <span className="font-display text-[26px] font-light leading-none tracking-[-0.01em]">
      {current ? (
        <span aria-hidden className="absolute left-1 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-accent" />
      ) : null}
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

function CameraGlyph({ size = 24 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none">
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
