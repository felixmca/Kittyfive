/**
 * Landmark vocabulary shared by the tracking hook (normalised video space),
 * the overlay (screen pixels) and the static mockup (fake screen pixels).
 *
 * "left"/"right" are the *person's* left and right, as MediaPipe reports them.
 * Nothing here depends on the DOM, so it is safe to import anywhere.
 */

export const LANDMARK_KEYS = [
  "nose",
  "leftEye",
  "rightEye",
  "leftEar",
  "rightEar",
  "leftShoulder",
  "rightShoulder",
  "leftHip",
  "rightHip",
] as const;

export type LandmarkKey = (typeof LANDMARK_KEYS)[number];

/** MediaPipe Pose (BlazePose 33-point topology) indices for the points we use. */
export const POSE_INDEX: Record<LandmarkKey, number> = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
};

/** A landmark normalised to the video frame: x,y in 0..1, visibility in 0..1. */
export interface LmPoint {
  x: number;
  y: number;
  visibility: number;
}

export type Landmarks = Record<LandmarkKey, LmPoint>;

/** A landmark in CSS pixels of the try-on container, `v` = visibility. */
export interface Pt {
  x: number;
  y: number;
  v: number;
}

export type ScreenPose = Record<LandmarkKey, Pt>;

/**
 * Map normalised video landmarks onto the container, reproducing what
 * `object-fit: cover` does to the video and, when `mirrored`, the CSS
 * `scaleX(-1)` on the front camera. Drawing the overlay in this mirrored
 * screen space (rather than mirroring the overlay canvas) keeps badges and
 * letters readable in both the live view and the saved photo.
 */
export function mapPose(
  lm: Landmarks,
  videoW: number,
  videoH: number,
  cw: number,
  ch: number,
  mirrored: boolean,
): ScreenPose {
  const scale = Math.max(cw / videoW, ch / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  const out: Partial<ScreenPose> = {};
  for (const key of LANDMARK_KEYS) {
    const p = lm[key];
    const nx = mirrored ? 1 - p.x : p.x;
    out[key] = { x: ox + nx * dw, y: oy + p.y * dh, v: p.visibility };
  }
  return out as ScreenPose;
}
