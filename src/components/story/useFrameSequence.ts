"use client";
/**
 * useFrameSequence — lazily loads a scene's WebP frame sequence.
 *
 *   const seq = useFrameSequence({ dir: "/story/01-january-night", hint }, active, priority);
 *   seq.status      'idle' | 'loading' | 'ready' | 'missing' | 'error'
 *   seq.loaded / seq.total
 *   seq.getFrame(i) nearest decoded frame to i (or null)
 *   seq.subscribe(fn) fires whenever another frame lands
 *
 * Nothing is fetched until `active` is true. When `active` flips back to
 * false every bitmap is closed and the arrays are dropped, so the caller
 * (Story) decides how many scenes stay resident (three). The manifest is
 * cached module-wide, a 404 is remembered, and a scene the index.json says
 * has no media never even asks for a manifest.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchManifest,
  frameSize,
  frameUrl,
  loadFrame,
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

/**
 * The loader behind useFrameSequence, exported for code that drives frames
 * from its own animation loop (the landing's SwipeStory) rather than React.
 */
export class SequenceController {
  frames: (FrameImage | null)[] = [];
  snap: Snapshot = IDLE;
  private abort: AbortController | null = null;
  private frameListeners = new Set<() => void>();
  private snapListeners = new Set<(s: Snapshot) => void>();
  private raf = 0;
  priority = () => 0;

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
      this.setSnap({ total: n, loaded: 0, width: manifest.width, height: manifest.height });

      let failed = 0;
      const order = source.order === "sequential" ? Array.from({ length: n }, (_, i) => i) : progressiveOrder(n);
      const tasks = order.map((idx) =>
        schedule(
          async (sig) => {
            const url = single ?? frameUrl(dir, manifest!.pattern, idx + 1);
            const img = await loadFrame(url, sig);
            if (sig.aborted) {
              releaseFrame(img);
              return;
            }
            this.frames[idx] = img;
            const size = frameSize(img);
            const loaded = this.snap.loaded + 1;
            this.setSnap(
              {
                loaded,
                status: "ready",
                width: this.snap.width || size.width,
                height: this.snap.height || size.height,
              },
              loaded !== 1 && loaded !== n,
            );
            this.frameListeners.forEach((fn) => fn());
          },
          () => this.priority(),
          signal,
        ).catch((err: unknown) => {
          if (signal.aborted) return;
          failed++;
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
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    for (const f of this.frames) releaseFrame(f);
    this.frames = [];
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
  const subscribe = useCallback((fn: () => void) => getController().subscribe(fn), [getController]);

  return useMemo<FrameSequence>(
    () => ({ ...snap, getFrame, nearestIndex, subscribe }),
    [snap, getFrame, nearestIndex, subscribe],
  );
}
