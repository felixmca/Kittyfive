/**
 * Living-room layout and Kitty's presentation spots.
 *
 * Units are metres. The floor is y = 0, the window is on the back wall at -z
 * and the visitor stands at the doorway at +z looking in. Yaw follows
 * three.js: 0 faces +z (toward the doorway), positive turns toward +x, so a
 * heading (dx, dz) is Math.atan2(dx, dz).
 *
 * Each spot carries a camera vantage point too: when Kitty walks to a spot the
 * camera eases from wherever it is to camera/look, then hands control back to
 * the visitor's finger. All vantage points sit inside the OrbitControls limits
 * (polar 60-95 deg, azimuth +/-35 deg, distance 1.2-4) so the clamp never
 * snaps.
 */
import type { ProductId } from "@/config/products";

export type Vec3 = [number, number, number];

export interface Spot {
  id: ProductId;
  /** Where Kitty's paws land. */
  position: Vec3;
  /** Which way she faces once she has arrived. */
  yaw: number;
  /** Where the product floats. */
  product: Vec3;
  /** Height of the surface under the product (floor or counter top). */
  surfaceY: number;
  /** Camera vantage point and look target once she has arrived. */
  camera: Vec3;
  look: Vec3;
}

export const ROOM = {
  left: -3,
  right: 3,
  backZ: -2.6,
  frontZ: 3.4,
  height: 2.7,
  counterHeight: 0.9,
} as const;

/** Where a person stands when they first step through the door. */
export const DOORWAY_CAMERA = {
  position: [0.2, 1.5, 3.0] as Vec3,
  look: [0, 0.6, -0.4] as Vec3,
};

export const SPOTS: Spot[] = [
  {
    id: "cap",
    position: [-1.5, 0, 0.9],
    yaw: 0.45,
    product: [-0.85, 0.9, 0.85],
    surfaceY: 0,
    camera: [-0.1, 1.4, 2.7],
    look: [-1.1, 0.45, 0.9],
  },
  {
    id: "hoodie",
    position: [2.6, ROOM.counterHeight, -0.5],
    yaw: -0.5,
    product: [1.95, 1.5, -0.4],
    surfaceY: ROOM.counterHeight,
    camera: [1.3, 1.5, 1.2],
    look: [2.3, 1.15, -0.45],
  },
  {
    id: "longsleeve",
    position: [0.4, 0, -1.7],
    yaw: 0.1,
    product: [1.05, 0.9, -1.6],
    surfaceY: 0,
    camera: [0.3, 1.35, 0.6],
    look: [0.75, 0.5, -1.65],
  },
];

export function wrapIndex(index: number, length: number): number {
  return ((Math.trunc(index) % length) + length) % length;
}

/** Wrap any integer (including negatives and out-of-range) onto a spot. */
export function spotFor(index: number): Spot {
  return SPOTS[wrapIndex(index, SPOTS.length)];
}

/**
 * Where Kitty wanders when nobody needs her (Kitty.tsx), and what she says
 * there. The garden door is in the back wall (Garden.tsx: x -1.9).
 */
export const POINTS_OF_INTEREST: { position: Vec3; yaw: number; line: string }[] = [
  { position: [0.25, 0, -2.1], yaw: Math.PI, line: "The river. I keep an eye on it." },
  { position: [-1.9, 0, -2.15], yaw: Math.PI, line: "The garden. Mostly mine." },
  { position: [-0.5, 0, 0.35], yaw: 0.6, line: "This is the good bit of rug." },
];

/** Kitty's walking pace, m/s. */
export const WALK_SPEED = 0.6;
/** How fast she turns on the spot, rad/s. */
export const TURN_SPEED = 3.5;
