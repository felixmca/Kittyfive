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
    const res = await fetch(url, { signal, cache: "force-cache" });
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

/** Expand "%04d.webp" with a 1-based frame number. */
export function frameUrl(dir: string, pattern: string | undefined, index1: number): string {
  const pat = pattern ?? "%04d.webp";
  const name = pat.replace(/%0?(\d*)d/, (_m, width: string) =>
    String(index1).padStart(Number(width || "1"), "0"),
  );
  return `${dir.replace(/\/$/, "")}/${name}`;
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

/** Fetch one frame's compressed bytes. Rejects on HTTP errors and aborts. */
export async function fetchFrameBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const blob = await res.blob();
  if (signal?.aborted) throw abortError();
  return blob;
}

/** Decode compressed bytes into something a canvas can draw. */
export async function decodeFrameBlob(blob: Blob): Promise<FrameImage> {
  if (hasBitmap) {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some browsers reject WebP in createImageBitmap; fall through.
    }
  }
  return loadViaImage(blob);
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
