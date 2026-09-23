"use client";
/**
 * The one R3F canvas on /store: room, Kitty, the floating product, lights and
 * a camera rig that steps toward whichever spot Kitty is presenting from, then
 * hands the view back to the visitor's finger (limited OrbitControls).
 *
 * The light is day or evening (as it is at Kitty's in London, or as the
 * visitor flips it): <AmbienceClock/> eases the shared ambience record and
 * <Lights/> follows it, with the river window and the garden, every frame.
 */
import { useEffect, useMemo, useRef, type ComponentRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useUi } from "@/lib/store";
import { ambience, lerp } from "./ambience";
import Room, { FloorOnly } from "./Room";
import Kitty from "./Kitty";
import FloatingProduct from "./FloatingProduct";
import SceneErrorBoundary from "./SceneErrorBoundary";
import ScenePlaceholder from "./ScenePlaceholder";
import { useReducedMotion } from "./motion";
import { DOORWAY_CAMERA, spotFor } from "./spots";
import { useStoreState } from "./storeState";

const BG = "#0b0b0c";
const deg = THREE.MathUtils.degToRad;

export default function StoreScene() {
  const reduced = useReducedMotion();
  return (
    <Canvas
      className="h-full w-full"
      style={{ touchAction: "none" }}
      dpr={[1, 1.75]}
      shadows={false}
      frameloop="always"
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 50, near: 0.05, far: 40, position: DOORWAY_CAMERA.position }}
      fallback={<ScenePlaceholder variant="unsupported" />}
    >
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, 9, 22]} />
      <AmbienceClock reduced={reduced} />
      <Lights />
      <SceneErrorBoundary fallback={<FloorOnly />} label="room">
        <Room />
      </SceneErrorBoundary>
      <SceneErrorBoundary fallback={null} label="kitty">
        <Kitty />
      </SceneErrorBoundary>
      <SceneErrorBoundary fallback={null} label="product">
        <FloatingProduct />
      </SceneErrorBoundary>
      <CameraRig reduced={reduced} />
    </Canvas>
  );
}

/** Advances the shared clock and eases day ↔ evening (instantly under reduced motion). */
function AmbienceClock({ reduced }: { reduced: boolean }) {
  const mood = useStoreState((s) => s.lightMood);
  useEffect(() => {
    ambience.target = mood === "evening" ? 1 : 0;
    if (reduced) ambience.evening = ambience.target;
  }, [mood, reduced]);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    // Under reduced motion the river and the plants hold still.
    if (!reduced) ambience.time += dt;
    const d = ambience.target - ambience.evening;
    ambience.evening = Math.abs(d) < 0.002 ? ambience.target : ambience.evening + d * (1 - Math.exp(-dt * 2.4));
  });
  return null;
}

/** Day and evening versions of every light: [day, evening]. */
const LIGHT = {
  ambient: { intensity: [0.5, 0.2], color: ["#ffe9d2", "#ffcf9e"] },
  hemi: { intensity: [0.6, 0.22], sky: ["#9fc5ff", "#3b3f78"], ground: ["#3a2a20", "#24160f"] },
  river: { intensity: [2.2, 0.55], color: ["#cfe3ff", "#6f76c9"] },
  lamp: { intensity: [7, 13], color: ["#ffd9a0", "#ffc27a"] },
  counter: { intensity: [3.5, 5.5], color: ["#fff1dc", "#ffd8a8"] },
} as const;

function Lights() {
  const amb = useRef<THREE.AmbientLight>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const river = useRef<THREE.DirectionalLight>(null);
  const lamp = useRef<THREE.PointLight>(null);
  const counter = useRef<THREE.PointLight>(null);
  const colors = useMemo(() => {
    const pair = (p: readonly [string, string]) => [new THREE.Color(p[0]), new THREE.Color(p[1])] as const;
    return {
      ambient: pair(LIGHT.ambient.color),
      sky: pair(LIGHT.hemi.sky),
      ground: pair(LIGHT.hemi.ground),
      river: pair(LIGHT.river.color),
      lamp: pair(LIGHT.lamp.color),
      counter: pair(LIGHT.counter.color),
    };
  }, []);
  const last = useRef(-1);

  useFrame(() => {
    const e = ambience.evening;
    if (e === last.current) return;
    last.current = e;
    const set = (
      light: THREE.Light | null,
      intensity: readonly [number, number],
      color: readonly [THREE.Color, THREE.Color],
    ) => {
      if (!light) return;
      light.intensity = lerp(intensity[0], intensity[1], e);
      light.color.lerpColors(color[0], color[1], e);
    };
    set(amb.current, LIGHT.ambient.intensity, colors.ambient);
    set(river.current, LIGHT.river.intensity, colors.river);
    set(lamp.current, LIGHT.lamp.intensity, colors.lamp);
    set(counter.current, LIGHT.counter.intensity, colors.counter);
    const h = hemi.current;
    if (h) {
      h.intensity = lerp(LIGHT.hemi.intensity[0], LIGHT.hemi.intensity[1], e);
      h.color.lerpColors(colors.sky[0], colors.sky[1], e);
      h.groundColor.lerpColors(colors.ground[0], colors.ground[1], e);
    }
  });

  return (
    <>
      <ambientLight ref={amb} intensity={0.5} color="#ffe9d2" />
      <hemisphereLight ref={hemi} args={["#9fc5ff", "#3a2a20", 0.6]} />
      {/* River light through the window, from behind the back wall */}
      <directionalLight ref={river} position={[0.2, 2.4, -6]} intensity={2.2} color="#cfe3ff" />
      {/* Warm floor lamp by the sofa */}
      <pointLight ref={lamp} position={[-2.6, 1.5, -1.1]} intensity={7} color="#ffd9a0" distance={8} decay={2} />
      {/* Soft light over the kitchen counter */}
      <pointLight ref={counter} position={[2.4, 1.9, -0.9]} intensity={3.5} color="#fff1dc" distance={6} decay={2} />
    </>
  );
}

/** After the visitor moves the view themselves, leave it alone this long (ms). */
const HANDS_OFF_MS = 20_000;

function CameraRig({ reduced }: { reduced: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const productIndex = useUi((s) => s.productIndex);
  const wanderTo = useStoreState((s) => s.wanderTo);
  const anim = useRef({ active: false, pos: new THREE.Vector3(), look: new THREE.Vector3(), touchedAt: -Infinity });

  // Portrait phones get a wider vertical field of view so Kitty and the
  // product both fit; desktop keeps a natural 50.
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    cam.fov = size.width < size.height ? 62 : 50;
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  // Start looking into the room from the doorway. Set once, imperatively, so a
  // re-render never resets the visitor's view.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.target.set(...DOORWAY_CAMERA.look);
    c.update();
  }, []);

  useEffect(() => {
    const spot = spotFor(productIndex);
    const a = anim.current;
    a.pos.set(...spot.camera);
    a.look.set(...spot.look);
    if (reduced) {
      camera.position.copy(a.pos);
      const c = controls.current;
      if (c) {
        c.target.copy(a.look);
        c.update();
      }
      a.active = false;
    } else {
      a.active = true;
    }
  }, [productIndex, reduced, camera]);

  // When Kitty wanders off, glance after her (the camera stays where it is and
  // turns); when she comes back, look at her product again. Never while the
  // visitor is steering, or has just been.
  useEffect(() => {
    const a = anim.current;
    if (reduced || performance.now() - a.touchedAt < HANDS_OFF_MS) return;
    const spot = spotFor(useUi.getState().productIndex);
    a.pos.copy(camera.position);
    if (wanderTo) a.look.set(wanderTo[0], 0.35, wanderTo[2]);
    else {
      a.pos.set(...spot.camera);
      a.look.set(...spot.look);
    }
    a.active = true;
  }, [wanderTo, reduced, camera]);

  useFrame((_, rawDt) => {
    const a = anim.current;
    const c = controls.current;
    if (!a.active || !c) return;
    const k = 1 - Math.exp(-Math.min(rawDt, 0.1) * 2.2);
    camera.position.lerp(a.pos, k);
    c.target.lerp(a.look, k);
    if (camera.position.distanceToSquared(a.pos) < 1e-4 && c.target.distanceToSquared(a.look) < 1e-4) {
      a.active = false;
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableZoom
      enableDamping={!reduced}
      dampingFactor={0.08}
      rotateSpeed={0.6}
      minPolarAngle={deg(60)}
      maxPolarAngle={deg(95)}
      minAzimuthAngle={-deg(35)}
      maxAzimuthAngle={deg(35)}
      minDistance={1.2}
      maxDistance={4}
      onStart={() => {
        // The visitor took over; stop steering the camera.
        anim.current.active = false;
        anim.current.touchedAt = performance.now();
      }}
    />
  );
}
