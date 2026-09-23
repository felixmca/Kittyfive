/**
 * Frame fetching primitives shared by useFrameSequence (story scenes) and the
 * Turntable: a global concurrency limiter with priorities, a manifest cache,
 * and a decode helper that prefers createImageBitmap and falls back to
 * <img> on browsers without it (old Safari).
 *
 * Every function here is browser-only; callers guard SSR.
 */

export interface FrameManifest {
  frames: number;
  width: number;
  height: number;
  /** printf-style, e.g. "%04d.webp". Defaults to "%04d.webp". */
  pattern?: string;
  /** Seconds of the clip the frames were cut from, when the pipeline knew it. */
  duration?: number;
  /** When the frames were built (manifest `builtAt`): frame URLs carry it, so a re-cut clip is fetched fresh. */
  version?: string;
}

export type FrameImage = ImageBitmap | HTMLImageElement;

/** Hard cap on in-flight fetches across every scene and the turntable. */
export const MAX_CONCURRENT = 6;

// ─── limiter ─────────────────────────────────────────────────────────────────

interface Job {
  start: () => void;
  priority: () => number;
  signal: AbortSignal;
}

const queue: Job[] = [];
let running = 0;

function abortError(): Error {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function pump(): void {
  while (running < MAX_CONCURRENT && queue.length) {
    let bestIndex = -1;
    let best = Number.POSITIVE_INFINITY;
    for (let i = 0; i < queue.length; i++) {
      const job = queue[i];
      if (job.signal.aborted) {
        queue.splice(i, 1);
        i--;
        continue;
      }
      const p = job.priority();
      if (p < best) {
        best = p;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) return;
    const [job] = queue.splice(bestIndex, 1);
    running++;
    job.start();
  }
}

/**
 * Run `task` when a slot is free. Lower `priority()` runs first; the getter
 * is re-read at pick time so a scene that becomes current jumps the queue.
 */
export function schedule<T>(
  task: (signal: AbortSignal) => Promise<T>,
  priority: () => number,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let started = false;
    const onAbort = () => {
      if (!started) reject(abortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    queue.push({
      priority,
      signal,
      start: () => {
        started = true;
        signal.removeEventListener("abort", onAbort);
        task(signal)
          .then(resolve, reject)
          .finally(() => {
            running--;
            pump();
          });
      },
    });
    pump();
  });
}

// ─── manifests ───────────────────────────────────────────────────────────────

const manifestCache = new Map<string, Promise<FrameManifest | null>>();

/**
 * Fetch `<dir>/manifest.json`. Resolves null when the file is missing (404 or
 * unparsable), so a scene with no media is a value, not an exception. Network
 * failures reject so the caller can show an error state instead of "missing".
 */
export function fetchManifest(dir: string, signal?: AbortSignal): Promise<FrameManifest | null> {
  const url = `${dir.replace(/\/$/, "")}/manifest.json`;
  const cached = manifestCache.get(url);
  if (cached) return cached;
  const p = (async () => {
    // no-cache: revalidated each visit (cheap: a 304), so a re-cut clip's new
    // frame count and version arrive at once.
    const res = await fetch(url, { signal, cache: "no-cache" });
    if (!res.ok) return null;
    try {
      const json = (await res.json()) as Partial<FrameManifest>;
      if (!json || typeof json.frames !== "number" || json.frames < 1) return null;
      return {
        frames: Math.floor(json.frames),
        width: typeof json.width === "number" ? json.width : 720,
        height: typeof json.height === "number" ? json.height : 1280,
        pattern: typeof json.pattern === "string" ? json.pattern : "%04d.webp",
        duration: typeof json.duration === "number" && json.duration > 0 ? json.duration : undefined,
        version: typeof (json as { builtAt?: unknown }).builtAt === "string" ? (json as { builtAt: string }).builtAt.replace(/\D/g, "").slice(0, 14) || undefined : undefined,
      };
    } catch {
      return null;
    }
  })();
  // Only cache settled outcomes we trust: a network error should be retried
  // next time the scene activates.
  manifestCache.set(url, p);
  p.catch(() => manifestCache.delete(url));
  return p;
}

/** Expand "%04d.webp" with a 1-based frame number (and the clip's version, when known). */
export function frameUrl(dir: string, pattern: string | undefined, index1: number, version?: string): string {
  const pat = pattern ?? "%04d.webp";
  const name = pat.replace(/%0?(\d*)d/, (_m, width: string) =>
    String(index1).padStart(Number(width || "1"), "0"),
  );
  return `${dir.replace(/\/$/, "")}/${name}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

// ─── decoding ────────────────────────────────────────────────────────────────

const hasBitmap = typeof globalThis !== "undefined" && typeof globalThis.createImageBitmap === "function";

function loadViaImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode failed"));
    };
    img.src = url;
  });
}

/**
 * A frame that has not arrived by then is given up on (and retried by the
 * caller): on a phone losing signal a request can hang for minutes, and six
 * hung requests would hold every download slot, stopping the story.
 */
const FRAME_TIMEOUT_MS = 15_000;

/** Fetch one frame's compressed bytes. Rejects on HTTP errors, aborts and timeouts. */
export async function fetchFrameBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw abortError();
  // The caller's signal and our timeout, combined by hand (AbortSignal.any is
  // too new for some iPhones).
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, FRAME_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const blob = await res.blob();
    if (signal?.aborted) throw abortError();
    return blob;
  } catch (err) {
    // A timeout is an ordinary failure (the caller retries), not the caller's abort.
    if (timedOut) throw new Error(`timed out ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// ─── decoding off the main thread ────────────────────────────────────────────
//
// Safari decodes createImageBitmap(blob) on the main thread (measured: a
// 576×1024 WebP held it for ~30–45 ms per frame in WebKit), which shows as
// jank while the story plays and decodes ahead. A worker does the same decode
// off the main thread and hands the bitmap back without a copy. Two workers,
// made from an inline script (no bundler setup). Any failure (no Worker, no
// createImageBitmap in workers, a decode error) falls back to the main thread,
// and after a few failures the workers are not used again.

const WORKER_SOURCE = `
self.onmessage = async (e) => {
  const { id, blob } = e.data;
  try {
    const bitmap = await createImageBitmap(blob);
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};`;

interface DecodeWorker {
  worker: Worker;
  busy: number;
}

let workers: DecodeWorker[] | null = null;
let workerFailures = 0;
let nextJob = 0;
const workerJobs = new Map<number, { resolve: (b: ImageBitmap) => void; reject: (e: Error) => void }>();

function decodeWorkers(): DecodeWorker[] | null {
  if (workers !== null) return workers.length ? workers : null;
  workers = [];
  if (typeof Worker === "undefined" || !hasBitmap || typeof URL === "undefined") return null;
  try {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const count = Math.max(1, Math.min(2, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(url);
      const entry: DecodeWorker = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent<{ id: number; bitmap?: ImageBitmap; error?: string }>) => {
        entry.busy--;
        const job = workerJobs.get(e.data.id);
        workerJobs.delete(e.data.id);
        if (!job) {
          e.data.bitmap?.close();
          return;
        }
        if (e.data.bitmap) job.resolve(e.data.bitmap);
        else job.reject(new Error(e.data.error ?? "worker decode failed"));
      };
      worker.onerror = () => {
        // A worker that cannot run at all: stop using workers, and let every
        // job still waiting fall back to the main thread.
        workerFailures = 99;
        for (const [id, job] of workerJobs) {
          workerJobs.delete(id);
          job.reject(new Error("decode worker failed"));
        }
      };
      workers.push(entry);
    }
  } catch {
    workers = [];
    return null;
  }
  return workers.length ? workers : null;
}

/** A worker that has not answered by then is treated as failed for that frame. */
const WORKER_TIMEOUT_MS = 4000;

function decodeInWorker(blob: Blob): Promise<ImageBitmap> | null {
  if (workerFailures >= 3) return null;
  const pool = decodeWorkers();
  if (!pool) return null;
  const entry = pool.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = ++nextJob;
  return new Promise<ImageBitmap>((resolve, reject) => {
    // Never wait forever: a silent worker would otherwise hold a decode slot
    // and stall whatever is waiting for this frame.
    const timer = setTimeout(() => {
      if (!workerJobs.has(id)) return;
      workerJobs.delete(id);
      reject(new Error("decode worker timed out"));
    }, WORKER_TIMEOUT_MS);
    workerJobs.set(id, {
      resolve: (b) => {
        clearTimeout(timer);
        resolve(b);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    entry.busy++;
    try {
      entry.worker.postMessage({ id, blob });
    } catch (err) {
      clearTimeout(timer);
      entry.busy--;
      workerJobs.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** Decode compressed bytes into something a canvas can draw (in a worker when the browser allows). */
export async function decodeFrameBlob(blob: Blob): Promise<FrameImage> {
  const job = decodeInWorker(blob);
  let workerFailed = false;
  if (job) {
    try {
      return await job;
    } catch {
      workerFailed = true;
    }
  }
  if (hasBitmap) {
    try {
      const bitmap = await createImageBitmap(blob);
      // The worker failed where the main thread did not: count it against the
      // workers. (A frame nobody can decode says nothing about them.)
      if (workerFailed) workerFailures++;
      return bitmap;
    } catch {
      // Some browsers reject WebP in createImageBitmap; fall through.
    }
  }
  const img = await loadViaImage(blob);
  if (workerFailed) workerFailures++;
  return img;
}

/** Fetch and decode one frame. Rejects on HTTP errors and aborts. */
export async function loadFrame(url: string, signal?: AbortSignal): Promise<FrameImage> {
  const blob = await fetchFrameBlob(url, signal);
  return decodeFrameBlob(blob);
}

/** Free a decoded frame. Bitmaps are closed; images are just dropped. */
export function releaseFrame(img: FrameImage | null | undefined): void {
  if (!img) return;
  if ("close" in img && typeof img.close === "function") {
    try {
      img.close();
    } catch {
      /* already closed */
    }
  } else if (img instanceof HTMLImageElement) {
    img.src = "";
  }
}

export function frameSize(img: FrameImage): { width: number; height: number } {
  if (img instanceof HTMLImageElement) {
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  }
  return { width: img.width, height: img.height };
}

/**
 * Progressive order for n frames: first, last, then every 8th, then the
 * gaps at stride 4, 2 and 1, so a half-loaded scene already scrubs.
 */
export function progressiveOrder(n: number): number[] {
  const order: number[] = [];
  const seen = new Uint8Array(Math.max(n, 0));
  const push = (i: number) => {
    if (i >= 0 && i < n && !seen[i]) {
      seen[i] = 1;
      order.push(i);
    }
  };
  push(0);
  push(n - 1);
  for (const stride of [8, 4, 2, 1]) {
    for (let i = 0; i < n; i += stride) push(i);
  }
  return order;
}
