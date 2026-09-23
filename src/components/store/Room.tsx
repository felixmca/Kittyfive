"use client";
/**
 * The living room. Procedural primitives by default; if /models/room.glb
 * exists it is loaded instead, inside an error boundary that falls back to the
 * primitives. Lights live in StoreScene so both variants are lit.
 *
 * The primitives have the river in the window (RiverWindow, a shader) and a
 * glass door in the back wall, with Kitty's cat flap, out to the garden
 * (Garden.tsx). The plants sway; the light is day or evening (ambience.ts).
 */
import { Suspense } from "react";
import { RoundedBox, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import Garden, { GARDEN_DOOR, Sway } from "./Garden";
import RiverWindow from "./RiverWindow";
import SceneErrorBoundary from "./SceneErrorBoundary";
import { useAssetExists } from "./useAssetExists";
import { ROOM } from "./spots";

const ROOM_GLB = "/models/room.glb";

const WOOD = "#8b5a3c";
const PLANK_SEAM = "#5e3a24";
const PLASTER = "#c9b8a3";
const CEILING = "#2a2622";
const TRIM = "#efe7da";
const SOFA = "#54695d";
const SOFA_CUSHION = "#61776a";
const DARK_WOOD = "#4e3320";
const RUG = "#6e3f3a";
const RUG_INNER = "#8a5a52";
const CABINET = "#2c2c30";
const COUNTER_TOP = "#e6e0d4";
const TERRACOTTA = "#b5673f";
const LEAF = "#3f7a45";
const LEAF_LIGHT = "#4b8a50";
const FRAME = "#3a332c";
const RIVER_LIGHT = "#bcd8ff";
const CREAM = "#f4f1ea";
const INK = "#15151a";

export default function Room() {
  const hasGlb = useAssetExists(ROOM_GLB);
  if (hasGlb !== true) return <RoomPrimitives />;
  return (
    <SceneErrorBoundary fallback={<RoomPrimitives />} label="room.glb">
      <Suspense fallback={<RoomPrimitives />}>
        <RoomGlb />
      </Suspense>
    </SceneErrorBoundary>
  );
}

function RoomGlb() {
  const gltf = useGLTF(ROOM_GLB, "/draco/");
  return <primitive object={gltf.scene} />;
}

const WIDTH = ROOM.right - ROOM.left;
const DEPTH = ROOM.frontZ - ROOM.backZ;
const CENTER_Z = (ROOM.backZ + ROOM.frontZ) / 2;

/** Minimal floor so Kitty still has something to stand on if everything else fails. */
export function FloorOnly() {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0, CENTER_Z]}>
      <planeGeometry args={[WIDTH, DEPTH]} />
      <meshStandardMaterial color={WOOD} roughness={0.85} />
    </mesh>
  );
}

const PLANK_SEAMS = [-2.2, -1.4, -0.6, 0.2, 1.0, 1.8, 2.6];
const TABLE_LEGS: Array<[number, number]> = [
  [-0.21, -0.41],
  [0.21, -0.41],
  [-0.21, 0.41],
  [0.21, 0.41],
];
const CUPBOARD_HANDLES = [-1.1, -0.4, 0.3, 1.0];
/** x, y, z, radius, tilt of each leaf on the tall plant. */
const TALL_PLANT_LEAVES: Array<[number, number, number, number, number]> = [
  [0, 0.28, 0, 0.3, 0],
  [0.16, 0.12, 0.04, 0.22, -0.7],
  [-0.15, 0.18, -0.02, 0.24, 0.8],
  [0.05, 0.44, 0.05, 0.2, -0.3],
  [-0.08, 0.02, 0.1, 0.18, 0.5],
];
const HOB_RINGS = [0.4, 0.8];

export function RoomPrimitives() {
  const h = ROOM.height;

  return (
    <group>
      {/* Floor and ceiling */}
      <FloorOnly />
      {PLANK_SEAMS.map((x) => (
        <mesh key={x} rotation-x={-Math.PI / 2} position={[x, 0.002, CENTER_Z]}>
          <planeGeometry args={[0.015, DEPTH]} />
          <meshStandardMaterial color={PLANK_SEAM} roughness={0.9} />
        </mesh>
      ))}
      <mesh rotation-x={Math.PI / 2} position={[0, h, CENTER_Z]}>
        <planeGeometry args={[WIDTH, DEPTH]} />
        <meshStandardMaterial color={CEILING} roughness={1} />
      </mesh>

      {/* Three walls: back (with the garden door), left, right. The doorway wall behind the camera stays open. */}
      <BackWall />
      <mesh rotation-y={Math.PI / 2} position={[ROOM.left, h / 2, CENTER_Z]}>
        <planeGeometry args={[DEPTH, h]} />
        <meshStandardMaterial color={PLASTER} roughness={0.95} />
      </mesh>
      <mesh rotation-y={-Math.PI / 2} position={[ROOM.right, h / 2, CENTER_Z]}>
        <planeGeometry args={[DEPTH, h]} />
        <meshStandardMaterial color={PLASTER} roughness={0.95} />
      </mesh>
      {/* Window on the back wall with the river behind it */}
      <group position={[0.2, 1.55, ROOM.backZ]}>
        <mesh position={[0, 0, 0.03]}>
          <boxGeometry args={[2.3, 1.6, 0.06]} />
          <meshStandardMaterial color={FRAME} roughness={0.7} />
        </mesh>
        <RiverWindow width={2.12} height={1.42} position={[0, 0, 0.065]} />
        <mesh position={[0, 0, 0.075]}>
          <boxGeometry args={[0.04, 1.42, 0.02]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
        <mesh position={[0, 0.12, 0.075]}>
          <boxGeometry args={[2.12, 0.04, 0.02]} />
          <meshStandardMaterial color={FRAME} />
        </mesh>
        <mesh position={[0, -0.84, 0.09]}>
          <boxGeometry args={[2.4, 0.06, 0.18]} />
          <meshStandardMaterial color={TRIM} roughness={0.6} />
        </mesh>
      </group>

      {/* Rug */}
      <mesh rotation-x={-Math.PI / 2} position={[-0.6, 0.006, 0.3]}>
        <planeGeometry args={[3.0, 2.2]} />
        <meshStandardMaterial color={RUG} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[-0.6, 0.008, 0.3]}>
        <planeGeometry args={[2.6, 1.8]} />
        <meshStandardMaterial color={RUG_INNER} roughness={1} />
      </mesh>

      {/* Sofa along the left wall, facing into the room (+x). */}
      <group position={[-2.4, 0, 0.3]} rotation-y={Math.PI / 2}>
        <RoundedBox args={[1.8, 0.45, 0.85]} radius={0.08} smoothness={3} position={[0, 0.225, 0]}>
          <meshStandardMaterial color={SOFA} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[1.8, 0.5, 0.25]} radius={0.08} smoothness={3} position={[0, 0.66, -0.3]}>
          <meshStandardMaterial color={SOFA} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[0.2, 0.55, 0.85]} radius={0.06} smoothness={3} position={[-0.9, 0.3, 0]}>
          <meshStandardMaterial color={SOFA} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[0.2, 0.55, 0.85]} radius={0.06} smoothness={3} position={[0.9, 0.3, 0]}>
          <meshStandardMaterial color={SOFA} roughness={0.95} />
        </RoundedBox>
        <RoundedBox args={[0.78, 0.13, 0.7]} radius={0.05} smoothness={3} position={[-0.42, 0.5, 0.04]}>
          <meshStandardMaterial color={SOFA_CUSHION} roughness={1} />
        </RoundedBox>
        <RoundedBox args={[0.78, 0.13, 0.7]} radius={0.05} smoothness={3} position={[0.42, 0.5, 0.04]}>
          <meshStandardMaterial color={SOFA_CUSHION} roughness={1} />
        </RoundedBox>
      </group>

      {/* Low coffee table in front of the sofa */}
      <group position={[-1.4, 0, -0.3]}>
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[0.5, 0.05, 0.9]} />
          <meshStandardMaterial color={DARK_WOOD} roughness={0.5} />
        </mesh>
        {TABLE_LEGS.map(([x, z]) => (
          <mesh key={`${x}:${z}`} position={[x, 0.18, z]}>
            <cylinderGeometry args={[0.02, 0.02, 0.36, 10]} />
            <meshStandardMaterial color={DARK_WOOD} roughness={0.6} />
          </mesh>
        ))}
        {/* A mug, because there is always a mug. */}
        <mesh position={[0.1, 0.45, 0.2]}>
          <cylinderGeometry args={[0.04, 0.035, 0.09, 16]} />
          <meshStandardMaterial color={CREAM} roughness={0.4} />
        </mesh>
      </group>

      {/* Kitchen counter along the right wall */}
      <group position={[2.65, 0, -0.95]}>
        <mesh position={[0, 0.43, 0]}>
          <boxGeometry args={[0.6, 0.86, 3.1]} />
          <meshStandardMaterial color={CABINET} roughness={0.6} />
        </mesh>
        <mesh position={[0, ROOM.counterHeight - 0.015, 0]}>
          <boxGeometry args={[0.66, 0.03, 3.16]} />
          <meshStandardMaterial color={COUNTER_TOP} roughness={0.35} />
        </mesh>
        {CUPBOARD_HANDLES.map((z) => (
          <mesh key={z} position={[-0.31, 0.6, z]}>
            <boxGeometry args={[0.02, 0.02, 0.18]} />
            <meshStandardMaterial color="#b9b4a8" metalness={0.6} roughness={0.35} />
          </mesh>
        ))}
        {HOB_RINGS.map((z) => (
          <mesh key={z} rotation-x={-Math.PI / 2} position={[0, ROOM.counterHeight + 0.002, z]}>
            <ringGeometry args={[0.06, 0.09, 24]} />
            <meshStandardMaterial color="#1a1a1d" roughness={0.5} />
          </mesh>
        ))}
      </group>

      {/* Small plant on the counter, moving a little in the draught from the door */}
      <group position={[2.65, ROOM.counterHeight, -1.9]}>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.09, 0.07, 0.16, 16]} />
          <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
        </mesh>
        <Sway position={[0, 0.16, 0]} amount={0.04} speed={0.9} phase={1.1}>
          <mesh position={[0, 0.17, 0]}>
            <coneGeometry args={[0.16, 0.34, 8]} />
            <meshStandardMaterial color={LEAF} roughness={0.9} />
          </mesh>
          <mesh position={[0.06, 0.1, 0.05]} rotation-z={-0.3}>
            <coneGeometry args={[0.1, 0.24, 7]} />
            <meshStandardMaterial color={LEAF_LIGHT} roughness={0.9} />
          </mesh>
        </Sway>
      </group>

      {/* A tall plant beside the window (clear of Kitty's path along the back wall) */}
      <group position={[1.75, 0, ROOM.backZ + 0.32]}>
        <mesh position={[0, 0.17, 0]}>
          <cylinderGeometry args={[0.17, 0.13, 0.34, 18]} />
          <meshStandardMaterial color={TERRACOTTA} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <cylinderGeometry args={[0.012, 0.016, 0.5, 6]} />
          <meshStandardMaterial color="#4b5d34" roughness={1} />
        </mesh>
        <Sway position={[0, 0.72, 0]} amount={0.035} speed={0.7} phase={2.4}>
          {TALL_PLANT_LEAVES.map(([x, y, z, r, tilt]) => (
            <mesh key={`${x}:${y}`} position={[x, y, z]} rotation-z={tilt} scale={[1, 1.35, 0.35]}>
              <sphereGeometry args={[r, 10, 8]} />
              <meshStandardMaterial color={x > 0 ? LEAF_LIGHT : LEAF} roughness={0.9} flatShading />
            </mesh>
          ))}
        </Sway>
      </group>

      <Garden />

      {/* Floor lamp by the sofa; the warm point light in StoreScene sits in the shade */}
      <group position={[-2.6, 0, -1.1]}>
        <mesh position={[0, 0.02, 0]}>
          <cylinderGeometry args={[0.14, 0.14, 0.03, 20]} />
          <meshStandardMaterial color="#1e1e22" roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.75, 0]}>
          <cylinderGeometry args={[0.015, 0.015, 1.5, 10]} />
          <meshStandardMaterial color="#1e1e22" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.6, 0]}>
          <coneGeometry args={[0.2, 0.28, 20, 1, true]} />
          <meshStandardMaterial
            color="#e9dcc3"
            emissive="#ffd9a0"
            emissiveIntensity={0.35}
            roughness={1}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>

      {/* A picture on the left wall */}
      <group position={[ROOM.left + 0.03, 1.6, 1.6]} rotation-y={Math.PI / 2}>
        <mesh>
          <boxGeometry args={[0.6, 0.45, 0.03]} />
          <meshStandardMaterial color={FRAME} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0, 0.017]}>
          <planeGeometry args={[0.5, 0.36]} />
          <meshStandardMaterial color="#d9d2c5" roughness={0.9} />
        </mesh>
        <mesh position={[0.02, -0.02, 0.019]}>
          <circleGeometry args={[0.09, 24]} />
          <meshStandardMaterial color={INK} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The back wall with the garden door cut out of it: plaster around the
 * opening, skirting either side, a frame, a glass door (mostly see-through)
 * and Kitty's cat flap at the bottom.
 */
function BackWall() {
  const h = ROOM.height;
  const z = ROOM.backZ;
  const x0 = GARDEN_DOOR.x - GARDEN_DOOR.width / 2;
  const x1 = GARDEN_DOOR.x + GARDEN_DOOR.width / 2;
  const dh = GARDEN_DOOR.height;
  const leftW = x0 - ROOM.left;
  const rightW = ROOM.right - x1;
  return (
    <group>
      <mesh position={[ROOM.left + leftW / 2, h / 2, z]}>
        <planeGeometry args={[leftW, h]} />
        <meshStandardMaterial color={PLASTER} roughness={0.95} />
      </mesh>
      <mesh position={[x1 + rightW / 2, h / 2, z]}>
        <planeGeometry args={[rightW, h]} />
        <meshStandardMaterial color={PLASTER} roughness={0.95} />
      </mesh>
      <mesh position={[GARDEN_DOOR.x, (dh + h) / 2, z]}>
        <planeGeometry args={[GARDEN_DOOR.width, h - dh]} />
        <meshStandardMaterial color={PLASTER} roughness={0.95} />
      </mesh>
      {/* Skirting either side of the door */}
      <mesh position={[ROOM.left + leftW / 2, 0.06, z + 0.01]}>
        <boxGeometry args={[leftW, 0.12, 0.02]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      <mesh position={[x1 + rightW / 2, 0.06, z + 0.01]}>
        <boxGeometry args={[rightW, 0.12, 0.02]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      {/* Frame */}
      {[x0, x1].map((x) => (
        <mesh key={x} position={[x, dh / 2, z + 0.02]}>
          <boxGeometry args={[0.07, dh, 0.1]} />
          <meshStandardMaterial color={TRIM} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[GARDEN_DOOR.x, dh, z + 0.02]}>
        <boxGeometry args={[GARDEN_DOOR.width + 0.07, 0.07, 0.1]} />
        <meshStandardMaterial color={TRIM} roughness={0.6} />
      </mesh>
      {/* The door: a thin frame round a pane of glass, a solid kick panel, the cat flap */}
      <group position={[GARDEN_DOOR.x, 0, z - 0.01]}>
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (GARDEN_DOOR.width / 2 - 0.07), dh / 2, 0]}>
            <boxGeometry args={[0.06, dh - 0.04, 0.04]} />
            <meshStandardMaterial color={FRAME} roughness={0.6} />
          </mesh>
        ))}
        <mesh position={[0, dh - 0.06, 0]}>
          <boxGeometry args={[GARDEN_DOOR.width - 0.1, 0.06, 0.04]} />
          <meshStandardMaterial color={FRAME} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.47, 0]}>
          <boxGeometry args={[GARDEN_DOOR.width - 0.1, 0.06, 0.04]} />
          <meshStandardMaterial color={FRAME} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[GARDEN_DOOR.width - 0.14, 0.44, 0.03]} />
          <meshStandardMaterial color={FRAME} roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.2, 0.02]}>
          <boxGeometry args={[0.26, 0.24, 0.012]} />
          <meshStandardMaterial color="#1b1b1f" roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.2, 0.027]}>
          <boxGeometry args={[0.2, 0.18, 0.006]} />
          <meshStandardMaterial color="#3d4a52" roughness={0.2} metalness={0.1} transparent opacity={0.8} />
        </mesh>
        <mesh position={[0, 1.28, 0]}>
          <planeGeometry args={[GARDEN_DOOR.width - 0.14, 1.56]} />
          <meshStandardMaterial color={RIVER_LIGHT} roughness={0.05} metalness={0.1} transparent opacity={0.1} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}
