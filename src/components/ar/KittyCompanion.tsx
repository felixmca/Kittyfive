"use client";
/**
 * KittyCompanion — a small transparent R3F canvas over the bottom 35% of the
 * try-on. Inside: a procedural black-and-white cat (no textures, no GLB) that
 * walks slowly left and right along an assumed floor line, turns at the
 * edges, and now and then sits down and looks up at the camera. While
 * someone is being tracked she goes and sits beside them instead (on the
 * side with more room, clear of their shoulders), turned a little towards
 * them, and moves over when they do.
 *
 * The camera is orthographic at zoom 1, so one world unit is one CSS pixel:
 * the cat is built 0.9 units tall and scaled so she reads about 120 px.
 * prefers-reduced-motion: she sits facing you and only blinks (frameloop on
 * demand). The whole canvas is wrapped in an error boundary; if WebGL is
 * missing the layer simply is not there.
 */
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import ArErrorBoundary from "./ArErrorBoundary";
import type { PersonSpot } from "./landmarks";

const BLACK = "#15151a";
const WHITE = "#f4f1ea";
const GREEN = "#8fd37a";
const PINK = "#d9908f";

/** Target on-screen height for the cat, CSS px. */
const CAT_PX = 120;
/** Local-unit height of the model, feet to ear tips. */
const UNIT_HEIGHT = 0.9;
/** Walking speed, CSS px per second. */
const WALK_SPEED = 30;
/** A person last seen longer ago than this is gone. */
const PERSON_STALE_MS = 600;

/** SSR-safe reduced-motion flag that follows the OS setting live. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReduced(mq.matches);
      update();
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", update);
        return () => mq.removeEventListener("change", update);
      }
    } catch {
      // matchMedia can throw in odd embedded browsers; default to motion on
    }
    return undefined;
  }, []);
  return reduced;
}

// Pivot of the torso group, in cat units (near the hips so sitting pitches the front up).
const PIVOT = { x: -0.22, y: 0.28 };
// Leg roots relative to the pivot: front-left, front-right, back-left, back-right.
const LEGS = [
  { x: 0.39, y: 0.04, z: 0.1 },
  { x: 0.39, y: 0.04, z: -0.1 },
  { x: 0.05, y: 0.04, z: 0.1 },
  { x: 0.05, y: 0.04, z: -0.1 },
];
const TAIL = Array.from({ length: 6 }, (_, i) => ({
  x: -0.12 - i * 0.06,
  y: 0.2 + i * 0.055,
  r: 0.045 - i * 0.004,
}));

interface CatState {
  mode: "walk" | "sit";
  dir: 1 | -1;
  x: number;
  heading: number;
  targetHeading: number;
  phase: number;
  until: number;
  nextBlink: number;
  blinkUntil: number;
  sit: number; // 0 standing … 1 sitting, eased
  /** Which side of the person she keeps to (−1 left, +1 right), once chosen. */
  side: number;
}

function Cat({ reduced, personRef }: { reduced: boolean; personRef?: RefObject<PersonSpot | null> }) {
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const legs = useRef<Array<THREE.Group | null>>([null, null, null, null]);
  const tail = useRef<Array<THREE.Mesh | null>>([]);
  const eyes = useRef<Array<THREE.Mesh | null>>([null, null]);

  const st = useRef<CatState>({
    mode: reduced ? "sit" : "walk",
    dir: 1,
    x: 0,
    heading: reduced ? -Math.PI / 2 : 0,
    targetHeading: reduced ? -Math.PI / 2 : 0,
    phase: 0,
    until: 0,
    nextBlink: 1.5,
    blinkUntil: 0,
    sit: reduced ? 1 : 0,
    side: 0,
  });

  const mats = useMemo(
    () => ({
      black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.85, metalness: 0 }),
      white: new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.8, metalness: 0 }),
      green: new THREE.MeshStandardMaterial({
        color: GREEN,
        emissive: new THREE.Color("#2f6b2a"),
        emissiveIntensity: 0.5,
        roughness: 0.35,
      }),
      pupil: new THREE.MeshStandardMaterial({ color: "#050506", roughness: 0.3 }),
      pink: new THREE.MeshStandardMaterial({ color: PINK, roughness: 0.7 }),
      shadow: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.35 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // In reduced-motion mode the loop is on demand; nudge it so blinks happen.
  useEffect(() => {
    if (!reduced) return;
    const id = window.setInterval(() => invalidate(), 400);
    return () => window.clearInterval(id);
  }, [reduced, invalidate]);

  useFrame((state, delta) => {
    const g = root.current;
    const b = body.current;
    const h = head.current;
    if (!g || !b || !h) return;
    const s = st.current;
    const now = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    const scale = Math.min(CAT_PX, size.height * 0.42) / UNIT_HEIGHT;
    const floorY = -size.height / 2 + 14;
    const halfW = Math.max(0, size.width / 2 - scale * 0.8);

    if (s.until === 0) s.until = now + 5 + Math.random() * 5;

    const person = personRef?.current;
    const beside = !reduced && person && performance.now() - person.at < PERSON_STALE_MS ? person : null;
    if (beside) {
      // A spot next to them, clear of their shoulders, on the roomier side
      // (and she stays on her side unless it no longer fits).
      const px = beside.x - size.width / 2;
      const gap = beside.shoulderW / 2 + scale * 0.55;
      const fits = (side: number) => Math.abs(px + side * gap) <= halfW;
      if (!s.side || !fits(s.side)) s.side = fits(1) && (!fits(-1) || px < 0) ? 1 : -1;
      const tx = Math.max(-halfW, Math.min(halfW, px + s.side * gap));
      const d = tx - s.x;
      if (Math.abs(d) > 10 || (s.mode === "walk" && Math.abs(d) > 2)) {
        s.mode = "walk";
        s.dir = d > 0 ? 1 : -1;
        s.targetHeading = s.dir > 0 ? 0 : Math.PI;
        const step = Math.min(Math.abs(d), WALK_SPEED * 1.8 * dt);
        s.x += s.dir * step;
        s.phase += dt * 10;
      } else {
        s.mode = "sit";
        // Facing the camera, turned a little towards them.
        s.targetHeading = -Math.PI / 2 + (px > s.x ? 0.45 : -0.45);
      }
      s.until = now + 4;
    } else if (!reduced) {
      if (s.mode === "walk") {
        s.x += s.dir * WALK_SPEED * dt;
        s.phase += dt * 8;
        if (s.x > halfW && s.dir > 0) {
          s.dir = -1;
          s.targetHeading = Math.PI;
        } else if (s.x < -halfW && s.dir < 0) {
          s.dir = 1;
          s.targetHeading = 0;
        }
        if (now > s.until) {
          s.mode = "sit";
          s.until = now + 3.5 + Math.random() * 3;
          s.targetHeading = -Math.PI / 2; // face the camera
        }
      } else if (now > s.until) {
        s.mode = "walk";
        s.until = now + 6 + Math.random() * 7;
        s.targetHeading = s.dir > 0 ? 0 : Math.PI;
      }
    }

    // ease sit amount and heading (shortest arc)
    const sitTarget = s.mode === "sit" ? 1 : 0;
    s.sit += (sitTarget - s.sit) * Math.min(1, dt * 3);
    const diff = Math.atan2(
      Math.sin(s.targetHeading - s.heading),
      Math.cos(s.targetHeading - s.heading),
    );
    s.heading += diff * Math.min(1, dt * 4);

    // blink
    if (now > s.nextBlink) {
      s.blinkUntil = now + 0.13;
      s.nextBlink = now + 2.5 + Math.random() * 3;
    }
    const blinking = now < s.blinkUntil;

    const k = s.sit;
    const walking = (1 - k) * (reduced ? 0 : 1);
    const swing = Math.sin(s.phase) * 0.45 * walking;

    g.position.set(s.x, floorY, 0);
    g.rotation.y = s.heading;
    g.scale.setScalar(scale);

    b.rotation.z = 0.55 * k;
    b.position.y = PIVOT.y + Math.abs(Math.sin(s.phase)) * 0.015 * walking;

    const L = legs.current;
    if (L[0]) {
      L[0].rotation.z = swing - 0.55 * k;
      L[0].scale.y = 1 + 0.55 * k;
    }
    if (L[1]) {
      L[1].rotation.z = -swing - 0.55 * k;
      L[1].scale.y = 1 + 0.55 * k;
    }
    if (L[2]) {
      L[2].rotation.z = -swing * 0.9 + 0.9 * k;
      L[2].scale.y = 1 - 0.35 * k;
    }
    if (L[3]) {
      L[3].rotation.z = swing * 0.9 + 0.9 * k;
      L[3].scale.y = 1 - 0.35 * k;
    }

    // look up at the camera when sitting, with a slow, curious bob
    h.rotation.z = -0.55 * k + (0.45 + Math.sin(now * 0.8) * 0.06) * k;
    h.position.y = 0.34 + Math.sin(s.phase * 2) * 0.01 * walking;

    for (let i = 0; i < TAIL.length; i++) {
      const seg = tail.current[i];
      if (!seg) continue;
      const f = i / (TAIL.length - 1);
      seg.position.y = TAIL[i].y + Math.sin(now * 2.2 + i * 0.8) * 0.035 * f;
      seg.position.z = Math.sin(now * 1.6 + i * 0.6) * 0.03 * f;
    }

    for (const eye of eyes.current) if (eye) eye.scale.y = blinking ? 0.12 : 1;
  });

  return (
    <group ref={root}>
      {/* contact shadow sells the floor line */}
      <mesh
        position={[0, 0.004, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[0.42, 0.22, 1]}
        material={mats.shadow}
      >
        <circleGeometry args={[1, 28]} />
      </mesh>

      <group ref={body} position={[PIVOT.x, PIVOT.y, 0]}>
        {/* torso */}
        <mesh position={[0.22, 0.14, 0]} scale={[1.4, 0.95, 0.95]} material={mats.black}>
          <sphereGeometry args={[0.26, 24, 18]} />
        </mesh>
        {/* white bib */}
        <mesh position={[0.5, 0.1, 0]} scale={[0.8, 1, 0.9]} material={mats.white}>
          <sphereGeometry args={[0.12, 20, 16]} />
        </mesh>

        {LEGS.map((l, i) => (
          <group
            key={i}
            ref={(el) => {
              legs.current[i] = el;
            }}
            position={[l.x, l.y, l.z]}
          >
            <mesh position={[0, -0.15, 0]} material={mats.black}>
              <cylinderGeometry args={[0.04, 0.05, 0.3, 12]} />
            </mesh>
            <mesh position={[0, -0.29, 0.01]} material={mats.white}>
              <sphereGeometry args={[0.052, 16, 12]} />
            </mesh>
          </group>
        ))}

        {TAIL.map((seg, i) => (
          <mesh
            key={i}
            ref={(el) => {
              tail.current[i] = el;
            }}
            position={[seg.x, seg.y, 0]}
            material={mats.black}
          >
            <sphereGeometry args={[seg.r, 12, 10]} />
          </mesh>
        ))}

        <group ref={head} position={[0.58, 0.34, 0]}>
          <mesh material={mats.black}>
            <sphereGeometry args={[0.19, 28, 20]} />
          </mesh>
          {/* white blaze down the face */}
          <mesh position={[0.13, -0.05, 0]} scale={[0.9, 1.15, 0.75]} material={mats.white}>
            <sphereGeometry args={[0.085, 18, 14]} />
          </mesh>
          <mesh position={[0.2, -0.06, 0]} material={mats.pink}>
            <sphereGeometry args={[0.022, 10, 8]} />
          </mesh>
          {[1, -1].map((side, i) => (
            <group key={side}>
              <mesh
                ref={(el) => {
                  eyes.current[i] = el;
                }}
                position={[0.14, 0.04, side * 0.085]}
                material={mats.green}
              >
                <sphereGeometry args={[0.032, 14, 10]} />
                <mesh position={[0.026, 0, 0]} material={mats.pupil}>
                  <sphereGeometry args={[0.013, 8, 6]} />
                </mesh>
              </mesh>
              <mesh
                position={[-0.02, 0.19, side * 0.11]}
                rotation={[-side * 0.35, 0, -0.15]}
                material={mats.black}
              >
                <coneGeometry args={[0.065, 0.15, 12]} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </group>
  );
}

interface KittyCompanionProps {
  /** Receives the WebGL canvas so the shutter can composite Kitty into the photo. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  /** Where the person is (from the overlay that is tracking them); she sits beside them. */
  personRef?: RefObject<PersonSpot | null>;
  className?: string;
}

export default function KittyCompanion({ canvasRef, personRef, className = "" }: KittyCompanionProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-0 h-[35%] ${className}`}
      aria-hidden
    >
      <ArErrorBoundary label="KittyCompanion" fallback={null}>
        <Canvas
          orthographic
          camera={{ zoom: 1, position: [0, 0, 600], near: 1, far: 2000 }}
          dpr={[1, 2]}
          gl={{
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: "low-power",
          }}
          frameloop={reduced ? "demand" : "always"}
          style={{ background: "transparent", pointerEvents: "none" }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
            if (canvasRef) canvasRef.current = gl.domElement;
          }}
        >
          <ambientLight intensity={0.75} />
          <directionalLight position={[200, 320, 500]} intensity={1.5} />
          <directionalLight position={[-250, 200, -200]} intensity={0.45} color="#cfd8ff" />
          <Cat reduced={reduced} personRef={personRef} />
        </Canvas>
      </ArErrorBoundary>
    </div>
  );
}
