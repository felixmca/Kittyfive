"use client";
/**
 * Clip and photo work done in the owner's browser, so the server never has
 * to run ffmpeg:
 *
 *   · cutFrames: a clip from artta → N evenly spaced frames (WebP, or JPEG on
 *     Safari, which cannot encode WebP) at 720 px wide, the same shape
 *     scripts/build-story.mjs makes for the landing story. Seeking a <video>
 *     to each timestamp and drawing it is slow-ish (a few seconds for 72
 *     frames) but works on every browser, including iPhone Safari.
 *   · startFrame: a photo cropped to 9:16 around its focus point at up to
 *     1080×1920, as a JPEG to download and give Kling as the first frame.
 */

export interface CutFrames {
  blobs: Blob[];
  ext: "webp" | "jpg";
  width: number;
  height: number;
  duration: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener("seeked", done);
      video.removeEventListener("error", fail);
      reject(new Error("The browser could not read that part of the clip."));
    };
    video.addEventListener("seeked", done);
    video.addEventListener("error", fail);
    video.currentTime = t;
  });
}

export async function cutFrames(
  file: Blob,
  { count = 72, width = 720, onProgress }: { count?: number; width?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<CutFrames> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("This browser cannot open that video. Try the MP4 artta gave you."));
    });
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) throw new Error("That video has no length.");
    const w = Math.min(width, video.videoWidth);
    const h = Math.round((w * video.videoHeight) / video.videoWidth / 2) * 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas available.");
    ctx.imageSmoothingQuality = "high";

    // Decide the format once: browsers either encode WebP or they do not.
    const probe = await toBlob(canvas, "image/webp", 0.74);
    const ext: "webp" | "jpg" = probe?.type === "image/webp" ? "webp" : "jpg";
    const type = ext === "webp" ? "image/webp" : "image/jpeg";
    const quality = ext === "webp" ? 0.74 : 0.8;

    const blobs: Blob[] = [];
    for (let i = 0; i < count; i++) {
      const t = Math.min(duration - 0.02, ((i + 0.5) * duration) / count);
      await seek(video, t);
      ctx.drawImage(video, 0, 0, w, h);
      const blob = await toBlob(canvas, type, quality);
      if (!blob) throw new Error("Could not encode a frame.");
      blobs.push(blob);
      onProgress?.(i + 1, count);
    }
    return { blobs, ext, width: w, height: h, duration };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** Crop a photo to 9:16 around its focus point, at up to 1080×1920. */
export async function startFrame(imageUrl: string, focus: { x: number; y: number } | null): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = imageUrl;
  await img.decode();
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const target = 9 / 16;
  let cw = sw;
  let ch = sh;
  if (sw / sh > target) cw = Math.round(sh * target);
  else ch = Math.round(sw / target);
  const fx = focus?.x ?? 0.5;
  const fy = focus?.y ?? 0.42;
  const cx = Math.min(sw - cw, Math.max(0, Math.round(fx * sw - cw / 2)));
  // Kitty's face in the top two-thirds: the words sit on the bottom third.
  const cy = Math.min(sh - ch, Math.max(0, Math.round(fy * sh - ch * 0.38)));
  const outW = Math.min(1080, cw);
  const outH = Math.round(outW / target);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas available.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, cx, cy, cw, ch, 0, 0, outW, outH);
  const blob = await toBlob(canvas, "image/jpeg", 0.93);
  if (!blob) throw new Error("Could not make the start frame.");
  return blob;
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Run async jobs with at most `limit` in flight; resolves in input order. */
export async function pool<T, R>(items: T[], limit: number, job: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
