"use client";
/**
 * RippleGrid: a grid of tiles you can drag into a new order, where the tiles
 * behave like things floating on water rather than cards in a spreadsheet.
 *
 *   · Every tile is a mass on a spring anchored to its grid slot, slightly
 *     under-damped, so it overshoots a touch and settles.
 *   · The tile you hold follows your finger, with a little magnetism towards
 *     the slot it is over.
 *   · Tiles near it are pushed away (repulsion falling off with distance), so
 *     the grid parts around your finger as you move.
 *   · When the order changes, the tiles that have to move set off one after
 *     another, starting next to the gap: the reflow travels as a wave.
 *   · When you let go, the landing sends a ripple through all of them: each
 *     gets a small push away from the landing point, delayed by its distance,
 *     and the springs bring them home.
 *
 * Layout is plain CSS grid; the physics only ever writes `transform`, from one
 * requestAnimationFrame loop that stops when everything is at rest. React
 * state changes once per drop. After the parent re-renders in the new order,
 * each tile keeps its on-screen position (FLIP) and springs into its new slot.
 *
 * Input: a grip button on each tile (mouse, touch, pen: starts at once), a
 * long press anywhere on a tile (touch), a short drag with the mouse, or the
 * keyboard on the grip (Space to pick up, arrows to move, Space to drop,
 * Escape to cancel), announced through a live region. Under reduced motion
 * the springs are critically damped and there is no wave or ripple.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export interface RippleGridItem {
  id: string;
  /** Spoken in announcements ("A cold night"). */
  label: string;
}

export interface GripProps {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void;
  "aria-label": string;
  "aria-describedby": string;
  "aria-pressed": boolean;
  "data-ripple-grip": "";
}

export interface TileRenderState {
  dragging: boolean;
  lifted: boolean;
  grip: GripProps;
  /** Call from the tile's click handler: false when the click ended a drag. */
  shouldHandleClick: () => boolean;
  /** Spread on the tile element: long-press (touch) and drag (mouse) starts. */
  surface: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  };
}

interface Props<T extends RippleGridItem> {
  items: T[];
  editable: boolean;
  renderItem: (item: T, state: TileRenderState) => ReactNode;
  onReorder: (ids: string[]) => void;
  className?: string;
  /** Rendered after the tiles, inside the grid (an "add" tile). Never moves. */
  trailing?: ReactNode;
  /** For the instructions read to screen readers ("chapter"). */
  noun?: string;
}

interface Body {
  id: string;
  el: HTMLElement | null;
  hx: number; // home: untransformed layout position, relative to the grid
  hy: number;
  w: number;
  h: number;
  x: number; // offset from home: the rendered translate
  y: number;
  vx: number;
  vy: number;
  tx: number; // spring target offset
  ty: number;
  stx: number; // staged target: becomes the target at activateAt
  sty: number;
  activateAt: number;
  ix: number; // queued impulse (px/s), applied at impulseAt
  iy: number;
  impulseAt: number;
  s: number; // scale, with its own spring
  vs: number;
  ts: number;
}

interface Drag {
  id: string;
  pointerId: number;
  grabX: number; // pointer offset inside the tile at pick-up
  grabY: number;
  clientX: number;
  clientY: number;
  index: number; // current slot in `virtual`
  moved: boolean;
  vx: number;
  vy: number;
  lastT: number;
  kind: "pointer" | "keyboard";
}

interface Pending {
  pointerId: number;
  timer: number;
  move: (e: PointerEvent) => void;
  end: (e: PointerEvent) => void;
}

// Springs (unit mass). zeta ≈ 0.62 gives a small overshoot and a quick settle.
const K = 360;
const C = 2 * 0.62 * Math.sqrt(K);
const C_CALM = 2 * Math.sqrt(K); // reduced motion: critically damped
const K_SCALE = 420;
const C_SCALE = 2 * 0.7 * Math.sqrt(K_SCALE);

const REPEL_PX = 16; // how far the nearest neighbour is nudged away
const REPEL_RADIUS = 1.35; // × tile diagonal
const MAGNET = 0.2; // pull of the held tile towards the slot under it
const STAGGER_MS = 34; // reflow wave: delay per slot away from the gap
const SPLASH = 340; // px/s given by a landing, at the landing point
const WAVE_SPEED = 1100; // px/s: how fast the landing ripple travels
const LONG_PRESS_MS = 280;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 9;
const EDGE = 84; // auto-scroll zone at the viewport's top and bottom (px)

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** While a finger is holding a tile the page must not scroll. */
function blockTouchScroll(e: TouchEvent) {
  if (e.cancelable) e.preventDefault();
}

export default function RippleGrid<T extends RippleGridItem>({
  items,
  editable,
  renderItem,
  onReorder,
  className,
  trailing,
  noun = "tile",
}: Props<T>) {
  const gridRef = useRef<HTMLDivElement>(null);
  const bodies = useRef(new Map<string, Body>());
  const order = useRef<string[]>(items.map((i) => i.id)); // committed order
  const virtual = useRef<string[]>(items.map((i) => i.id)); // order while dragging
  const slots = useRef<{ x: number; y: number }[]>([]);
  const raf = useRef(0);
  const last = useRef(0);
  const calm = useRef(false);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<Pending | null>(null);
  const touchBlocked = useRef(false);
  const suppressClickUntil = useRef(0);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [liftedId, setLiftedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const instructionsId = `ripple-help-${useId().replace(/:/g, "")}`;

  const labels = useRef(new Map<string, string>());
  useEffect(() => {
    labels.current = new Map(items.map((i) => [i.id, i.label]));
  }, [items]);
  const labelOf = (id: string) => labels.current.get(id) ?? noun;

  // ── bodies ────────────────────────────────────────────────────────────────

  const body = (id: string): Body => {
    let b = bodies.current.get(id);
    if (!b) {
      b = { id, el: null, hx: 0, hy: 0, w: 0, h: 0, x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, stx: 0, sty: 0, activateAt: 0, ix: 0, iy: 0, impulseAt: 0, s: 1, vs: 0, ts: 1 };
      bodies.current.set(id, b);
    }
    return b;
  };

  const measureHomes = useCallback(() => {
    for (const b of bodies.current.values()) {
      if (!b.el) continue;
      b.hx = b.el.offsetLeft;
      b.hy = b.el.offsetTop;
      b.w = b.el.offsetWidth;
      b.h = b.el.offsetHeight;
    }
  }, []);

  const write = useCallback((b: Body) => {
    if (!b.el) return;
    const still = Math.abs(b.x) < 0.05 && Math.abs(b.y) < 0.05 && Math.abs(b.s - 1) < 0.0005;
    b.el.style.transform = still
      ? ""
      : `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0) scale(${b.s.toFixed(4)})`;
  }, []);

  const setTouchBlock = useCallback((on: boolean) => {
    if (on === touchBlocked.current) return;
    touchBlocked.current = on;
    if (on) document.addEventListener("touchmove", blockTouchScroll, { passive: false });
    else document.removeEventListener("touchmove", blockTouchScroll);
  }, []);

  // ── the loop ──────────────────────────────────────────────────────────────

  const stepRef = useRef<(now: number) => void>(() => {});
  useLayoutEffect(() => {
  stepRef.current = (now: number) => {
    raf.current = 0;
    const dt = Math.min(1 / 30, Math.max(0, (now - (last.current || now)) / 1000));
    last.current = now;
    const d = drag.current;
    const grid = gridRef.current;
    const damping = calm.current ? C_CALM : C;

    // Auto-scroll while a finger drags near the top or bottom edge.
    if (d?.kind === "pointer") {
      const vh = window.innerHeight;
      let speed = 0;
      if (d.clientY < EDGE) speed = -((EDGE - d.clientY) / EDGE) * 14;
      else if (d.clientY > vh - EDGE) speed = ((d.clientY - (vh - EDGE)) / EDGE) * 14;
      if (speed) window.scrollBy(0, speed);
    }

    // The held tile follows the pointer, pulled a little towards its slot.
    let heldCx = 0;
    let heldCy = 0;
    if (d && grid) {
      const held = bodies.current.get(d.id);
      if (held) {
        if (d.kind === "pointer") {
          const r = grid.getBoundingClientRect();
          let px = d.clientX - r.left - d.grabX;
          let py = d.clientY - r.top - d.grabY;
          const slot = slots.current[d.index];
          if (slot) {
            px += (slot.x - px) * MAGNET;
            py += (slot.y - py) * MAGNET;
          }
          held.x = px - held.hx;
          held.y = py - held.hy;
          held.vx = d.vx;
          held.vy = d.vy;
        }
        held.ts = 1.045;
        heldCx = held.hx + held.x + held.w / 2;
        heldCy = held.hy + held.y + held.h / 2;
      }
    }

    const substeps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / substeps;
    let energy = 0;

    for (const b of bodies.current.values()) {
      if (now >= b.activateAt) {
        b.tx = b.stx;
        b.ty = b.sty;
      }
      if (b.impulseAt && now >= b.impulseAt) {
        b.vx += b.ix;
        b.vy += b.iy;
        b.ix = b.iy = 0;
        b.impulseAt = 0;
      }
      const isHeld = d?.id === b.id;
      const followsPointer = isHeld && d?.kind === "pointer";

      // Repulsion from the held tile moves this tile's resting point.
      let rx = 0;
      let ry = 0;
      if (d && !isHeld && !calm.current) {
        const dx = b.hx + b.tx + b.w / 2 - heldCx;
        const dy = b.hy + b.ty + b.h / 2 - heldCy;
        const dist = Math.hypot(dx, dy) || 1;
        const radius = REPEL_RADIUS * Math.hypot(b.w, b.h);
        if (dist < radius) {
          const f = REPEL_PX * (1 - dist / radius) ** 2;
          rx = (dx / dist) * f;
          ry = (dy / dist) * f;
        }
      }

      if (!followsPointer) {
        for (let i = 0; i < substeps; i++) {
          b.vx += (K * (b.tx + rx - b.x) - damping * b.vx) * h;
          b.vy += (K * (b.ty + ry - b.y) - damping * b.vy) * h;
          b.x += b.vx * h;
          b.y += b.vy * h;
        }
      }
      if (!isHeld) b.ts = 1;
      for (let i = 0; i < substeps; i++) {
        b.vs += (K_SCALE * (b.ts - b.s) - C_SCALE * b.vs) * h;
        b.s += b.vs * h;
      }
      write(b);

      energy +=
        Math.abs(b.x - b.tx - rx) + Math.abs(b.y - b.ty - ry) +
        (Math.abs(b.vx) + Math.abs(b.vy)) * 0.02 +
        Math.abs(b.s - b.ts) * 100 +
        (b.impulseAt ? 1 : 0) +
        (now < b.activateAt ? 1 : 0);
    }

    if (d || energy > 0.2) {
      raf.current = requestAnimationFrame((t) => stepRef.current(t));
    } else {
      for (const b of bodies.current.values()) {
        b.x = b.tx;
        b.y = b.ty;
        b.vx = b.vy = 0;
        b.s = b.ts;
        write(b);
      }
      last.current = 0;
    }
  };
  });

  const kick = useCallback(() => {
    if (!raf.current) {
      last.current = 0;
      raf.current = requestAnimationFrame((t) => stepRef.current(t));
    }
  }, []);

  // ── ordering ──────────────────────────────────────────────────────────────

  /** Point every tile at the slot its place in `virtual` gives it. */
  const retarget = useCallback((from: number, now: number) => {
    virtual.current.forEach((id, v) => {
      const b = bodies.current.get(id);
      const slot = slots.current[v];
      if (!b || !slot) return;
      const sx = slot.x - b.hx;
      const sy = slot.y - b.hy;
      if (Math.abs(sx - b.stx) < 0.5 && Math.abs(sy - b.sty) < 0.5) return;
      b.stx = sx;
      b.sty = sy;
      b.activateAt = calm.current ? now : now + STAGGER_MS * Math.abs(v - from);
    });
  }, []);

  const moveTo = useCallback(
    (index: number) => {
      const d = drag.current;
      if (!d) return;
      const clamped = Math.max(0, Math.min(virtual.current.length - 1, index));
      if (clamped === d.index) return;
      const next = virtual.current.filter((id) => id !== d.id);
      next.splice(clamped, 0, d.id);
      virtual.current = next;
      d.index = clamped;
      retarget(clamped, performance.now());
      kick();
    },
    [kick, retarget],
  );

  const begin = useCallback(
    (id: string, kind: Drag["kind"], clientX = 0, clientY = 0, pointerId = -1) => {
      const grid = gridRef.current;
      const b = bodies.current.get(id);
      if (!grid || !b || !editable || drag.current) return;
      calm.current = reducedMotion();
      measureHomes();
      // Slot k is where the k-th tile of the committed order sits.
      slots.current = order.current.map((oid) => {
        const ob = bodies.current.get(oid);
        return { x: ob?.hx ?? 0, y: ob?.hy ?? 0 };
      });
      virtual.current = [...order.current];
      for (const ob of bodies.current.values()) {
        ob.stx = ob.tx;
        ob.sty = ob.ty;
      }
      const r = grid.getBoundingClientRect();
      drag.current = {
        id,
        pointerId,
        grabX: clientX - r.left - (b.hx + b.x),
        grabY: clientY - r.top - (b.hy + b.y),
        clientX,
        clientY,
        index: order.current.indexOf(id),
        moved: false,
        vx: 0,
        vy: 0,
        lastT: performance.now(),
        kind,
      };
      if (kind === "pointer") setDraggingId(id);
      else setLiftedId(id);
      const pos = order.current.indexOf(id) + 1;
      setAnnouncement(
        `Picked up ${labelOf(id)}, position ${pos} of ${order.current.length}.` +
          (kind === "keyboard" ? " Arrow keys move it, Space drops it, Escape cancels." : ""),
      );
      try {
        navigator.vibrate?.(8);
      } catch {
        /* unsupported */
      }
      kick();
    },
    // labelOf reads a ref, so it is stable in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editable, kick, measureHomes],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      setDraggingId(null);
      setLiftedId(null);
      setTouchBlock(false);
      if (d.moved) suppressClickUntil.current = performance.now() + 350;

      const now = performance.now();
      if (!commit) virtual.current = [...order.current];
      const finalOrder = virtual.current;
      const landingIndex = finalOrder.indexOf(d.id);
      retarget(landingIndex, now);
      const held = bodies.current.get(d.id);
      if (held) {
        held.tx = held.stx;
        held.ty = held.sty;
        held.activateAt = 0;
        held.ts = 1;
      }

      // The ripple: a push away from the landing point that arrives later the
      // further away a tile is.
      const landing = slots.current[landingIndex];
      if (commit && landing && held && !calm.current) {
        const lx = landing.x + held.w / 2;
        const ly = landing.y + held.h / 2;
        const reach = Math.hypot(held.w, held.h) * 3.2;
        finalOrder.forEach((id, v) => {
          if (id === d.id) return;
          const b = bodies.current.get(id);
          const slot = slots.current[v];
          if (!b || !slot) return;
          const dx = slot.x + b.w / 2 - lx;
          const dy = slot.y + b.h / 2 - ly;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist > reach) return;
          const f = SPLASH * (1 - dist / reach);
          b.ix = (dx / dist) * f;
          b.iy = (dy / dist) * f;
          b.impulseAt = now + (dist / WAVE_SPEED) * 1000;
        });
      }
      kick();

      const changed = finalOrder.some((id, i) => id !== order.current[i]);
      if (commit && changed) {
        setAnnouncement(`Dropped ${labelOf(d.id)} at position ${landingIndex + 1} of ${finalOrder.length}.`);
        onReorder([...finalOrder]);
      } else {
        setAnnouncement(commit ? `Dropped ${labelOf(d.id)}. Order unchanged.` : `Cancelled. ${labelOf(d.id)} is back where it was.`);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kick, onReorder, retarget, setTouchBlock],
  );

  // After the parent re-renders (new order, added or removed tiles): keep each
  // tile where it is on screen, then let the springs carry it home.
  const idsKey = items.map((i) => i.id).join("|");
  const lastKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (idsKey === lastKey.current) return; // same tiles, same order: nothing moved
    lastKey.current = idsKey;
    const ids = idsKey ? idsKey.split("|") : [];
    for (const id of [...bodies.current.keys()]) if (!ids.includes(id)) bodies.current.delete(id);
    const visual = new Map<string, { x: number; y: number } | null>();
    for (const b of bodies.current.values()) {
      visual.set(b.id, b.w > 0 ? { x: b.hx + b.x, y: b.hy + b.y } : null);
    }
    measureHomes();
    let moving = false;
    for (const b of bodies.current.values()) {
      const v = visual.get(b.id);
      if (v) {
        b.x = v.x - b.hx;
        b.y = v.y - b.hy;
      }
      b.tx = b.ty = b.stx = b.sty = 0;
      b.activateAt = 0;
      if (Math.abs(b.x) > 0.5 || Math.abs(b.y) > 0.5) moving = true;
      write(b);
    }
    order.current = ids;
    if (!drag.current) virtual.current = ids;
    if (moving) kick();
  }, [idsKey, kick, measureHomes, write]);

  // Re-measure when the grid resizes (the column count may change).
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!drag.current) measureHomes();
    });
    ro.observe(grid);
    return () => ro.disconnect();
  }, [measureHomes]);

  // ── pointer input ─────────────────────────────────────────────────────────

  const clearPending = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    window.removeEventListener("pointermove", p.move);
    window.removeEventListener("pointerup", p.end);
    window.removeEventListener("pointercancel", p.end);
    pending.current = null;
    if (!drag.current) setTouchBlock(false);
  }, [setTouchBlock]);

  useEffect(() => {
    if (!draggingId) return;
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const t = performance.now();
      const dt = Math.max(1, t - d.lastT) / 1000;
      d.vx = (e.clientX - d.clientX) / dt;
      d.vy = (e.clientY - d.clientY) / dt;
      d.lastT = t;
      d.clientX = e.clientX;
      d.clientY = e.clientY;
      d.moved = true;
      // Which slot is the held tile's centre over? Move only when another
      // slot is clearly nearer, so the order does not flicker on a border.
      const grid = gridRef.current;
      const held = bodies.current.get(d.id);
      if (grid && held) {
        const r = grid.getBoundingClientRect();
        const cx = e.clientX - r.left - d.grabX + held.w / 2;
        const cy = e.clientY - r.top - d.grabY + held.h / 2;
        let best = d.index;
        let bestDist = Infinity;
        slots.current.forEach((s, i) => {
          const dist = Math.hypot(s.x + held.w / 2 - cx, s.y + held.h / 2 - cy);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        });
        const cur = slots.current[d.index];
        const curDist = cur ? Math.hypot(cur.x + held.w / 2 - cx, cur.y + held.h / 2 - cy) : Infinity;
        if (best !== d.index && bestDist < curDist - 10) moveTo(best);
      }
      kick();
    };
    const onUp = (e: PointerEvent) => {
      if (drag.current && e.pointerId === drag.current.pointerId) finish(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [draggingId, finish, kick, moveTo]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      clearPending();
      setTouchBlock(false);
    },
    [clearPending, setTouchBlock],
  );

  /** Long press (touch, pen) or a short drag (mouse) anywhere on a tile. */
  const startPending = (id: string, e: ReactPointerEvent<HTMLElement>) => {
    if (!editable || drag.current || e.button > 0) return;
    // Controls inside the tile keep their own behaviour; the tile itself may
    // be a button (it opens the editor on click).
    const control = (e.target as HTMLElement).closest("[data-ripple-grip], a, button, input, textarea, select");
    if (control && control !== e.currentTarget) return;
    clearPending();
    const { clientX: startX, clientY: startY, pointerId, pointerType } = e;
    const isMouse = pointerType === "mouse";
    if (!isMouse) setTouchBlock(true); // armed now so no scroll can start mid-press
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
      if (isMouse && dist > MOUSE_SLOP) {
        clearPending();
        begin(id, "pointer", startX, startY, pointerId);
        const d = drag.current as Drag | null;
        if (d) {
          d.clientX = ev.clientX;
          d.clientY = ev.clientY;
          d.moved = true;
        }
      } else if (!isMouse && dist > TOUCH_SLOP) {
        clearPending(); // it was a scroll, not a long press
      }
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) clearPending();
    };
    const timer = isMouse
      ? 0
      : window.setTimeout(() => {
          if (!pending.current) return;
          const p = pending.current;
          window.removeEventListener("pointermove", p.move);
          window.removeEventListener("pointerup", p.end);
          window.removeEventListener("pointercancel", p.end);
          pending.current = null;
          begin(id, "pointer", startX, startY, pointerId);
        }, LONG_PRESS_MS);
    pending.current = { pointerId, timer, move, end };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  // ── keyboard input (on the grip) ──────────────────────────────────────────

  const onGripKey = (id: string, e: ReactKeyboardEvent<HTMLElement>) => {
    if (!editable) return;
    const d = drag.current;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (d?.kind === "keyboard") finish(true);
      else if (!d) begin(id, "keyboard");
      return;
    }
    if (d?.kind !== "keyboard") return;
    let to = -1;
    if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = d.index - 1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = d.index + 1;
    if (to >= 0 || e.key.startsWith("Arrow")) {
      e.preventDefault();
      moveTo(to);
      setAnnouncement(`${labelOf(d.id)}, position ${d.index + 1} of ${virtual.current.length}.`);
    }
  };

  // Keyboard lift: the held tile rises while the rest reflow around it.
  useEffect(() => {
    if (!liftedId) return;
    const b = bodies.current.get(liftedId);
    if (b) {
      b.ts = 1.045;
      kick();
    }
  }, [liftedId, kick]);

  const setItemEl = useCallback((id: string, el: HTMLElement | null) => {
    body(id).el = el;
  }, []);
  const shouldHandleClick = useCallback(() => performance.now() > suppressClickUntil.current, []);

  return (
    <div ref={gridRef} className={`relative ${className ?? ""}`} data-ripple-grid>
      {items.map((item) => {
        const dragging = draggingId === item.id;
        const lifted = liftedId === item.id;
        const state: TileRenderState = {
          dragging,
          lifted,
          grip: {
            onPointerDown: (e) => {
              if (!editable || e.button > 0) return;
              e.preventDefault();
              e.stopPropagation();
              clearPending();
              if (e.pointerType !== "mouse") setTouchBlock(true);
              begin(item.id, "pointer", e.clientX, e.clientY, e.pointerId);
            },
            onKeyDown: (e) => onGripKey(item.id, e),
            "aria-label": `Move ${item.label}`,
            "aria-describedby": instructionsId,
            "aria-pressed": lifted,
            "data-ripple-grip": "",
          },
          shouldHandleClick,
          surface: {
            onPointerDown: (e) => startPending(item.id, e),
            onContextMenu: (e) => {
              if (editable) e.preventDefault();
            },
          },
        };
        return (
          <RippleCell
            key={item.id}
            item={item}
            state={state}
            raised={dragging || lifted}
            editable={editable}
            onElement={setItemEl}
            render={renderItem}
          />
        );
      })}
      {trailing}
      <p id={instructionsId} className="sr-only">
        {`To move a ${noun}, focus its handle and press Space, use the arrow keys, then press Space again. Escape cancels. On a touch screen, press and hold a ${noun}, then drag.`}
      </p>
      <p className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </p>
    </div>
  );
}

/** One tile's wrapper: the element the physics moves. */
function RippleCell<T extends RippleGridItem>({
  item,
  state,
  raised,
  editable,
  onElement,
  render,
}: {
  item: T;
  state: TileRenderState;
  raised: boolean;
  editable: boolean;
  onElement: (id: string, el: HTMLElement | null) => void;
  render: (item: T, state: TileRenderState) => ReactNode;
}) {
  return (
    <div
      ref={(el) => onElement(item.id, el)}
      data-ripple-item={item.id}
      className="relative"
      style={{ zIndex: raised ? 30 : undefined, willChange: editable ? "transform" : undefined }}
    >
      {render(item, state)}
    </div>
  );
}
