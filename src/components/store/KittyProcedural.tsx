"use client";
/**
 * A black-and-white cat from primitives. Nose points +z at rotation 0.
 * Shoulder height about 0.29 m. Everything animated is mutated in useFrame
 * from the shared KittyMotion record; nothing here touches React state.
 */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { KittyMotion } from "./motion";

const BLACK = "#15151a";
const WHITE = "#f4f1ea";
const PINK = "#e2a3a9";
const GREEN = "#7dc56f";

const BODY_Y = 0.21;
const HIP_Y = 0.18;
const LEG_H = 0.15;
const TAIL_COUNT = 6;
const HEAD_POS = new THREE.Vector3(0, 0.11, 0.2);

interface Props {
  motion: RefObject<KittyMotion>;
}

export default function KittyProcedural({ motion }: Props) {
  const bodyGroup = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legFL = useRef<THREE.Group>(null);
  const legFR = useRef<THREE.Group>(null);
  const legBL = useRef<THREE.Group>(null);
  const legBR = useRef<THREE.Group>(null);
  const pupilL = useRef<THREE.Mesh>(null);
  const pupilR = useRef<THREE.Mesh>(null);
  const tail = useRef<(THREE.Mesh | null)[]>([]);
  const camLocal = useMemo(() => new THREE.Vector3(), []);

  const mats = useMemo(
    () => ({
      black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.55 }),
      white: new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.75 }),
      pink: new THREE.MeshStandardMaterial({ color: PINK, roughness: 0.8 }),
      green: new THREE.MeshStandardMaterial({
        color: GREEN,
        emissive: GREEN,
        emissiveIntensity: 0.25,
        roughness: 0.3,
      }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((state, rawDt) => {
    const m = motion.current;
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const damp = 1 - Math.exp(-dt * 10);

    // Walk cycle: diagonal pairs swing together, only while moving.
    if (m.moving) m.phase += dt * m.speed * 10;
    const swing = m.moving ? Math.sin(m.phase) * 0.55 : 0;
    const legs = [legFL.current, legBR.current, legFR.current, legBL.current];
    legs.forEach((leg, i) => {
      if (!leg) return;
      const target = i < 2 ? swing : -swing;
      leg.rotation.x = THREE.MathUtils.lerp(leg.rotation.x, target, damp);
    });

    // Sit down when idle, stand up before walking.
    const sitTarget = m.moving ? 0 : 1;
    m.sit += (sitTarget - m.sit) * (1 - Math.exp(-dt * 3));
    const sit = m.sit;
    if (legBL.current) legBL.current.scale.y = 1 - 0.5 * sit;
    if (legBR.current) legBR.current.scale.y = 1 - 0.5 * sit;

    const body = bodyGroup.current;
    if (body) {
      const bob = m.moving ? Math.abs(Math.sin(m.phase)) * 0.012 : Math.sin(t * 1.6) * 0.003;
      body.position.y = BODY_Y + bob - 0.045 * sit;
      body.rotation.x = -0.42 * sit;
    }

    // Tail: six beads along a sine-swayed curve, lazier when sat.
    const tailSpeed = m.moving ? 4 : 1.4;
    for (let i = 0; i < TAIL_COUNT; i++) {
      const bead = tail.current[i];
      if (!bead) continue;
      const f = i / (TAIL_COUNT - 1);
      bead.position.set(
        Math.sin(t * tailSpeed + f * 2.5) * (0.06 + 0.05 * sit) * f,
        -0.02 + f * f * 0.26 - sit * 0.12 * f,
        -0.19 - f * 0.16 * (1 - 0.35 * sit),
      );
    }

    // Head looks at the camera when idle, straight ahead when walking.
    const h = head.current;
    if (h && body) {
      let yaw = 0;
      let pitch = -0.1;
      if (!m.moving) {
        camLocal.copy(state.camera.position);
        body.worldToLocal(camLocal);
        camLocal.sub(HEAD_POS);
        yaw = THREE.MathUtils.clamp(Math.atan2(camLocal.x, camLocal.z), -0.9, 0.9);
        pitch = THREE.MathUtils.clamp(
          Math.atan2(camLocal.y, Math.hypot(camLocal.x, camLocal.z)),
          -0.35,
          0.5,
        );
      }
      const k = damp * 0.5;
      h.rotation.y = THREE.MathUtils.lerp(h.rotation.y, yaw, k);
      h.rotation.x = THREE.MathUtils.lerp(h.rotation.x, -pitch, k);
      if (pupilL.current && pupilR.current) {
        const px = yaw * 0.006;
        const py = pitch * 0.005;
        pupilL.current.position.set(-0.036 + px, 0.018 + py, 0.081);
        pupilR.current.position.set(0.036 + px, 0.018 + py, 0.081);
      }
    }
  });

  return (
    <group>
      {/* Body, bib, head and tail ride the body group so sitting tilts them together. */}
      <group ref={bodyGroup} position={[0, BODY_Y, 0]}>
        <mesh material={mats.black} scale={[1.05, 1, 2.0]}>
          <sphereGeometry args={[0.1, 24, 18]} />
        </mesh>
        {/* White chest bib */}
        <mesh material={mats.white} position={[0, -0.03, 0.14]} scale={[0.85, 1, 0.6]}>
          <sphereGeometry args={[0.075, 20, 14]} />
        </mesh>

        <group ref={head} position={HEAD_POS}>
          <mesh material={mats.black}>
            <sphereGeometry args={[0.085, 26, 20]} />
          </mesh>
          {/* White blaze down the face */}
          <mesh material={mats.white} position={[0, -0.01, 0.07]} scale={[0.5, 1, 0.5]}>
            <sphereGeometry args={[0.045, 16, 12]} />
          </mesh>
          {/* Eyes: green with black slit pupils */}
          <mesh material={mats.green} position={[-0.036, 0.018, 0.068]}>
            <sphereGeometry args={[0.016, 14, 10]} />
          </mesh>
          <mesh material={mats.green} position={[0.036, 0.018, 0.068]}>
            <sphereGeometry args={[0.016, 14, 10]} />
          </mesh>
          <mesh ref={pupilL} material={mats.black} position={[-0.036, 0.018, 0.081]} scale={[0.3, 1, 0.5]}>
            <sphereGeometry args={[0.011, 10, 8]} />
          </mesh>
          <mesh ref={pupilR} material={mats.black} position={[0.036, 0.018, 0.081]} scale={[0.3, 1, 0.5]}>
            <sphereGeometry args={[0.011, 10, 8]} />
          </mesh>
          {/* Nose */}
          <mesh material={mats.pink} position={[0, -0.02, 0.088]}>
            <sphereGeometry args={[0.009, 10, 8]} />
          </mesh>
          {/* Ears: black cones with a pink inner cone peeking out the front */}
          <group position={[-0.05, 0.075, -0.01]} rotation-z={0.28}>
            <mesh material={mats.black}>
              <coneGeometry args={[0.032, 0.07, 6]} />
            </mesh>
            <mesh material={mats.pink} position={[0, -0.006, 0.012]}>
              <coneGeometry args={[0.018, 0.048, 6]} />
            </mesh>
          </group>
          <group position={[0.05, 0.075, -0.01]} rotation-z={-0.28}>
            <mesh material={mats.black}>
              <coneGeometry args={[0.032, 0.07, 6]} />
            </mesh>
            <mesh material={mats.pink} position={[0, -0.006, 0.012]}>
              <coneGeometry args={[0.018, 0.048, 6]} />
            </mesh>
          </group>
        </group>

        {/* Tail beads, positioned every frame */}
        {Array.from({ length: TAIL_COUNT }, (_, i) => (
          <mesh
            key={i}
            material={mats.black}
            ref={(el) => {
              tail.current[i] = el;
            }}
          >
            <sphereGeometry args={[0.028 - i * 0.0022, 12, 10]} />
          </mesh>
        ))}
      </group>

      {/* Legs hang from the root so they stay planted while the body tilts. */}
      <Leg ref={legFL} x={-0.065} z={0.13} mats={mats} />
      <Leg ref={legFR} x={0.065} z={0.13} mats={mats} />
      <Leg ref={legBL} x={-0.065} z={-0.13} mats={mats} />
      <Leg ref={legBR} x={0.065} z={-0.13} mats={mats} />
    </group>
  );
}

interface LegProps {
  x: number;
  z: number;
  mats: { black: THREE.Material; white: THREE.Material };
  ref: RefObject<THREE.Group | null>;
}

function Leg({ x, z, mats, ref }: LegProps) {
  return (
    <group ref={ref} position={[x, HIP_Y, z]}>
      <mesh material={mats.black} position={[0, -LEG_H / 2, 0]}>
        <cylinderGeometry args={[0.024, 0.027, LEG_H, 10]} />
      </mesh>
      {/* White paw */}
      <mesh material={mats.white} position={[0, -LEG_H, 0.005]} scale={[1, 0.8, 1.15]}>
        <sphereGeometry args={[0.03, 12, 10]} />
      </mesh>
    </group>
  );
}
