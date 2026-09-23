/**
 * Kitty's route across the living room: straight when nothing is in the way,
 * otherwise round the furniture. The furniture is layout.json's obstacles
 * (floor rectangles) grown by about her half-width; the route is the
 * shortest one through their corners (a visibility graph of a few dozen
 * nodes, solved once per walk, so there is nothing to tune per frame).
 *
 * Heights are handled by the caller (Kitty.tsx): a spot up on the furniture
 * has a floor `approach` point she jumps from, and routes run between floor
 * points.
 */
import { OBSTACLES, ROOM, type Vec3 } from "./spots";

/** Clearance round furniture, metres (half her width, and a little air). */
const PAD = 0.14;
const EPS = 1e-6;

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const RECTS: Rect[] = OBSTACLES.map((o) => ({ x0: o.x0 - PAD, x1: o.x1 + PAD, z0: o.z0 - PAD, z1: o.z1 + PAD }));

type P = [number, number];

const inside = (p: P, r: Rect) => p[0] > r.x0 + EPS && p[0] < r.x1 - EPS && p[1] > r.z0 + EPS && p[1] < r.z1 - EPS;

/** Does the segment a→b pass through the inside of r? (Liang–Barsky, edges don't count.) */
function crosses(a: P, b: P, r: Rect): boolean {
  const s = 1e-4; // a path along an edge or through a corner is fine
  const x0 = r.x0 + s;
  const x1 = r.x1 - s;
  const z0 = r.z0 + s;
  const z1 = r.z1 - s;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - x0],
    [dx, x1 - a[0]],
    [-dz, a[1] - z0],
    [dz, z1 - a[1]],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < EPS) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return t1 - t0 > EPS;
}

const clear = (a: P, b: P, rects: Rect[]) => rects.every((r) => !crosses(a, b, r));

const inRoom = (p: P) =>
  p[0] > ROOM.left + 0.1 && p[0] < ROOM.right - 0.1 && p[1] > ROOM.backZ + 0.1 && p[1] < ROOM.frontZ - 0.1;

/**
 * Floor waypoints from `from` to `to` (both floor points; y is ignored and
 * the waypoints are on the floor). The last point is `to` itself.
 */
export function route(from: Vec3, to: Vec3): Vec3[] {
  const a: P = [from[0], from[2]];
  const b: P = [to[0], to[2]];
  // Furniture she is standing against (or on) at either end does not block her.
  const rects = RECTS.filter((r) => !inside(a, r) && !inside(b, r));
  if (clear(a, b, rects)) return [to];

  const nodes: P[] = [a, b];
  for (const r of rects) {
    for (const c of [
      [r.x0, r.z0],
      [r.x1, r.z0],
      [r.x0, r.z1],
      [r.x1, r.z1],
    ] as P[]) {
      if (inRoom(c) && rects.every((o) => !inside(c, o))) nodes.push(c);
    }
  }
  // Dijkstra from node 0 to node 1 over the visible pairs.
  const n = nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prev = new Array<number>(n).fill(-1);
  const done = new Array<boolean>(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity || u === 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || v === u) continue;
      if (!clear(nodes[u], nodes[v], rects)) continue;
      const d = dist[u] + Math.hypot(nodes[v][0] - nodes[u][0], nodes[v][1] - nodes[u][1]);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (prev[1] < 0) return [to]; // boxed in: walk straight rather than stand still
  const out: Vec3[] = [];
  for (let v = prev[1]; v > 0; v = prev[v]) out.unshift([nodes[v][0], 0, nodes[v][1]]);
  out.push(to);
  return out;
}
