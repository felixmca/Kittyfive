"use client";
/**
 * The one R3F canvas on /store: room, Kitty, the floating product, lights and
 * a camera rig that steps toward whichever spot Kitty is presenting from, then
 * hands the view back to the visitor's finger (limited OrbitControls).
 */
import { useEffect, useRef, type ComponentRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useUi } from "@/lib/store";
import Room, { FloorOnly } from "./Room";
import Kitty from "./Kitty";
import FloatingProduct from "./FloatingProduct";
import SceneErrorBoundary from "./SceneErrorBoundary";
import ScenePlaceholder from "./ScenePlaceholder";
import { useReducedMotion } from "./motion";
import { DOORWAY_CAMERA, spotFor } from "./spots";

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
      <fog attach="fog" args={[BG, 7, 15]} />
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

function Lights() {
  return (
    <>
      <ambientLight intensity={0.5} color="#ffe9d2" />
      <hemisphereLight args={["#9fc5ff", "#3a2a20", 0.6]} />
      {/* River light through the window, from behind the back wall */}
      <directionalLight position={[0.2, 2.4, -6]} intensity={2.2} color="#cfe3ff" />
      {/* Warm floor lamp by the sofa */}
      <pointLight position={[-2.6, 1.5, -1.1]} intensity={7} color="#ffd9a0" distance={8} decay={2} />
      {/* Soft light over the kitchen counter */}
      <pointLight position={[2.4, 1.9, -0.9]} intensity={3.5} color="#fff1dc" distance={6} decay={2} />
    </>
  );
}

function CameraRig({ reduced }: { reduced: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const productIndex = useUi((s) => s.productIndex);
  const anim = useRef({ active: false, pos: new THREE.Vector3(), look: new THREE.Vector3() });

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
      }}
    />
  );
}
