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
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
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
/** Sharpest the room is drawn (device pixels per CSS pixel), and the floor it may drop to. */
const DPR_MAX = 1.75;
const DPR_MIN = 1;
const deg = THREE.MathUtils.degToRad;

export default function StoreScene() {
  const reduced = useReducedMotion();
  // Draw fewer pixels when a phone cannot keep up, and more again when it
  // can; after a few swings either way it settles on the lowest. Not under
  // automation: the verify harness's software-rendered WebKit is slow enough
  // to trigger it, and headless WebKit stops showing any WebGL canvas after a
  // resize (a bare page does the same), a failure no phone has.
  const [adaptive] = useState(() => typeof navigator !== "undefined" && !navigator.webdriver);
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? DPR_MAX : Math.max(DPR_MIN, Math.min(DPR_MAX, window.devicePixelRatio || 1)),
  );
  return (
    <Canvas
      className="h-full w-full"
      style={{ touchAction: "none" }}
      dpr={dpr}
      shadows={false}
      frameloop="always"
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 50, near: 0.05, far: 40, position: DOORWAY_CAMERA.position }}
      fallback={<ScenePlaceholder variant="unsupported" />}
    >
      {adaptive ? (
        <PerformanceMonitor
          factor={1}
          flipflops={3}
          onChange={({ factor }) => {
            const top = Math.min(DPR_MAX, window.devicePixelRatio || 1);
            setDpr(Math.max(DPR_MIN, Math.round((DPR_MIN + (top - DPR_MIN) * factor) * 4) / 4));
          }}
          onFallback={() => setDpr(DPR_MIN)}
        />
      ) : null}
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
      <PerfProbe />
    </Canvas>
  );
}

/** Advances the shared clock and eases day ↔ evening (instantly under reduced motion). */
function AmbienceClock({ reduced }: { reduced: boolean }) {
  const mood = useStoreState((s) => s.lightMood);
  const first = useRef(true);
  useEffect(() => {
    ambience.target = mood === "evening" ? 1 : 0;
    // The room opens in its light; only a flip of the toggle eases.
    if (reduced || first.current) ambience.evening = ambience.target;
    first.current = false;
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

/**
 * For the verify harness and performance checks: window.__storePerf() says
 * when the first frame was drawn (ms since navigation), recent frame times
 * and what one frame costs the GPU (draw calls, triangles).
 */
function PerfProbe() {
  const gl = useThree((s) => s.gl);
  const perf = useRef({ first: 0, times: new Float32Array(240), n: 0, last: 0 });
  useEffect(() => {
    const w = window as Window & { __storePerf?: () => unknown };
    w.__storePerf = () => {
      const p = perf.current;
      const count = Math.min(p.n, p.times.length);
      const times = Array.from(p.times.slice(0, count)).sort((a, b) => a - b);
      const at = (q: number) => (count ? Math.round(times[Math.min(count - 1, Math.floor(q * count))] * 10) / 10 : 0);
      return {
        firstFrameMs: Math.round(p.first),
        frames: p.n,
        medianMs: at(0.5),
        p95Ms: at(0.95),
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        pixelRatio: gl.getPixelRatio(),
      };
    };
    return () => {
      delete w.__storePerf;
    };
  }, [gl]);
  useFrame(() => {
    const p = perf.current;
    const now = performance.now();
    if (!p.first) p.first = now;
    else p.times[p.n++ % p.times.length] = now - p.last;
    p.last = now;
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
