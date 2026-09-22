"use client";
/**
 * A stylised compact camera built entirely from primitives, so it needs no
 * download and carries no licence. Faces +Z (the lens points at the viewer
 * when the group's rotation is zero).
 *
 * Layout (world units): the body spans y -0.5..0.5, the top plate ends at
 * 0.61 and the flash cube reaches 0.84, so the whole thing is CAMERA_HEIGHT
 * tall with its bounding-box centre at CAMERA_CENTER_Y. HeroScene shifts the
 * model down by CAMERA_CENTER_Y so it spins and squashes about its centre,
 * and GltfCamera normalises any real model to the same height.
 */
import { RoundedBox } from "@react-three/drei";
import type { ThreeElements } from "@react-three/fiber";

/** Total height of the procedural camera, flash included. */
export const CAMERA_HEIGHT = 1.34;
/** Vertical centre of the procedural camera's bounding box. */
export const CAMERA_CENTER_Y = 0.17;
/** Kitty's collar-tag yellow, also --accent in globals.css. */
export const ACCENT = "#ffd166";

const BODY = { color: "#1c1c20", roughness: 0.7, metalness: 0.15 } as const;
const GRIP = { color: "#121214", roughness: 0.95, metalness: 0 } as const;
const DARK_METAL = { color: "#2b2c32", roughness: 0.45, metalness: 0.6 } as const;
const METAL = { color: "#9a9ca3", roughness: 0.32, metalness: 0.9 } as const;
const YELLOW = { color: ACCENT, roughness: 0.5, metalness: 0.05 } as const;

const HALF_PI = Math.PI / 2;
/** Lens axis is offset a little to the right, like a real rangefinder. */
const LENS_X = 0.1;
const LENS_Y = 0.02;

type GroupProps = ThreeElements["group"];

export default function CameraModel(props: GroupProps) {
  return (
    <group {...props}>
      {/* Body */}
      <RoundedBox args={[1.6, 1.0, 0.7]} radius={0.1} smoothness={4}>
        <meshStandardMaterial {...BODY} />
      </RoundedBox>

      {/* Leatherette grip band, a hair larger than the body so it reads as a band */}
      <RoundedBox args={[1.64, 0.44, 0.74]} radius={0.06} smoothness={3} position={[0, -0.04, 0]}>
        <meshStandardMaterial {...GRIP} />
      </RoundedBox>

      {/* Top plate */}
      <RoundedBox args={[1.5, 0.12, 0.62]} radius={0.03} smoothness={3} position={[0, 0.55, 0]}>
        <meshStandardMaterial {...DARK_METAL} />
      </RoundedBox>

      {/* Lens mount ring against the body */}
      <mesh position={[LENS_X, LENS_Y, 0.37]} rotation={[HALF_PI, 0, 0]}>
        <cylinderGeometry args={[0.4, 0.4, 0.06, 48]} />
        <meshStandardMaterial {...DARK_METAL} />
      </mesh>

      {/* Lens barrel: outer */}
      <mesh position={[LENS_X, LENS_Y, 0.5]} rotation={[HALF_PI, 0, 0]}>
        <cylinderGeometry args={[0.34, 0.34, 0.3, 48]} />
        <meshStandardMaterial color="#202126" roughness={0.55} metalness={0.5} />
      </mesh>

      {/* Lens barrel: inner, stepping forward */}
      <mesh position={[LENS_X, LENS_Y, 0.7]} rotation={[HALF_PI, 0, 0]}>
        <cylinderGeometry args={[0.27, 0.29, 0.2, 48]} />
        <meshStandardMaterial color="#15161a" roughness={0.5} metalness={0.6} />
      </mesh>

      {/* Front rim */}
      <mesh position={[LENS_X, LENS_Y, 0.8]}>
        <torusGeometry args={[0.27, 0.018, 12, 48]} />
        <meshStandardMaterial {...METAL} />
      </mesh>

      {/* Glass: deep, dark, clearcoated */}
      <mesh position={[LENS_X, LENS_Y, 0.79]}>
        <circleGeometry args={[0.245, 48]} />
        <meshPhysicalMaterial
          color="#071019"
          roughness={0.12}
          metalness={0.3}
          clearcoat={1}
          clearcoatRoughness={0.08}
          reflectivity={1}
        />
      </mesh>

      {/* Subtle specular ring inside the glass */}
      <mesh position={[LENS_X, LENS_Y, 0.795]}>
        <torusGeometry args={[0.17, 0.006, 8, 48]} />
        <meshStandardMaterial
          color="#b9d0f0"
          metalness={1}
          roughness={0.15}
          emissive="#3a4a66"
          emissiveIntensity={0.35}
        />
      </mesh>

      {/* Flash cube (top left) */}
      <RoundedBox args={[0.36, 0.24, 0.3]} radius={0.03} smoothness={3} position={[-0.45, 0.72, 0.02]}>
        <meshStandardMaterial {...BODY} />
      </RoundedBox>
      <mesh position={[-0.45, 0.72, 0.175]}>
        <planeGeometry args={[0.28, 0.16]} />
        <meshStandardMaterial
          color="#efe9dc"
          roughness={0.25}
          metalness={0.05}
          emissive="#fff4d6"
          emissiveIntensity={0.25}
        />
      </mesh>

      {/* Viewfinder (top right) */}
      <RoundedBox args={[0.24, 0.16, 0.2]} radius={0.02} smoothness={3} position={[0.48, 0.68, -0.05]}>
        <meshStandardMaterial {...DARK_METAL} />
      </RoundedBox>
      <mesh position={[0.48, 0.68, 0.052]}>
        <planeGeometry args={[0.12, 0.08]} />
        <meshPhysicalMaterial color="#0a1420" roughness={0.1} metalness={0.4} clearcoat={1} />
      </mesh>

      {/* Shutter button (top right, forward) */}
      <mesh position={[0.66, 0.62, 0.14]}>
        <cylinderGeometry args={[0.1, 0.1, 0.03, 32]} />
        <meshStandardMaterial {...DARK_METAL} />
      </mesh>
      <mesh position={[0.66, 0.655, 0.14]}>
        <cylinderGeometry args={[0.07, 0.07, 0.045, 32]} />
        <meshStandardMaterial {...METAL} />
      </mesh>

      {/* Mode dial (top, behind the flash) */}
      <mesh position={[-0.05, 0.645, -0.14]}>
        <cylinderGeometry args={[0.13, 0.13, 0.07, 32]} />
        <meshStandardMaterial {...DARK_METAL} />
      </mesh>

      {/* Strap loops, one each side */}
      <mesh position={[-0.86, 0.3, 0]} rotation={[0, HALF_PI, 0]}>
        <torusGeometry args={[0.07, 0.02, 10, 32]} />
        <meshStandardMaterial {...METAL} />
      </mesh>
      <mesh position={[0.86, 0.3, 0]} rotation={[0, HALF_PI, 0]}>
        <torusGeometry args={[0.07, 0.02, 10, 32]} />
        <meshStandardMaterial {...METAL} />
      </mesh>

      {/* Kitty's yellow tag: a small badge on the front */}
      <mesh position={[-0.56, 0.2, 0.36]} rotation={[HALF_PI, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.02, 24]} />
        <meshStandardMaterial {...YELLOW} />
      </mesh>
    </group>
  );
}
