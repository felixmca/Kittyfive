"use client";
/**
 * useFrameSequence — lazily loads a scene's WebP frame sequence.
 *
 *   const seq = useFrameSequence({ dir: "/story/01-january-night", hint }, active, priority);
 *   seq.status      'idle' | 'loading' | 'ready' | 'missing' | 'error'
 *   seq.loaded / seq.total
 *   seq.focus(i)    where the scroll is: frames around i are decoded
 *   seq.getFrame(i) nearest decoded frame to i (or null)
 *   seq.subscribe(fn) fires whenever another frame lands
 *
 * Nothing is fetched until `active` is true. When `active` flips back to
 * false every bitmap is closed and the arrays are dropped. The manifest is
 * cached module-wide, a 404 is remembered, and a scene the index.json says
 * has no media never even asks for a manifest.
 *
 * Memory: every frame's compressed bytes are kept (≈45 KB each), but only a
 * window of frames around the focus is decoded (±10), plus every 12th frame
 * as a keyframe so a fast scrub always has something close to show. A whole
 * decoded clip is 170 MB, which iOS Safari will not hold twice (the reader
 * can have two clip scenes near the screen at a chapter boundary); the
 * window keeps a scene near 60 MB. Decoding goes through decodeFrameBlob (a
 * worker where the browser allows).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  decodeFrameBlob,
  fetchFrameBlob,
  fetchManifest,
  frameSize,
  frameUrl,
  progressiveOrder,
  releaseFrame,
  schedule,
  type FrameImage,
  type FrameManifest,
} from "./frameLoader";

export type SequenceStatus = "idle" | "loading" | "ready" | "missing" | "error";

/** What Story learned from /story/index.json about this scene. */
export type MediaHint = "pending" | "probe" | "present" | "absent";

export interface FrameSource {
  /** Public directory holding manifest.json and the frames, e.g. "/story/03-she-stayed". */
  dir: string;
  hint: MediaHint;
  /** A single still to use when the sequence is missing (SceneMedia.fallbackPoster / image src). */
  poster?: string;
  /** SceneMedia.kind === "none": never load anything. */
  none?: boolean;
  /**
   * "progressive" (default): first, last, every 8th, then the gaps, so a
   * half-loaded scene already scrubs. "sequential": 1, 2, 3… for a clip that
   * is about to play from its start.
   */
  order?: "progressive" | "sequential";
}

export interface FrameSequence {
  status: SequenceStatus;
  loaded: number;
  total: number;
  width: number;
  height: number;
  /** Nearest decoded frame to `i`, searching outward. Null until the first frame lands. */
  getFrame(i: number): FrameImage | null;
  /** Index of the nearest decoded frame to `i`, or -1. */
  nearestIndex(i: number): number;
  /** Where the viewer is in the clip: decode around frame `i`, let the rest go. */
  focus(i: number): void;
  /** Called whenever a frame finishes decoding. */
  subscribe(fn: () => void): () => void;
}

interface Snapshot {
  status: SequenceStatus;
  loaded: number;
  total: number;
  width: number;
  height: number;
}

const IDLE: Snapshot = { status: "idle", loaded: 0, total: 0, width: 0, height: 0 };

/** Every live controller, for the verify harness: window.__frameSequences(). */
const live = new Set<SequenceController>();
if (typeof window !== "undefined") {
  (window as Window & { __frameSequences?: () => { total: number; decoded: number }[] }).__frameSequences = () =>
    [...live].map((c) => ({ total: c.frames.length, decoded: c.frames.filter(Boolean).length }));
}

/**
 * The loader behind useFrameSequence, exported for code that drives frames
 * from its own animation loop (the landing's SwipeStory) rather than React.
 */
export class SequenceController {
  /** Decoded frames (null: not decoded, or let go outside the window). */
  frames: (FrameImage | null)[] = [];
  snap: Snapshot = IDLE;
  private blobs: (Blob | null)[] = [];
  private decoding = new Set<number>();
  private broken = new Set<number>();
  private center = 0;
  private abort: AbortController | null = null;
  private frameListeners = new Set<() => void>();
  private snapListeners = new Set<(s: Snapshot) => void>();
  private raf = 0;
  priority = () => 0;

  static readonly WINDOW = 10;
  static readonly KEY_EVERY = 12;
  static readonly DECODERS = 2;

  getFrame = (i: number): FrameImage | null => {
    const idx = this.nearestIndex(i);
    return idx < 0 ? null : this.frames[idx];
  };

  nearestIndex = (i: number): number => {
    const n = this.frames.length;
    if (!n) return -1;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    if (this.frames[c]) return c;
    for (let d = 1; d < n; d++) {
      const lo = c - d;
      const hi = c + d;
      if (lo >= 0 && this.frames[lo]) return lo;
      if (hi < n && this.frames[hi]) return hi;
    }
    return -1;
  };

  /** Keep frames around `i` decoded (and the keyframes); let the others go. */
  focus = (i: number): void => {
    const n = this.frames.length;
    if (!n) return;
    const c = Math.max(0, Math.min(n - 1, Math.round(i)));
    if (c === this.center) return;
    this.center = c;
    const slack = SequenceController.WINDOW + 3; // a little hysteresis before letting go
    for (let k = 0; k < n; k++) {
      const f = this.frames[k];
      if (f && Math.abs(k - c) > slack && !this.isKey(k, n)) {
        this.frames[k] = null;
        releaseFrame(f);
      }
    }
    this.pump();
  };

  private isKey(k: number, n: number): boolean {
    return k % SequenceController.KEY_EVERY === 0 || k === n - 1;
  }

  private wanted(k: number): boolean {
    const n = this.frames.length;
    return Math.abs(k - this.center) <= SequenceController.WINDOW || this.isKey(k, n);
  }

  /** Decode the wanted frames whose bytes are here, nearest the focus first, a few at a time. */
  private pump(): void {
    const n = this.frames.length;
    if (!n || !this.abort) return;
    const order: number[] = [];
    for (let d = 0; d <= SequenceController.WINDOW; d++) {
      if (this.center + d < n) order.push(this.center + d);
      if (d && this.center - d >= 0) order.push(this.center - d);
    }
    for (let k = 0; k < n; k += SequenceController.KEY_EVERY) order.push(k);
    order.push(n - 1);
    for (const k of order) {
      if (this.decoding.size >= SequenceController.DECODERS) return;
      const blob = this.blobs[k];
      if (!blob || this.frames[k] || this.decoding.has(k) || this.broken.has(k)) continue;
      this.decode(k, blob);
    }
  }

  private decode(k: number, blob: Blob): void {
    const signal = this.abort?.signal;
    // This session's set: a decode that lands after stop() must not touch the next one's.
    const decoding = this.decoding;
    decoding.add(k);
    decodeFrameBlob(blob).then(
      (img) => {
        decoding.delete(k);
        if (!signal || signal.aborted || !this.wanted(k) || this.frames[k]) {
          releaseFrame(img);
        } else {
          this.frames[k] = img;
          const size = frameSize(img);
          const loaded = this.frames.reduce((m, f) => m + (f ? 1 : 0), 0);
          this.setSnap(
            {
              loaded,
              status: "ready",
              width: this.snap.width || size.width,
              height: this.snap.height || size.height,
            },
            this.snap.status === "ready",
          );
          this.frameListeners.forEach((fn) => fn());
        }
        this.pump();
      },
      () => {
        decoding.delete(k);
        if (!signal || signal.aborted) return;
        this.broken.add(k);
        this.pump();
      },
    );
  }

  subscribe = (fn: () => void): (() => void) => {
    this.frameListeners.add(fn);
    return () => {
      this.frameListeners.delete(fn);
    };
  };

  onSnapshot(fn: (s: Snapshot) => void): () => void {
    this.snapListeners.add(fn);
    return () => {
      this.snapListeners.delete(fn);
    };
  }

  private setSnap(patch: Partial<Snapshot>, throttle = false) {
    this.snap = { ...this.snap, ...patch };
    if (throttle) {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.snapListeners.forEach((fn) => fn(this.snap));
      });
      return;
    }
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.snapListeners.forEach((fn) => fn(this.snap));
  }

  start(source: FrameSource): void {
    if (this.abort) return; // already loading / loaded
    const ctrl = new AbortController();
    this.abort = ctrl;
    live.add(this);
    const { signal } = ctrl;

    if (source.none || (source.hint === "absent" && !source.poster)) {
      this.setSnap({ status: "missing", loaded: 0, total: 0 });
      return;
    }
    this.setSnap({ status: "loading" });

    const run = async () => {
      let manifest: FrameManifest | null = null;
      let dir = source.dir;
      let single: string | null = null;

      if (source.hint !== "absent") {
        try {
          manifest = await fetchManifest(source.dir, signal);
        } catch (err) {
          if (signal.aborted) return;
          console.warn("[story] manifest fetch failed", source.dir, err);
          this.setSnap({ status: "error" });
          return;
        }
      }
      if (signal.aborted) return;

      if (!manifest) {
        if (source.poster) {
          single = source.poster;
          manifest = { frames: 1, width: 0, height: 0 };
          dir = "";
        } else {
          this.setSnap({ status: "missing", loaded: 0, total: 0 });
          return;
        }
      }

      const n = manifest.frames;
      this.frames = new Array<FrameImage | null>(n).fill(null);
      this.blobs = new Array<Blob | null>(n).fill(null);
      this.setSnap({ total: n, loaded: 0, width: manifest.width, height: manifest.height });

      let failed = 0;
      const order = source.order === "sequential" ? Array.from({ length: n }, (_, i) => i) : progressiveOrder(n);
      const tasks = order.map((idx) =>
        schedule(
          async (sig) => {
            const url = single ?? frameUrl(dir, manifest!.pattern, idx + 1);
            const blob = await fetchFrameBlob(url, sig);
            if (sig.aborted) return;
            this.blobs[idx] = blob;
            if (this.wanted(idx)) this.pump();
          },
          () => this.priority(),
          signal,
        ).catch((err: unknown) => {
          if (signal.aborted) return;
          failed++;
          this.broken.add(idx);
          if (failed === n) {
            console.warn("[story] every frame failed for", source.dir, err);
            this.setSnap({ status: "error" });
          }
        }),
      );
      await Promise.allSettled(tasks);
    };

    run().catch((err) => {
      if (!signal.aborted) {
        console.warn("[story] sequence load failed", source.dir, err);
        this.setSnap({ status: "error" });
      }
    });
  }

  stop(): void {
    live.delete(this);
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    for (const f of this.frames) releaseFrame(f);
    this.frames = [];
    this.blobs = [];
    this.decoding = new Set();
    this.broken = new Set();
    this.center = 0;
    const keepMissing = this.snap.status === "missing";
    this.setSnap({ ...IDLE, status: keepMissing ? "missing" : "idle" });
  }
}

export function useFrameSequence(
  source: FrameSource,
  active: boolean,
  priority = 0,
): FrameSequence {
  // The controller is a mutable, long-lived object (it owns bitmaps and an
  // AbortController), so it lives in a ref and is only ever touched from
  // effects and callbacks — never during render. Lazily created on first use.
  const controllerRef = useRef<SequenceController | null>(null);
  const getController = useCallback((): SequenceController => {
    if (!controllerRef.current) controllerRef.current = new SequenceController();
    return controllerRef.current;
  }, []);

  // A fresh controller always starts at IDLE, so seeding from a constant is
  // the same as reading controller.snap would have been.
  const [snap, setSnap] = useState<Snapshot>(IDLE);
  const priorityRef = useRef(priority);

  useEffect(() => {
    priorityRef.current = priority;
  }, [priority]);

  useEffect(() => {
    const controller = getController();
    controller.priority = () => priorityRef.current;
    const off = controller.onSnapshot(setSnap);
    return () => {
      off();
      controller.stop();
    };
  }, [getController]);

  const { dir, hint, poster, none } = source;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const controller = getController();
    if (!active || hint === "pending") {
      controller.stop();
      return;
    }
    controller.start({ dir, hint, poster, none });
  }, [getController, active, dir, hint, poster, none]);

  const getFrame = useCallback((i: number) => getController().getFrame(i), [getController]);
  const nearestIndex = useCallback((i: number) => getController().nearestIndex(i), [getController]);
  const focus = useCallback((i: number) => getController().focus(i), [getController]);
  const subscribe = useCallback((fn: () => void) => getController().subscribe(fn), [getController]);

  return useMemo<FrameSequence>(
    () => ({ ...snap, getFrame, nearestIndex, focus, subscribe }),
    [snap, getFrame, nearestIndex, focus, subscribe],
  );
}
