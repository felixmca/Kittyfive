"use client";
/**
 * The living room and garden at Kitty's, modelled in Blender from Felix's
 * photos (scripts/store/room.py → /models/room.glb), with the Thames behind
 * everything (RiverBackdrop). While the model loads, or if it cannot, a bare
 * shell of the same room stands in, so Kitty always has a floor.
 *
 * The model is static; this file gives it its life, by name:
 *   · Sway_* nodes (the garden plants) move in the breeze;
 *   · Glow_* materials (lamps, the festoon lights, the lamp posts, the light
 *     the uplighters throw on the wall) are faint by day and warm at night;
 *   · Glass, Shadow and the koi rug get the blending they need on a phone.
 * Lights live in StoreScene.
 */
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ambience, lerp } from "./ambience";
import { prefersReducedMotion } from "./motion";
import RiverBackdrop from "./RiverBackdrop";
import SceneErrorBoundary from "./SceneErrorBoundary";
import { useAssetExists } from "./useAssetExists";
import { ROOM } from "./spots";

const ROOM_GLB = "/models/room.glb";

/** How bright each kind of glow is by day and in the evening (× what the model says). */
const GLOW: Record<string, [number, number]> = {
  Glow_Lamp: [0.35, 2.2],
  Glow_Wicker: [0.25, 2.6],
  Glow_Festoon: [0.0, 3.0],
  Glow_Globe: [0.05, 2.6],
};
/** The uplighters' wash on the wall: opacity by day and in the evening. */
const WASH: [number, number] = [0.12, 0.85];

export default function Room() {
  const hasGlb = useAssetExists(ROOM_GLB);
  return (
    <>
      <RiverBackdrop />
      {hasGlb === true ? (
        <SceneErrorBoundary fallback={<RoomShell />} label="room.glb">
          <Suspense fallback={<RoomShell />}>
            <RoomGlb />
          </Suspense>
        </SceneErrorBoundary>
      ) : (
        <RoomShell />
      )}
    </>
  );
}

interface Glow {
  material: THREE.MeshStandardMaterial;
  base: number;
  range: [number, number];
}

function RoomGlb() {
  const gltf = useGLTF(ROOM_GLB, "/draco/");
  const still = useRef(prefersReducedMotion());

  // Everything the room animates, found once by name.
  const live = useMemo(() => {
    const sway: { node: THREE.Object3D; phase: number; amount: number }[] = [];
    const glows: Glow[] = [];
    const washes: THREE.MeshStandardMaterial[] = [];
    const seen = new Set<THREE.Material>();
    gltf.scene.traverse((o) => {
      if (o.name.startsWith("Sway")) {
        const n = sway.length;
        sway.push({ node: o, phase: n * 1.7 + 0.4, amount: 0.045 });
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats as THREE.MeshStandardMaterial[]) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m.name === "Glass") {
          m.transparent = true;
          m.depthWrite = false;
          m.side = THREE.DoubleSide;
          mesh.renderOrder = 2;
        } else if (m.name === "Shadow") {
          m.transparent = true;
          m.depthWrite = false;
          m.polygonOffset = true;
          m.polygonOffsetFactor = -1;
          mesh.renderOrder = 1;
        } else if (m.name === "Rug_Koi") {
          m.transparent = false;
          m.alphaTest = 0.5;
          m.depthWrite = true;
        } else if (m.name === "Glow_Wash") {
          m.transparent = true;
          m.depthWrite = false;
          m.blending = THREE.AdditiveBlending;
          m.toneMapped = false;
          mesh.renderOrder = 3;
          washes.push(m);
        } else if (m.name in GLOW) {
          glows.push({ material: m, base: m.emissiveIntensity || 1, range: GLOW[m.name] });
        }
      }
    });
    return { sway, glows, washes };
  }, [gltf.scene]);

  const last = useRef(-1);
  useFrame(() => {
    const e = ambience.evening;
    if (e !== last.current) {
      last.current = e;
      for (const g of live.glows) g.material.emissiveIntensity = g.base * lerp(g.range[0], g.range[1], e);
      for (const w of live.washes) w.opacity = lerp(WASH[0], WASH[1], e);
    }
    if (still.current) return;
    for (const s of live.sway) {
      const t = ambience.time * 0.9 + s.phase;
      s.node.rotation.z = s.amount * Math.sin(t) + s.amount * 0.35 * Math.sin(t * 2.3 + 1.7);
      s.node.rotation.x = s.amount * 0.5 * Math.sin(t * 0.8 + 0.6);
    }
  });

  return <primitive object={gltf.scene} />;
}

const WIDTH = ROOM.right - ROOM.left;
const DEPTH = ROOM.frontZ - ROOM.backZ;
const CENTER_Z = (ROOM.backZ + ROOM.frontZ) / 2;

/** The bare room: floor, walls and ceiling, while the model loads (or if it fails). */
export function RoomShell() {
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ color: "#d9b27a", roughness: 0.6 }), []);
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: "#ece7dd", roughness: 0.95 }), []);
  useEffect(
    () => () => {
      floor.dispose();
      wall.dispose();
    },
    [floor, wall],
  );
  const h = ROOM.height;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, CENTER_Z]} material={floor}>
        <planeGeometry args={[WIDTH, DEPTH]} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, h, CENTER_Z]} material={wall}>
        <planeGeometry args={[WIDTH, DEPTH]} />
      </mesh>
      <mesh rotation-y={Math.PI / 2} position={[ROOM.left, h / 2, CENTER_Z]} material={wall}>
        <planeGeometry args={[DEPTH, h]} />
      </mesh>
      <mesh rotation-y={-Math.PI / 2} position={[ROOM.right, h / 2, CENTER_Z]} material={wall}>
        <planeGeometry args={[DEPTH, h]} />
      </mesh>
    </group>
  );
}

/** Minimal floor so Kitty still has something to stand on if everything else fails. */
export function FloorOnly() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, CENTER_Z]}>
      <planeGeometry args={[WIDTH, DEPTH]} />
      <meshStandardMaterial color="#d9b27a" roughness={0.6} />
    </mesh>
  );
}
