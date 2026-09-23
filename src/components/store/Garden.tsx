"use client";
/**
 * The garden behind the living room, seen through the glass door in the back
 * wall (Kitty's cat flap at the bottom of it): a lawn and paving, beds of
 * plants that sway in the breeze, a low wall, and the Thames beyond it (the
 * same shader as the window, bigger). Stylised stand-in until the Blender
 * house from Felix's photos exists (docs/HANDOVER-04-STORE-PHOTOS.md).
 *
 * Swaying reads the shared ambience clock, so there is no per-plant state.
 */
import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import RiverWindow from "./RiverWindow";
import { ambience } from "./ambience";
import { prefersReducedMotion } from "./motion";
import { ROOM } from "./spots";

/** The door in the back wall: centre x, width and height (m). */
export const GARDEN_DOOR = { x: -1.9, width: 0.92, height: 2.1 } as const;

const LAWN = "#56803f";
const LAWN_DARK = "#4a7036";
const PAVING = "#9b9489";
const WALL = "#a58b75";
const LEAF = "#3f7a45";
const LEAF_LIGHT = "#5b9a55";
const LEAF_DEEP = "#2f5f3a";
const BLOSSOM = "#e8b4c0";
const TERRACOTTA = "#b5673f";
const TRUNK = "#5a4030";

const BACK = ROOM.backZ; // the garden starts behind the back wall
const FAR = BACK - 3.6; // the low wall at the river end

/** Sways its children gently around their base; `phase` keeps neighbours out of step. */
export function Sway({
  children,
  position,
  amount = 0.05,
  speed = 1,
  phase = 0,
}: {
  children: ReactNode;
  position: [number, number, number];
  amount?: number;
  speed?: number;
  phase?: number;
}) {
  const group = useRef<THREE.Group>(null);
  const still = useRef(prefersReducedMotion());
  useFrame(() => {
    const g = group.current;
    if (!g || still.current) return;
    const t = ambience.time * speed + phase;
    g.rotation.z = amount * Math.sin(t) + amount * 0.35 * Math.sin(t * 2.3 + 1.7);
    g.rotation.x = amount * 0.5 * Math.sin(t * 0.8 + 0.6);
  });
  return (
    <group ref={group} position={position}>
      {children}
    </group>
  );
}

function Shrub({ position, scale = 1, color = LEAF, phase = 0 }: { position: [number, number, number]; scale?: number; color?: string; phase?: number }) {
  return (
    <Sway position={position} amount={0.035} speed={0.9} phase={phase}>
      <mesh position={[0, 0.28 * scale, 0]} scale={[scale, scale * 0.85, scale]}>
        <icosahedronGeometry args={[0.34, 1]} />
        <meshStandardMaterial color={color} roughness={0.95} flatShading />
      </mesh>
      <mesh position={[0.2 * scale, 0.42 * scale, 0.05]} scale={scale * 0.7}>
        <icosahedronGeometry args={[0.24, 1]} />
        <meshStandardMaterial color={LEAF_LIGHT} roughness={0.95} flatShading />
      </mesh>
    </Sway>
  );
}

function Grass({ position, phase = 0 }: { position: [number, number, number]; phase?: number }) {
  // A tuft of tall blades that bend together.
  const blades = [-0.08, -0.03, 0.02, 0.07, 0.11];
  return (
    <Sway position={position} amount={0.12} speed={1.6} phase={phase}>
      {blades.map((x, i) => (
        <mesh key={x} position={[x, 0.22 + (i % 2) * 0.05, (i % 3) * 0.03]} rotation-z={(x - 0.02) * 1.8}>
          <coneGeometry args={[0.025, 0.5 + (i % 2) * 0.12, 4]} />
          <meshStandardMaterial color={i % 2 ? LEAF_LIGHT : LEAF} roughness={1} flatShading />
        </mesh>
      ))}
    </Sway>
  );
}

function Tree({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.06, 0.09, 1.4, 8]} />
        <meshStandardMaterial color={TRUNK} roughness={1} />
      </mesh>
      <Sway position={[0, 1.4, 0]} amount={0.03} speed={0.6} phase={0.8}>
        <mesh position={[0, 0.35, 0]}>
          <icosahedronGeometry args={[0.62, 1]} />
          <meshStandardMaterial color={LEAF_DEEP} roughness={0.95} flatShading />
        </mesh>
        <mesh position={[0.35, 0.15, 0.2]}>
          <icosahedronGeometry args={[0.38, 1]} />
          <meshStandardMaterial color={LEAF} roughness={0.95} flatShading />
        </mesh>
        {/* A few blossoms, because it is her garden. */}
        {[
          [-0.3, 0.6, 0.35],
          [0.2, 0.75, 0.3],
          [0.45, 0.3, 0.45],
          [-0.45, 0.25, 0.3],
        ].map(([x, y, z]) => (
          <mesh key={`${x}:${y}`} position={[x, y, z]}>
            <sphereGeometry args={[0.05, 8, 6]} />
            <meshStandardMaterial color={BLOSSOM} roughness={0.8} />
          </mesh>
        ))}
      </Sway>
    </group>
  );
}

function Pot({ position, phase = 0 }: { position: [number, number, number]; phase?: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.14, 0]}>
        <cylinderGeometry args={[0.16, 0.12, 0.28, 16]} />
        <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
      </mesh>
      <Sway position={[0, 0.28, 0]} amount={0.06} speed={1.2} phase={phase}>
        <mesh position={[0, 0.2, 0]}>
          <coneGeometry args={[0.2, 0.46, 7]} />
          <meshStandardMaterial color={LEAF} roughness={0.9} flatShading />
        </mesh>
        <mesh position={[0.08, 0.14, 0.06]} rotation-z={-0.35}>
          <coneGeometry args={[0.12, 0.3, 6]} />
          <meshStandardMaterial color={LEAF_LIGHT} roughness={0.9} flatShading />
        </mesh>
      </Sway>
    </group>
  );
}

export default function Garden() {
  const cx = GARDEN_DOOR.x + 0.6;
  const depth = BACK - FAR;
  return (
    <group>
      {/* Lawn, with paving outside the door */}
      <mesh rotation-x={-Math.PI / 2} position={[cx, -0.005, (BACK + FAR) / 2]}>
        <planeGeometry args={[5.2, depth]} />
        <meshStandardMaterial color={LAWN} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[cx + 1.2, -0.003, (BACK + FAR) / 2 - 0.4]}>
        <circleGeometry args={[0.9, 24]} />
        <meshStandardMaterial color={LAWN_DARK} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[GARDEN_DOOR.x, 0.001, BACK - 0.55]}>
        <planeGeometry args={[1.4, 1.0]} />
        <meshStandardMaterial color={PAVING} roughness={0.95} />
      </mesh>

      {/* Beds along the sides and a tree */}
      <Shrub position={[GARDEN_DOOR.x - 1.3, 0, BACK - 1.0]} scale={1.1} phase={0.3} />
      <Shrub position={[GARDEN_DOOR.x - 1.1, 0, BACK - 2.4]} scale={1.3} color={LEAF_DEEP} phase={1.9} />
      <Shrub position={[GARDEN_DOOR.x + 1.6, 0, BACK - 2.9]} scale={0.9} phase={3.1} />
      <Tree position={[GARDEN_DOOR.x + 1.9, 0, BACK - 1.6]} />
      <Pot position={[GARDEN_DOOR.x + 0.75, 0, BACK - 0.35]} phase={0.4} />
      <Pot position={[GARDEN_DOOR.x - 0.7, 0, BACK - 0.3]} phase={2.2} />
      <Grass position={[GARDEN_DOOR.x - 0.3, 0, BACK - 2.0]} phase={0.5} />
      <Grass position={[GARDEN_DOOR.x + 0.4, 0, BACK - 2.6]} phase={2.6} />
      <Grass position={[GARDEN_DOOR.x + 1.1, 0, BACK - 1.1]} phase={4.0} />

      {/* A low wall at the river end, and the river beyond it */}
      <mesh position={[cx, 0.35, FAR]}>
        <boxGeometry args={[5.2, 0.7, 0.2]} />
        <meshStandardMaterial color={WALL} roughness={0.95} />
      </mesh>
      <RiverWindow width={16} height={7} horizon={0.36} scale={4} position={[cx, 1.6, FAR - 3.2]} />
    </group>
  );
}
