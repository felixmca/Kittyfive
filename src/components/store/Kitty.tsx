"use client";
/**
 * Kitty the NPC. Owns her position, heading and walk state in refs and drives
 * them from useFrame; the model underneath (GLB if /models/kitty.glb exists,
 * otherwise the procedural cat) reads the shared KittyMotion record.
 *
 * Behaviour: on productIndex change she turns toward the new spot and walks
 * there at WALK_SPEED, round the furniture rather than through it (paths.ts),
 * jumping up when the spot is on the furniture (the ottoman) from its floor
 * approach point, and down again before she next walks anywhere. She turns to
 * the spot's facing yaw, sits, and the speech bubble shows the product's pitch.
 *
 * Left alone for a while (no product change, chat closed), she wanders off
 * like a cat: to the open patio door, then her cat tree, then the rug, one at
 * a time. She sits there, says something about it (storeState.poiLine), and
 * walks back to the product she was showing. Any tap on the arrows brings
 * her straight to the new product. Never under reduced motion.
 */
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useAnimations, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useUi } from "@/lib/store";
import KittyProcedural from "./KittyProcedural";
import SceneErrorBoundary from "./SceneErrorBoundary";
import SpeechBubble from "./SpeechBubble";
import { useAssetExists } from "./useAssetExists";
import { angleDelta, createMotion, prefersReducedMotion, type KittyMotion } from "./motion";
import { route } from "./paths";
import { POINTS_OF_INTEREST, SPOTS, TURN_SPEED, WALK_SPEED, spotFor, type Vec3 } from "./spots";
import { kittyTrack, useStoreState } from "./storeState";

const KITTY_GLB = "/models/kitty.glb";

/** Seconds at a product before she wanders off, and seconds she spends looking. */
const WANDER_AFTER = 16;
const WANDER_STAY = 7;

type Mode = "idle" | "turning" | "walking" | "settling";

/** Where she is going: a product spot, or a point of interest (index null). */
interface Goal {
  position: Vec3;
  yaw: number;
  /** For a goal up on the furniture: the floor point she jumps from. */
  approach?: Vec3;
}

interface Walker {
  pos: THREE.Vector3;
  yaw: number;
  mode: Mode;
  target: Goal;
  /** The product spot she belongs to (she returns there after wandering). */
  targetIndex: number;
  /** The point of interest she is at or heading to, or -1. */
  poi: number;
  /** Seconds idle at the current goal. */
  idle: number;
  /** Which point of interest is next. */
  nextPoi: number;
  /** The waypoints still to walk; the last is the goal itself. */
  legs: THREE.Vector3[];
  start: THREE.Vector3;
  totalDist: number;
  hop: number;
  /** While up on the furniture: the floor point to jump down to first. */
  perch: Vec3 | null;
}

/** Waypoints from where she is to the goal: down off any furniture, round the rest, up at the end. */
function planLegs(w: Walker, goal: Goal): THREE.Vector3[] {
  const legs: Vec3[] = [];
  let from: Vec3 = [w.pos.x, 0, w.pos.z];
  if (w.perch && w.pos.y > 0.2) {
    legs.push(w.perch);
    from = w.perch;
  }
  legs.push(...route(from, goal.approach ?? goal.position));
  if (goal.approach) legs.push(goal.position);
  return legs.map((p) => new THREE.Vector3(...p));
}

/** Set off for a new goal. */
function head(w: Walker, goal: Goal) {
  w.target = goal;
  w.legs = planLegs(w, goal);
  w.mode = "turning";
}

export default function Kitty() {
  const productIndex = useUi((s) => s.productIndex);
  const group = useRef<THREE.Group>(null);
  const motion = useRef<KittyMotion>(createMotion());
  const dir = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);

  const walker = useRef<Walker | null>(null);
  const reduced = useRef(prefersReducedMotion());
  if (walker.current === null) {
    const i = useUi.getState().productIndex;
    const spot = spotFor(i);
    walker.current = {
      pos: new THREE.Vector3(...spot.position),
      yaw: spot.yaw,
      mode: "idle",
      target: spot,
      targetIndex: i,
      poi: -1,
      idle: 0,
      nextPoi: 0,
      legs: [],
      start: new THREE.Vector3(...spot.position),
      totalDist: 0,
      hop: 0,
      perch: spot.position[1] > 0.2 ? (spot.approach ?? null) : null,
    };
  }

  // Tell the bubble where she starts (matters when the visitor arrives with a
  // productIndex already set from another page).
  useEffect(() => {
    useStoreState.getState().setArrivedIndex(walker.current?.targetIndex ?? 0);
  }, []);

  useEffect(() => {
    const w = walker.current;
    if (!w) return;
    const spot = spotFor(productIndex);
    if (spot === w.target && w.mode === "idle") return;
    w.targetIndex = productIndex;
    w.poi = -1;
    w.idle = 0;
    useStoreState.getState().setPoiLine(null);
    useStoreState.getState().setWanderTo(null);
    if (prefersReducedMotion()) {
      w.target = spot;
      w.legs = [];
      w.pos.set(...spot.position);
      w.yaw = spot.yaw;
      w.perch = spot.position[1] > 0.2 ? (spot.approach ?? null) : null;
      w.mode = "idle";
      motion.current.moving = false;
      motion.current.speed = 0;
      useStoreState.getState().noteArrival(productIndex);
      return;
    }
    head(w, spot);
    useStoreState.getState().setArrivedIndex(null);
  }, [productIndex]);

  useFrame((_, rawDt) => {
    const w = walker.current;
    const g = group.current;
    if (!w || !g) return;
    const dt = Math.min(rawDt, 0.1);
    const m = motion.current;
    if (w.legs.length) goal.copy(w.legs[0]);
    else goal.set(...w.target.position);

    if (w.mode === "turning") {
      dir.copy(goal).sub(w.pos);
      if (!w.legs.length) {
        w.mode = "settling";
      } else if (Math.hypot(dir.x, dir.z) < 0.02) {
        // Straight up or down: no need to face anywhere first.
        w.mode = "walking";
        w.start.copy(w.pos);
        w.totalDist = w.pos.distanceTo(goal);
        w.hop = Math.abs(goal.y - w.pos.y) > 0.2 ? 0.14 : 0;
        m.moving = true;
        m.speed = WALK_SPEED;
      } else {
        const want = Math.atan2(dir.x, dir.z);
        const d = angleDelta(w.yaw, want);
        const step = TURN_SPEED * dt;
        if (Math.abs(d) <= step) {
          w.yaw = want;
          w.mode = "walking";
          w.start.copy(w.pos);
          w.totalDist = w.pos.distanceTo(goal);
          w.hop = Math.abs(goal.y - w.pos.y) > 0.2 ? 0.14 : 0;
          m.moving = true;
          m.speed = WALK_SPEED;
        } else {
          w.yaw += Math.sign(d) * step;
        }
      }
    } else if (w.mode === "walking") {
      dir.copy(goal).sub(w.pos);
      const dist = dir.length();
      const step = WALK_SPEED * dt;
      if (dist <= step || w.totalDist <= 0) {
        w.pos.copy(goal);
        w.legs.shift();
        if (w.legs.length) {
          // Round the next corner (or up onto the furniture).
          w.mode = "turning";
        } else {
          w.mode = "settling";
          m.moving = false;
          m.speed = 0;
          w.perch = w.pos.y > 0.2 ? (w.target.approach ?? null) : null;
        }
      } else {
        dir.normalize().multiplyScalar(step);
        w.pos.add(dir);
        w.yaw = Math.atan2(dir.x, dir.z);
      }
    } else if (w.mode === "settling") {
      const d = angleDelta(w.yaw, w.target.yaw);
      const step = TURN_SPEED * dt;
      if (Math.abs(d) <= step) {
        w.yaw = w.target.yaw;
        w.mode = "idle";
        w.idle = 0;
        if (w.poi >= 0) useStoreState.getState().setPoiLine(POINTS_OF_INTEREST[w.poi].line);
        else useStoreState.getState().noteArrival(w.targetIndex);
      } else {
        w.yaw += Math.sign(d) * step;
      }
    } else if (w.mode === "idle" && !reduced.current) {
      // A cat left alone wanders off, has a look at something, and comes back.
      w.idle += dt;
      const busy = useUi.getState().chatOpen || useStoreState.getState().panelOpen;
      if (w.poi >= 0 && w.idle > WANDER_STAY) {
        w.poi = -1;
        head(w, spotFor(w.targetIndex));
        useStoreState.getState().setPoiLine(null);
        useStoreState.getState().setWanderTo(null);
      } else if (w.poi < 0 && w.idle > WANDER_AFTER && !busy) {
        w.poi = w.nextPoi;
        w.nextPoi = (w.nextPoi + 1) % POINTS_OF_INTEREST.length;
        head(w, POINTS_OF_INTEREST[w.poi]);
        useStoreState.getState().setArrivedIndex(null);
        useStoreState.getState().setWanderTo(POINTS_OF_INTEREST[w.poi].position);
      }
    }

    g.position.copy(w.pos);
    kittyTrack.x = w.pos.x;
    kittyTrack.z = w.pos.z;
    // Walking to a product, the camera goes ahead to the product instead.
    kittyTrack.strolling = w.mode === "walking" && w.poi >= 0;
    if (w.mode === "walking" && w.hop > 0 && w.totalDist > 0) {
      const u = THREE.MathUtils.clamp(w.start.distanceTo(w.pos) / w.totalDist, 0, 1);
      g.position.y += 4 * w.hop * u * (1 - u);
    }
    g.rotation.y = w.yaw;
  });

  return (
    <group ref={group} position={SPOTS[0].position}>
      <KittyModel motion={motion} />
      <SpeechBubble />
    </group>
  );
}

function KittyModel({ motion }: { motion: RefObject<KittyMotion> }) {
  const hasGlb = useAssetExists(KITTY_GLB);
  if (hasGlb !== true) return <KittyProcedural motion={motion} />;
  return (
    <SceneErrorBoundary fallback={<KittyProcedural motion={motion} />} label="kitty.glb">
      <Suspense fallback={<KittyProcedural motion={motion} />}>
        <KittyGlb motion={motion} />
      </Suspense>
    </SceneErrorBoundary>
  );
}

/** How far she turns her head to look at you (radians), split between neck and head. */
const LOOK_YAW = 0.9;
const LOOK_PITCH = 0.45;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Kitty from /models/kitty.glb (scripts/store/kitty.py): modelled at her real
 * size (about 0.34 m to the top of her head), "Walk" and "Idle" crossfaded
 * as she sets off and stops. Stood still, she turns her head to look at
 * the visitor, on top of whatever the clip is doing.
 */
function KittyGlb({ motion }: { motion: RefObject<KittyMotion> }) {
  const root = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(KITTY_GLB, "/draco/");
  const { actions, names } = useAnimations(animations, root);
  const wasMoving = useRef<boolean | null>(null);
  const look = useRef({ yaw: 0, pitch: 0 });
  const tmp = useMemo(
    () => ({ cam: new THREE.Vector3(), head: new THREE.Vector3(), right: new THREE.Vector3(), q: new THREE.Quaternion(), pq: new THREE.Quaternion(), axis: new THREE.Vector3() }),
    [],
  );

  // Authored in metres; only rescale a model that clearly is not.
  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y;
    return Number.isFinite(h) && h > 0.2 && h < 0.6 ? 1 : Number.isFinite(h) && h > 0 ? 0.36 / h : 1;
  }, [scene]);

  const bones = useMemo(() => {
    let head: THREE.Object3D | null = null;
    let neck: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      if (o.name === "head") head = o;
      if (o.name === "neck") neck = o;
    });
    return { head: head as THREE.Object3D | null, neck: neck as THREE.Object3D | null };
  }, [scene]);

  const walkName = names.find((n) => /walk|run|trot/i.test(n));
  const idleName = names.find((n) => /idle|sit|breath/i.test(n)) ?? names.find((n) => n !== walkName);

  /** Turn a bone by a rotation given in world space, on top of its animated pose. */
  const turn = (bone: THREE.Object3D, worldAxis: THREE.Vector3, angle: number) => {
    if (!bone.parent || Math.abs(angle) < 1e-4) return;
    bone.parent.getWorldQuaternion(tmp.pq);
    tmp.axis.copy(worldAxis).applyQuaternion(tmp.pq.invert());
    tmp.q.setFromAxisAngle(tmp.axis, angle);
    bone.quaternion.premultiply(tmp.q);
  };

  // Runs after useAnimations' own frame callback, so it adds to the clip's pose.
  useFrame((state, rawDt) => {
    const m = motion.current;
    if (m.moving !== wasMoving.current) {
      wasMoving.current = m.moving;
      const play = m.moving ? walkName : idleName;
      const stop = m.moving ? idleName : walkName;
      if (stop) actions[stop]?.fadeOut(0.25);
      if (play) actions[play]?.reset().fadeIn(0.25).play();
    }
    const g = root.current;
    const { head, neck } = bones;
    if (!g || !head || !neck) return;
    let yaw = 0;
    let pitch = 0;
    if (!m.moving) {
      tmp.cam.copy(state.camera.position);
      g.worldToLocal(tmp.cam);
      head.getWorldPosition(tmp.head);
      g.worldToLocal(tmp.head);
      tmp.cam.sub(tmp.head);
      yaw = THREE.MathUtils.clamp(Math.atan2(tmp.cam.x, tmp.cam.z), -LOOK_YAW, LOOK_YAW);
      pitch = THREE.MathUtils.clamp(Math.atan2(tmp.cam.y, Math.hypot(tmp.cam.x, tmp.cam.z)), -LOOK_PITCH * 0.5, LOOK_PITCH);
    }
    const k = 1 - Math.exp(-Math.min(rawDt, 0.1) * 4);
    look.current.yaw += (yaw - look.current.yaw) * k;
    look.current.pitch += (pitch - look.current.pitch) * k;
    // Her right, in the world: for nodding up and down.
    tmp.right.set(1, 0, 0).applyQuaternion(g.getWorldQuaternion(tmp.q));
    const { yaw: y, pitch: p } = look.current;
    turn(neck, UP, y * 0.4);
    turn(neck, tmp.right, -p * 0.35);
    turn(head, UP, y * 0.6);
    turn(head, tmp.right, -p * 0.65);
  });

  return (
    <group ref={root} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}
