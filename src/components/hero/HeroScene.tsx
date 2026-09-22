"use client";
/**
 * Everything inside the hero's R3F canvas: lights, the spinning/bouncing
 * camera, a contact shadow, and the pointer target.
 *
 * Pointer events live on ONE invisible hit box rather than on the camera's
 * two dozen meshes. R3F fires pointerout/pointerover as the cursor crosses
 * from one mesh to a sibling, which would re-trigger the shutter squash while
 * you simply move across the camera; a single box gives clean enter/leave and
 * a generous thumb-sized target on phones. three's Raycaster does not test
 * `visible`, so the box is never drawn (and never casts into the shadow) but
 * still catches taps.
 *
 * The Next.js router context does not cross the Canvas boundary (R3F is its
 * own React root), so navigation is a callback from Hero.
 */
import { Suspense, useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows } from "@react-three/drei";
import CameraModel, { CAMERA_CENTER_Y, CAMERA_HEIGHT } from "./CameraModel";
import GltfCamera from "./GltfCamera";
import ErrorBoundary from "./ErrorBoundary";

interface HeroSceneProps {
  /** Called on tap/click of the camera. Hero turns it into router.push. */
  onActivate: () => void;
  reducedMotion: boolean;
  /** True once Hero has confirmed /models/camera.glb exists. */
  useGlb: boolean;
}

/** One turn every 9 seconds. */
const SPIN_RATE = (Math.PI * 2) / 9;
/** Bounce amplitude: about 4% of the camera's height. */
const BOUNCE = CAMERA_HEIGHT * 0.04;
/** Where the camera floats: a little right of centre so the wordmark (bottom-left) has room. */
const FLOAT_X = 0.45;
const FLOAT_Y = 0.32;
const FLOOR_Y = FLOAT_Y - CAMERA_HEIGHT / 2 - BOUNCE - 0.03;
/** Static pose used when the visitor prefers reduced motion. */
const STILL_POSE = { x: 0.14, y: -0.55, z: 0.02 } as const;

/** Squash spring: stiff and fairly damped so it reads as a shutter, not jelly. */
const SPRING_K = 150;
const SPRING_C = 9.5;
const KICK_VELOCITY = -6.5;

function ProceduralCamera() {
  return (
    <group position={[0, -CAMERA_CENTER_Y, 0]}>
      <CameraModel />
    </group>
  );
}

export default function HeroScene({ onActivate, reducedMotion, useGlb }: HeroSceneProps) {
  const spinRef = useRef<THREE.Group>(null);
  const squashRef = useRef<THREE.Group>(null);
  const spring = useRef({ x: 0, v: 0 });
  const lastKick = useRef(0);
  const invalidate = useThree((s) => s.invalidate);

  const kick = useCallback(
    (strength: number) => {
      if (reducedMotion) return;
      const now = performance.now();
      if (now - lastKick.current < 140) return;
      lastKick.current = now;
      spring.current.v = KICK_VELOCITY * strength;
      invalidate();
    },
    [invalidate, reducedMotion],
  );

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const t = state.clock.elapsedTime;

    const spin = spinRef.current;
    if (spin) {
      if (reducedMotion) {
        spin.rotation.set(STILL_POSE.x, STILL_POSE.y, STILL_POSE.z);
        spin.position.y = 0;
      } else {
        spin.rotation.y = t * SPIN_RATE;
        spin.rotation.x = 0.14 + Math.sin(t * 0.9) * 0.05;
        spin.rotation.z = Math.sin(t * 0.7) * 0.05;
        spin.position.y = Math.sin(t * 1.7) * BOUNCE;
      }
    }

    const squash = squashRef.current;
    if (squash) {
      const s = spring.current;
      if (s.x !== 0 || s.v !== 0) {
        s.v += (-SPRING_K * s.x - SPRING_C * s.v) * dt;
        s.x += s.v * dt;
        if (Math.abs(s.x) < 1e-4 && Math.abs(s.v) < 1e-3) {
          s.x = 0;
          s.v = 0;
        }
        const sy = 1 + s.x;
        const sxz = 1 - s.x * 0.55;
        squash.scale.set(sxz, sy, sxz);
        // Keeps a "demand" frameloop ticking until the spring settles.
        invalidate();
      }
    }
  });

  // Reduced motion runs frameloop="demand"; make sure the still pose is drawn once.
  useEffect(() => {
    invalidate();
  }, [invalidate, reducedMotion, useGlb]);

  // Never leave the page with a stuck pointer cursor.
  useEffect(
    () => () => {
      if (typeof document !== "undefined") document.body.style.cursor = "";
    },
    [],
  );

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (typeof document !== "undefined") document.body.style.cursor = "pointer";
    kick(0.6);
  };
  const onOut = () => {
    if (typeof document !== "undefined") document.body.style.cursor = "";
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    kick(1);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    kick(1);
    onActivate();
  };

  return (
    <>
      {/* Lights only: no HDRI, no Environment, nothing fetched. */}
      <hemisphereLight args={["#4a4a56", "#0b0b0c", 0.7]} />
      <directionalLight position={[3, 4, 3.5]} intensity={2.4} color="#fff1dc" />
      <directionalLight position={[-3.5, 2.5, -3]} intensity={1.8} color="#8fb0ff" />
      <pointLight position={[1.2, 0.8, 3.2]} intensity={6} distance={9} decay={2} color="#ffffff" />

      <group position={[FLOAT_X, FLOAT_Y, 0]}>
        <group ref={spinRef}>
          <group ref={squashRef}>
            {useGlb ? (
              <ErrorBoundary fallback={<ProceduralCamera />} label="camera.glb">
                <Suspense fallback={<ProceduralCamera />}>
                  <GltfCamera />
                </Suspense>
              </ErrorBoundary>
            ) : (
              <ProceduralCamera />
            )}

            {/* Invisible hit box: the whole camera is one pointer target. */}
            <mesh
              visible={false}
              onPointerOver={onOver}
              onPointerOut={onOut}
              onPointerDown={onDown}
              onClick={onClick}
            >
              <boxGeometry args={[1.95, CAMERA_HEIGHT + 0.15, 1.7]} />
              <meshBasicMaterial />
            </mesh>
          </group>
        </group>
      </group>

      <ContactShadows
        position={[FLOAT_X, FLOOR_Y, 0]}
        opacity={0.6}
        scale={4.5}
        blur={2.6}
        far={CAMERA_HEIGHT + 0.3}
        resolution={256}
        color="#000000"
        frames={Infinity}
      />
    </>
  );
}
