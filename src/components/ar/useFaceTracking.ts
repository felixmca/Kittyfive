"use client";
/**
 * The head, for the 3D cap: MediaPipe Tasks Vision FaceLandmarker with the
 * facial transformation matrix.
 *
 * What the cap needs is where the top of the forehead is on screen, how big
 * the head is, and which way it faces. So the tracker publishes, smoothed and
 * through a ref (no React state per frame):
 *
 *   anchor   landmark 10 (the top of the forehead, midline), normalised video
 *            coordinates
 *   width    the 3D distance between landmarks 234 and 454 (either side of the
 *            face at the cheekbones), in normalised video widths. Taken in 3D
 *            so a turned head does not shrink the cap
 *   quat     the head's rotation from the transformation matrix (camera space:
 *            x right, y up, z towards the camera)
 *
 * Same loading pattern as useLandmarks: the library is imported lazily, GPU
 * first then CPU, wasm from jsDelivr and the model from Google's storage; any
 * failure ends in "unavailable" and the try-on keeps its 2D cap.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { WASM_BASES, type TrackingStatus } from "./useLandmarks";

export const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export interface Head {
  anchor: { x: number; y: number };
  width: number;
  quat: [number, number, number, number];
  /** The video frame's aspect (width / height), so the renderer can undo object-fit. */
  aspect: number;
}

const FOREHEAD = 10;
const LEFT = 234;
const RIGHT = 454;
const SMOOTH = 0.4;
const SLERP = 0.35;
const MISSES_BEFORE_LOST = 8;
const ERRORS_BEFORE_GIVE_UP = 6;

/** Rotation quaternion from a column-major 4×4 matrix (scale removed). */
export function quatFromMatrix(m: number[]): [number, number, number, number] {
  // Columns are the rotated axes, possibly scaled: normalise each.
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
  const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
  const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const trace = r00 + r11 + r22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s;
    x = (r21 - r12) * s;
    y = (r02 - r20) * s;
    z = (r10 - r01) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2 * Math.sqrt(1 + r00 - r11 - r22);
    w = (r21 - r12) / s;
    x = 0.25 * s;
    y = (r01 + r10) / s;
    z = (r02 + r20) / s;
  } else if (r11 > r22) {
    const s = 2 * Math.sqrt(1 + r11 - r00 - r22);
    w = (r02 - r20) / s;
    x = (r01 + r10) / s;
    y = 0.25 * s;
    z = (r12 + r21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + r22 - r00 - r11);
    w = (r10 - r01) / s;
    x = (r02 + r20) / s;
    y = (r12 + r21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

function slerp(a: [number, number, number, number], b: [number, number, number, number], t: number): [number, number, number, number] {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (dot > 0.9995) {
    const r: [number, number, number, number] = [
      a[0] + t * (bx - a[0]),
      a[1] + t * (by - a[1]),
      a[2] + t * (bz - a[2]),
      a[3] + t * (bw - a[3]),
    ];
    const n = Math.hypot(...r) || 1;
    return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
  }
  const th0 = Math.acos(dot);
  const th = th0 * t;
  const s0 = Math.cos(th) - (dot * Math.sin(th)) / Math.sin(th0);
  const s1 = Math.sin(th) / Math.sin(th0);
  return [s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw];
}

export interface FaceTracking {
  head: RefObject<Head | null>;
  status: TrackingStatus;
}

export function useFaceTracking(videoRef: RefObject<HTMLVideoElement | null>, enabled: boolean): FaceTracking {
  const head = useRef<Head | null>(null);
  const [internal, setInternal] = useState<TrackingStatus>("loading");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let raf = 0;
    let landmarker: FaceLandmarker | null = null;
    let lastVideoTime = -1;
    let misses = 0;
    let errors = 0;

    const tick = () => {
      if (cancelled || !landmarker) return;
      raf = requestAnimationFrame(tick);
      const video = videoRef.current;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || video.paused) return;
      if (video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      let result: ReturnType<FaceLandmarker["detectForVideo"]>;
      try {
        result = landmarker.detectForVideo(video, performance.now());
      } catch (err) {
        errors += 1;
        if (errors >= ERRORS_BEFORE_GIVE_UP) {
          console.warn("[ar] face tracking keeps failing; off", err);
          cancelAnimationFrame(raf);
          head.current = null;
          setInternal("unavailable");
        }
        return;
      }
      errors = 0;
      const lm = result.faceLandmarks?.[0];
      const matrix = result.facialTransformationMatrixes?.[0]?.data;
      if (!lm || lm.length < 455 || !matrix || matrix.length < 16) {
        misses += 1;
        if (misses >= MISSES_BEFORE_LOST) head.current = null;
        return;
      }
      misses = 0;
      const aspect = video.videoWidth / video.videoHeight;
      const l = lm[LEFT];
      const r = lm[RIGHT];
      // Normalised x and z are in video widths, y in video heights.
      const width = Math.hypot(r.x - l.x, (r.y - l.y) / aspect, (r.z ?? 0) - (l.z ?? 0));
      const anchor = { x: lm[FOREHEAD].x, y: lm[FOREHEAD].y };
      const quat = quatFromMatrix(matrix);
      const prev = head.current;
      if (!prev) {
        head.current = { anchor, width, quat, aspect };
      } else {
        prev.anchor.x += SMOOTH * (anchor.x - prev.anchor.x);
        prev.anchor.y += SMOOTH * (anchor.y - prev.anchor.y);
        prev.width += SMOOTH * (width - prev.width);
        prev.quat = slerp(prev.quat, quat, SLERP);
        prev.aspect = aspect;
      }
    };

    const init = async () => {
      try {
        const mod = await import("@mediapipe/tasks-vision");
        if (cancelled) return;
        setInternal("loading");
        let created: FaceLandmarker | null = null;
        let lastErr: unknown = null;
        outer: for (const base of WASM_BASES) {
          let fileset: Awaited<ReturnType<typeof mod.FilesetResolver.forVisionTasks>>;
          try {
            fileset = await mod.FilesetResolver.forVisionTasks(base);
          } catch (err) {
            lastErr = err;
            continue;
          }
          if (cancelled) return;
          for (const delegate of ["GPU", "CPU"] as const) {
            try {
              const f = await mod.FaceLandmarker.createFromOptions(fileset, {
                baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
                runningMode: "VIDEO",
                numFaces: 1,
                outputFacialTransformationMatrixes: true,
                outputFaceBlendshapes: false,
                minFaceDetectionConfidence: 0.5,
                minFacePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5,
              });
              if (cancelled) {
                f.close();
                return;
              }
              created = f;
              break outer;
            } catch (err) {
              lastErr = err;
              console.warn(`[ar] FaceLandmarker (${delegate}) failed from ${base}`, err);
              if (cancelled) return;
            }
          }
        }
        if (!created) throw lastErr ?? new Error("FaceLandmarker unavailable");
        landmarker = created;
        setInternal("ready");
        raf = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[ar] face tracking unavailable; the 2D cap stays", err);
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
      head.current = null;
    };
  }, [enabled, videoRef]);

  return { head, status: enabled ? internal : "idle" };
}
