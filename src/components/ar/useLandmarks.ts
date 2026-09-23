"use client";
/**
 * Body landmarks from the live camera via MediaPipe Tasks Vision
 * (PoseLandmarker, lite float16 model).
 *
 * - The library is imported lazily so it never enters the SSR graph or the
 *   initial bundle. Wasm comes from jsDelivr, the model from Google's public
 *   model storage (both remote dependencies; see the report).
 * - Delegate GPU first, CPU on failure. Any wasm/model fetch failure, and any
 *   run of consecutive detection errors, ends in status "unavailable": the
 *   overlay then pins itself to the screen centre instead of crashing.
 * - detectForVideo runs on animation frames, dropping to ~15 fps when a
 *   frame costs more than 40 ms (an EMA of the cost decides).
 * - Landmarks are exponentially smoothed (alpha 0.35) and delivered through a
 *   ref, so the 2D overlay can read them every frame without re-rendering.
 * - With `segmentation` (the fitted garments), the person's silhouette comes
 *   too: a small alpha canvas in video space, through `mask`, so the garment
 *   can be trimmed to the body.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { FilesetResolver, MPMask, NormalizedLandmark, PoseLandmarker } from "@mediapipe/tasks-vision";
import { ARM_INDEX, ARM_KEYS, LANDMARK_KEYS, POSE_INDEX, type Landmarks, type LmPoint } from "./landmarks";

export type TrackingStatus = "idle" | "loading" | "ready" | "unavailable";

/** Wasm runtime. The bare minor pin is what the spec asks for; the exact-version pin is a fallback in case the alias ever drifts from the installed JS bundle. */
export const WASM_BASES = [
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm",
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
];

/** Official Google-hosted PoseLandmarker lite (float16) model. */
export const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const SMOOTHING = 0.35;
const SLOW_FRAME_MS = 40;
const FAST_FRAME_MS = 24;
const MISSES_BEFORE_LOST = 8;
const ERRORS_BEFORE_GIVE_UP = 6;

/** Every landmark the tracker keeps: the body's, then the arms'. */
const TRACKED: [string, number][] = [
  ...LANDMARK_KEYS.map((k): [string, number] => [k, POSE_INDEX[k]]),
  ...ARM_KEYS.map((k): [string, number] => [k, ARM_INDEX[k]]),
];

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export interface LandmarkTracking {
  /** Smoothed, normalised landmarks; null when nobody is in frame or tracking is off. */
  landmarks: RefObject<Landmarks | null>;
  status: TrackingStatus;
  /** True while a person is being tracked. Changes rarely (it is debounced). */
  hasPerson: boolean;
  /** The person's silhouette in video space (alpha = person), when asked for. */
  mask: RefObject<PersonMask | null>;
}

export interface PersonMask {
  canvas: HTMLCanvasElement;
  /** performance.now() of the frame it came from. */
  at: number;
}

/** Longest side of the silhouette canvas: it is soft at the edges anyway. */
const MASK_MAX = 192;

export function useLandmarks(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  { segmentation = false }: { segmentation?: boolean } = {},
): LandmarkTracking {
  const landmarks = useRef<Landmarks | null>(null);
  const mask = useRef<PersonMask | null>(null);
  const [internal, setInternal] = useState<TrackingStatus>("loading");
  const [hasPerson, setHasPerson] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let raf = 0;
    let landmarker: PoseLandmarker | null = null;
    let personSeen = false;

    const publishPerson = (seenNow: boolean) => {
      if (seenNow !== personSeen) {
        personSeen = seenNow;
        setHasPerson(seenNow);
      }
    };

    // adaptive frame rate
    let minInterval = 0;
    let lastRun = 0;
    let costEma = 0;
    let lastVideoTime = -1;
    let misses = 0;
    let errors = 0;
    let masksOk = true;

    const tick = (now: number) => {
      if (cancelled || !landmarker) return;
      raf = requestAnimationFrame(tick);

      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.paused) return;
      if (now - lastRun < minInterval) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      lastRun = now;

      const t0 = performance.now();
      let poses: NormalizedLandmark[][];
      try {
        const result = landmarker.detectForVideo(video, t0);
        poses = result.landmarks;
        if (segmentation && masksOk) {
          // The silhouette fails on its own: a phone that cannot read it back
          // loses the trim, never the body tracking.
          try {
            const m = result.segmentationMasks?.[0];
            if (m) copyMask(m, t0);
          } catch (err) {
            masksOk = false;
            mask.current = null;
            console.warn("[ar] silhouette unavailable; garments are not trimmed", err);
          }
        }
        try {
          result.segmentationMasks?.forEach((x) => x.close());
        } catch {
          /* already released */
        }
      } catch (err) {
        errors += 1;
        if (errors >= ERRORS_BEFORE_GIVE_UP) {
          console.warn("[ar] pose detection keeps failing; tracking off", err);
          cancelAnimationFrame(raf);
          landmarks.current = null;
          publishPerson(false);
          setInternal("unavailable");
        }
        return;
      }
      errors = 0;

      const cost = performance.now() - t0;
      costEma = costEma === 0 ? cost : costEma * 0.8 + cost * 0.2;
      minInterval = costEma > SLOW_FRAME_MS ? 1000 / 15 : costEma > FAST_FRAME_MS ? 1000 / 24 : 0;

      const pose = poses[0];
      if (!pose || pose.length < 25) {
        misses += 1;
        if (misses >= MISSES_BEFORE_LOST) {
          landmarks.current = null;
          publishPerson(false);
        }
        return;
      }
      misses = 0;

      const prev = landmarks.current as unknown as Record<string, LmPoint> | null;
      if (!prev) {
        const fresh: Record<string, LmPoint> = {};
        for (const [key, index] of TRACKED) {
          const raw = pose[index];
          fresh[key] = { x: raw.x, y: raw.y, visibility: raw.visibility ?? 1 };
        }
        landmarks.current = fresh as unknown as Landmarks;
      } else {
        for (const [key, index] of TRACKED) {
          const raw = pose[index];
          const p = prev[key];
          if (!p) {
            prev[key] = { x: raw.x, y: raw.y, visibility: raw.visibility ?? 1 };
            continue;
          }
          p.x += SMOOTHING * (raw.x - p.x);
          p.y += SMOOTHING * (raw.y - p.y);
          p.visibility += SMOOTHING * ((raw.visibility ?? 1) - p.visibility);
        }
      }
      publishPerson(true);
    };

    // The silhouette, copied small into a canvas the overlay can draw from.
    let maskCanvas: HTMLCanvasElement | null = null;
    let maskImage: ImageData | null = null;
    const copyMask = (m: MPMask, at: number) => {
      const scale = Math.min(1, MASK_MAX / Math.max(m.width, m.height));
      const w = Math.max(1, Math.round(m.width * scale));
      const h = Math.max(1, Math.round(m.height * scale));
      if (!maskCanvas) maskCanvas = document.createElement("canvas");
      if (maskCanvas.width !== w || maskCanvas.height !== h || !maskImage) {
        maskCanvas.width = w;
        maskCanvas.height = h;
        maskImage = new ImageData(w, h);
      }
      const src = m.getAsFloat32Array();
      const d = maskImage.data;
      for (let y = 0; y < h; y++) {
        const row = Math.min(m.height - 1, Math.floor(y / scale)) * m.width;
        for (let x = 0; x < w; x++) {
          const v = src[row + Math.min(m.width - 1, Math.floor(x / scale))];
          const i = (y * w + x) * 4;
          d[i] = 255;
          d[i + 1] = 255;
          d[i + 2] = 255;
          d[i + 3] = v > 0 ? Math.min(255, Math.round(v * 255)) : 0;
        }
      }
      maskCanvas.getContext("2d")?.putImageData(maskImage, 0, 0);
      mask.current = { canvas: maskCanvas, at };
    };

    const init = async () => {
      try {
        const mod = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        setInternal("loading");

        let created: PoseLandmarker | null = null;
        let lastErr: unknown = null;

        outer: for (const base of WASM_BASES) {
          let fileset: Fileset;
          try {
            fileset = await mod.FilesetResolver.forVisionTasks(base);
          } catch (err) {
            lastErr = err;
            continue;
          }
          if (cancelled) return;
          for (const delegate of ["GPU", "CPU"] as const) {
            try {
              const lm = await mod.PoseLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: MODEL_URL, delegate },
                runningMode: "VIDEO",
                numPoses: 1,
                outputSegmentationMasks: segmentation,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              });
              if (cancelled) {
                lm.close();
                return;
              }
              created = lm;
              break outer;
            } catch (err) {
              lastErr = err;
              console.warn(`[ar] PoseLandmarker (${delegate}) failed from ${base}`, err);
              if (cancelled) return;
            }
          }
        }

        if (!created) throw lastErr ?? new Error("PoseLandmarker unavailable");
        landmarker = created;
        setInternal("ready");
        raf = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[ar] body tracking unavailable; overlay will pin to centre", err);
        if (!cancelled) setInternal("unavailable");
      }
    };

    void init();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try {
        landmarker?.close();
      } catch {
        // already closed
      }
      landmarker = null;
      landmarks.current = null;
      mask.current = null;
    };
  }, [enabled, videoRef, segmentation]);

  return {
    landmarks,
    status: enabled ? internal : "idle",
    hasPerson: enabled && hasPerson,
    mask,
  };
}
