/**
 * How the story went on this device, sent home once per visit so it can be
 * fixed on phones nobody here can test on (it went blank on an iPhone on
 * 23 Sep 2026). Anonymous and technical only: the browser's user-agent
 * string, the screen size, whether and how fast the story started, how far it
 * got, how many frames were decoded, the first few errors, and whether the
 * previous visit in this tab ended without saying goodbye (iOS reloads a page
 * it had to kill for memory). No IP, no cookies, no identifiers.
 *
 * Sent with navigator.sendBeacon when the page is hidden (at most three times
 * a visit), plus a "stalled" note if the story has not started after 12 s on
 * screen (time in a background tab does not count).
 * Off on local and LAN addresses, under automation (the verify harness), and
 * with NEXT_PUBLIC_STORY_REPORTS=off.
 */

const ENDPOINT = "/api/story-report";
const MARK = "kittyfive-story-open";
const STALL_MS = 12_000;
const MAX_FLUSHES = 3;

export interface ReportState {
  started: boolean;
  mode: string;
  t: number;
  furthest: number;
  media: { decoded: number; peak: number; finals: number; fetched: number; broken: number };
  /** Milliseconds playback spent waiting for frames, and how often it played on past a missing one. */
  waitMs: number;
  skips: number;
}

function wanted(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (process.env.NEXT_PUBLIC_STORY_REPORTS === "off") return false;
  if (navigator.webdriver) return false;
  // Local and LAN addresses are someone testing, not a visitor.
  if (/^(localhost|\[::1\]|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)) return false;
  return typeof navigator.sendBeacon === "function";
}

export class StoryReport {
  private readonly on = wanted();
  private readonly t0 = typeof performance !== "undefined" ? performance.now() : 0;
  /** When the page last became visible (null: hidden now). */
  private visibleSince: number | null = null;
  private visibleMs = 0;
  private stallChecked = false;
  private startMs: number | null = null;
  private splash = false;
  private swipes = 0;
  private drawFailed = false;
  private errors: string[] = [];
  private crashedBefore = false;
  private flushes = 0;
  private stallTimer = 0;
  private state: () => ReportState | null = () => null;

  constructor(private readonly reduced: boolean) {
    if (!this.on) return;
    try {
      this.crashedBefore = sessionStorage.getItem(MARK) === "open";
      sessionStorage.setItem(MARK, "open");
    } catch {
      /* private mode */
    }
    if (document.visibilityState !== "hidden") this.visibleSince = this.t0;
    window.addEventListener("error", this.onError);
    window.addEventListener("unhandledrejection", this.onRejection);
    window.addEventListener("pagehide", this.onHide);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.armStallCheck();
  }

  /** Time on screen so far. */
  private shownMs(): number {
    return this.visibleMs + (this.visibleSince === null ? 0 : performance.now() - this.visibleSince);
  }

  /** Check for a stall once the page has been on screen for STALL_MS (not before: a background tab is not a stall). */
  private armStallCheck(): void {
    window.clearTimeout(this.stallTimer);
    if (this.stallChecked || this.visibleSince === null) return;
    this.stallTimer = window.setTimeout(this.checkStalled, Math.max(0, STALL_MS - this.shownMs()));
  }

  /** Where to read the story's state from when a report goes out. */
  attach(state: () => ReportState | null): void {
    this.state = state;
  }

  started(splashShown: boolean): void {
    if (this.startMs === null) this.startMs = Math.round(performance.now() - this.t0);
    this.splash = splashShown;
  }

  swipe(): void {
    this.swipes++;
  }

  error(message: string, fromDraw = false): void {
    if (fromDraw) this.drawFailed = true;
    if (this.errors.length < 4) this.errors.push(message.slice(0, 200));
  }

  private onError = (e: ErrorEvent): void => {
    this.error(`${e.message || "error"}${e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : ""}`);
  };

  private onRejection = (e: PromiseRejectionEvent): void => {
    const r = e.reason as { message?: string } | string | undefined;
    this.error(`unhandled: ${typeof r === "string" ? r : r?.message ?? "rejection"}`);
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      this.onHide();
      return;
    }
    // Back again: the next time it is hidden is worth another summary.
    this.hidden = false;
    this.visibleSince = performance.now();
    this.armStallCheck();
    try {
      sessionStorage.setItem(MARK, "open");
    } catch {
      /* ignore */
    }
  };

  /** visibilitychange (hidden) and pagehide usually both fire: one summary for the pair. */
  private hidden = false;

  private onHide = (): void => {
    if (this.hidden) return;
    this.hidden = true;
    window.clearTimeout(this.stallTimer);
    if (this.visibleSince !== null) this.visibleMs += performance.now() - this.visibleSince;
    this.visibleSince = null;
    try {
      sessionStorage.setItem(MARK, "closed");
    } catch {
      /* ignore */
    }
    this.send("summary");
  };

  private checkStalled = (): void => {
    if (this.stallChecked || this.visibleSince === null) return;
    if (this.shownMs() < STALL_MS - 50) {
      this.armStallCheck();
      return;
    }
    this.stallChecked = true;
    const s = this.state();
    if (!s || !s.started) this.send("stalled");
  };

  private payload(): Record<string, unknown> {
    const s = this.state();
    const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
    return {
      v: 1,
      build: (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
      page: location.pathname,
      ua: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`,
      standalone: Boolean(nav.standalone),
      memory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
      reduced: this.reduced,
      started: s?.started ?? false,
      startMs: this.startMs ?? undefined,
      splash: this.splash,
      furthest: s?.furthest ?? -1,
      swipes: this.swipes,
      t: s ? Math.round(s.t * 100) / 100 : undefined,
      endMode: s?.mode,
      released: s?.mode === "released",
      decoded: s?.media.decoded,
      peakDecoded: s?.media.peak,
      finals: s?.media.finals,
      fetched: s?.media.fetched,
      broken: s?.media.broken,
      waitMs: s ? Math.round(s.waitMs) : undefined,
      skips: s?.skips,
      drawFailed: this.drawFailed,
      crashedBefore: this.crashedBefore,
      visibleMs: Math.round(this.shownMs()),
      flushes: this.flushes,
      errors: this.errors,
    };
  }

  private send(kind: "summary" | "stalled"): void {
    if (!this.on || this.flushes >= MAX_FLUSHES) return;
    this.flushes++;
    try {
      const body = JSON.stringify({ kind, report: this.payload() });
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    } catch {
      /* never let reporting break the page */
    }
  }

  destroy(): void {
    if (!this.on) return;
    window.clearTimeout(this.stallTimer);
    window.removeEventListener("error", this.onError);
    window.removeEventListener("unhandledrejection", this.onRejection);
    window.removeEventListener("pagehide", this.onHide);
    document.removeEventListener("visibilitychange", this.onVisibility);
    // Leaving the landing inside the app (a link): that is a goodbye too.
    this.onHide();
  }
}
