"use client";
/**
 * Kitty the NPC. Owns her position, heading and walk state in refs and drives
 * them from useFrame; the model underneath (GLB if /models/kitty.glb exists,
 * otherwise the procedural cat) reads the shared KittyMotion record.
 *
 * Behaviour: on productIndex change she turns toward the new spot, walks there
 * in a straight line at WALK_SPEED (with a small hop when the spot is higher,
 * e.g. the kitchen counter), turns to the spot's facing yaw, sits, and the
 * speech bubble shows the product's pitch.
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
import { SPOTS, TURN_SPEED, WALK_SPEED, spotFor, type Spot } from "./spots";
import { useStoreState } from "./storeState";

const KITTY_GLB = "/models/kitty.glb";

type Mode = "idle" | "turning" | "walking" | "settling";

interface Walker {
  pos: THREE.Vector3;
  yaw: number;
  mode: Mode;
  target: Spot;
  targetIndex: number;
  start: THREE.Vector3;
  totalDist: number;
  hop: number;
}

export default function Kitty() {
  const productIndex = useUi((s) => s.productIndex);
  const group = useRef<THREE.Group>(null);
  const motion = useRef<KittyMotion>(createMotion());
  const dir = useMemo(() => new THREE.Vector3(), []);
  const goal = useMemo(() => new THREE.Vector3(), []);

  const walker = useRef<Walker | null>(null);
  if (walker.current === null) {
    const i = useUi.getState().productIndex;
    const spot = spotFor(i);
    walker.current = {
      pos: new THREE.Vector3(...spot.position),
      yaw: spot.yaw,
      mode: "idle",
      target: spot,
      targetIndex: i,
      start: new THREE.Vector3(...spot.position),
      totalDist: 0,
      hop: 0,
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
    w.target = spot;
    w.targetIndex = productIndex;
    if (prefersReducedMotion()) {
      w.pos.set(...spot.position);
      w.yaw = spot.yaw;
      w.mode = "idle";
      motion.current.moving = false;
      motion.current.speed = 0;
      useStoreState.getState().noteArrival(productIndex);
      return;
    }
    w.mode = "turning";
    useStoreState.getState().setArrivedIndex(null);
  }, [productIndex]);

  useFrame((_, rawDt) => {
    const w = walker.current;
    const g = group.current;
    if (!w || !g) return;
    const dt = Math.min(rawDt, 0.1);
    const m = motion.current;
    goal.set(...w.target.position);

    if (w.mode === "turning") {
      dir.copy(goal).sub(w.pos);
      if (Math.hypot(dir.x, dir.z) < 0.02) {
        w.mode = "settling";
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
        w.mode = "settling";
        m.moving = false;
        m.speed = 0;
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
        useStoreState.getState().noteArrival(w.targetIndex);
      } else {
        w.yaw += Math.sign(d) * step;
      }
    }

    g.position.copy(w.pos);
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

/** Rigged cat from /models/kitty.glb: normalised to ~0.36 m tall, walk/idle clips crossfaded. */
function KittyGlb({ motion }: { motion: RefObject<KittyMotion> }) {
  const root = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(KITTY_GLB, "/draco/");
  const { actions, names } = useAnimations(animations, root);
  const wasMoving = useRef<boolean | null>(null);

  const scale = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene);
    const h = box.max.y - box.min.y;
    return Number.isFinite(h) && h > 0 ? 0.36 / h : 1;
  }, [scene]);

  const walkName = names.find((n) => /walk|run|trot/i.test(n));
  const idleName = names.find((n) => /idle|sit|breath/i.test(n)) ?? names.find((n) => n !== walkName);

  useFrame(() => {
    const moving = motion.current.moving;
    if (moving === wasMoving.current) return;
    wasMoving.current = moving;
    const play = moving ? walkName : idleName;
    const stop = moving ? idleName : walkName;
    if (stop) actions[stop]?.fadeOut(0.25);
    if (play) actions[play]?.reset().fadeIn(0.25).play();
  });

  return (
    <group ref={root} scale={scale}>
      <primitive object={scene} />
    </group>
  );
}
