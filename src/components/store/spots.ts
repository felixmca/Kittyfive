/**
 * Living-room layout and Kitty's presentation spots, read from layout.json
 * (the same numbers the Blender build uses for the room, so where she walks
 * and what is in the way always agree).
 *
 * Units are metres. The floor is y = 0; the visitor stands at the dining end
 * (+z) looking towards the patio door and the garden (-z). Yaw follows
 * three.js: 0 faces +z (towards the visitor), positive turns toward +x, so a
 * heading (dx, dz) is Math.atan2(dx, dz).
 *
 * Each spot carries a camera vantage point too: when Kitty walks to a spot the
 * camera eases from wherever it is to camera/look, then hands control back to
 * the visitor's finger. All vantage points sit inside the OrbitControls limits
 * (polar 60-95 deg, azimuth +/-35 deg, distance 1.2-4) so the clamp never
 * snaps.
 */
import type { ProductId } from "@/config/products";
import layout from "./layout.json";

export type Vec3 = [number, number, number];

export interface Spot {
  id: ProductId;
  /** Where Kitty's paws land. */
  position: Vec3;
  /** Which way she faces once she has arrived. */
  yaw: number;
  /** For a spot up on the furniture: the floor point she jumps up from. */
  approach?: Vec3;
  /** Where the product floats. */
  product: Vec3;
  /** Height of the surface under the product (floor, table, sofa). */
  surfaceY: number;
  /** Radius of the glow under the product (smaller on a small table). */
  glow?: number;
  /** Camera vantage point and look target once she has arrived. */
  camera: Vec3;
  look: Vec3;
}

/** A rectangle of floor Kitty walks round (x0 < x1, z0 < z1). */
export interface Obstacle {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export const ROOM = {
  left: layout.room.left,
  right: layout.room.right,
  backZ: layout.room.back,
  frontZ: layout.room.front,
  height: layout.room.height,
} as const;

export const LAYOUT = layout;

/** Where a person stands when they first step in from the dining end. */
export const DOORWAY_CAMERA = {
  position: layout.camera.position as Vec3,
  look: layout.camera.look as Vec3,
};

const ORDER: ProductId[] = ["cap", "hoodie", "longsleeve"];

export const SPOTS: Spot[] = ORDER.map((id) => {
  const s = layout.spots[id] as Omit<Spot, "id">;
  return { id, ...s };
});

export const OBSTACLES: Obstacle[] = layout.obstacles;

export function wrapIndex(index: number, length: number): number {
  return ((Math.trunc(index) % length) + length) % length;
}

/** Wrap any integer (including negatives and out-of-range) onto a spot. */
export function spotFor(index: number): Spot {
  return SPOTS[wrapIndex(index, SPOTS.length)];
}

/**
 * Where Kitty wanders when nobody needs her (Kitty.tsx), and what she says
 * there: the open patio door (the river beyond the garden), her cat tree,
 * the good bit of rug.
 */
export const POINTS_OF_INTEREST: { position: Vec3; yaw: number; line: string }[] = layout.pois.map((p) => ({
  position: p.position as Vec3,
  yaw: p.yaw,
  line: p.line,
}));

/** Kitty's walking pace, m/s. */
export const WALK_SPEED = 0.6;
/** How fast she turns on the spot, rad/s. */
export const TURN_SPEED = 3.5;
