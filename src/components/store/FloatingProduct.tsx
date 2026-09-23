"use client";
/**
 * The current product floating beside Kitty: slow spin, gentle bob, a soft
 * additive glow on the surface below, and a tap that opens the product panel.
 *
 * The product is its 3D model (product.model, made by scripts/store/merch.py)
 * with its cloth in the chosen colour; while that loads, or if it cannot, a
 * simpler drawn version stands in (and a flat mockup image, if one exists,
 * is preferred to the drawn one).
 */
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { RoundedBox, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { PRODUCTS, type Product } from "@/config/products";
import { useUi } from "@/lib/store";
import SceneErrorBoundary from "./SceneErrorBoundary";
import { useAssetExists } from "./useAssetExists";
import { prefersReducedMotion } from "./motion";
import { spotFor, wrapIndex } from "./spots";
import { selectedVariant, useStoreState } from "./storeState";

const CREAM = "#f4f1ea";
const INK = "#1e1e22";
const ACCENT = "#ffd166";

export default function FloatingProduct() {
  const productIndex = useUi((s) => s.productIndex);
  const setChatOpen = useUi((s) => s.setChatOpen);
  const setPanelOpen = useStoreState((s) => s.setPanelOpen);
  const variants = useStoreState((s) => s.variants);

  const index = wrapIndex(productIndex, PRODUCTS.length);
  const product = PRODUCTS[index];
  const spot = spotFor(index);
  const variant = selectedVariant(product, variants);
  const hasModel = useAssetExists(product.model ?? null);
  const hasImage = useAssetExists(product.images.front);
  // Flat mockups sway rather than spin; models and drawn products spin.
  const flat = hasModel !== true && hasImage === true;

  const floater = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const pop = useRef(0);

  // Scale in from nothing whenever the product changes.
  useEffect(() => {
    pop.current = 0;
  }, [index]);

  useFrame((state, rawDt) => {
    const g = floater.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    const t = state.clock.elapsedTime;
    const reduced = prefersReducedMotion();

    pop.current = reduced ? 1 : Math.min(1, pop.current + dt * 2.6);
    const s = pop.current < 1 ? 1 - Math.pow(1 - pop.current, 3) : 1;
    g.scale.setScalar(Math.max(0.001, s));

    const bob = reduced ? 0 : Math.sin(t * 1.3) * 0.03;
    g.position.set(spot.product[0], spot.product[1] + bob, spot.product[2]);
    if (reduced) {
      g.rotation.y = flat ? 0 : 0.35;
    } else if (flat) {
      // A flat mockup looks wrong edge-on, so it sways instead of spinning.
      g.rotation.y = Math.sin(t * 0.7) * 0.35;
    } else {
      g.rotation.y += dt * 0.5;
    }

    const pulse = reduced ? 1 : 0.85 + Math.sin(t * 1.3) * 0.15;
    const glowMat = glow.current?.material as THREE.MeshBasicMaterial | undefined;
    if (glowMat) glowMat.opacity = 0.26 * pulse * s;
    const ringMat = ring.current?.material as THREE.MeshBasicMaterial | undefined;
    if (ringMat) ringMat.opacity = 0.55 * pulse * s;
  });

  const open = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    setPanelOpen(true);
    setChatOpen(false);
  };

  const procedural = <ProceduralProduct product={product} colour={variant.colour} />;
  const fallback =
    hasImage === true ? (
      <SceneErrorBoundary fallback={procedural} label="product image">
        <Suspense fallback={procedural}>
          <ImageProduct src={product.images.front} />
        </Suspense>
      </SceneErrorBoundary>
    ) : (
      procedural
    );

  return (
    <group>
      {/* Glow on the surface under the product (smaller on a small table) */}
      <group position={[spot.product[0], spot.surfaceY + 0.006, spot.product[2]]} scale={(spot.glow ?? 0.34) / 0.34}>
        <mesh ref={glow} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.34, 40]} />
          <meshBasicMaterial
            color={ACCENT}
            transparent
            opacity={0.26}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh ref={ring} rotation-x={-Math.PI / 2} position={[0, 0.001, 0]}>
          <ringGeometry args={[0.3, 0.36, 48]} />
          <meshBasicMaterial
            color={ACCENT}
            transparent
            opacity={0.55}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>

      <group
        ref={floater}
        position={spot.product}
        onClick={open}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        {/* Generous invisible hit target so a thumb can find it */}
        <mesh visible={false}>
          <sphereGeometry args={[0.3, 8, 8]} />
          <meshBasicMaterial />
        </mesh>
        {hasModel === true && product.model ? (
          <SceneErrorBoundary fallback={fallback} label="product model">
            <Suspense fallback={fallback}>
              <ModelProduct src={product.model} colour={variant.colour} size={MODEL_SIZE[product.id] ?? 0.5} />
            </Suspense>
          </SceneErrorBoundary>
        ) : (
          fallback
        )}
      </group>
    </group>
  );
}

function ProceduralProduct({ product, colour }: { product: Product; colour: string }) {
  switch (product.id) {
    case "cap":
      return <CapModel colour={colour} />;
    case "hoodie":
      return <HoodieModel colour={colour} />;
    default:
      return <LongSleeveModel colour={colour} />;
  }
}

/** How big each model floats (its largest side, metres): the cap enlarged so it reads. */
const MODEL_SIZE: Partial<Record<Product["id"], number>> = { cap: 0.34, hoodie: 0.66, longsleeve: 0.66 };

/**
 * Very dark cloth would render as a silhouette in a lamp-lit room; lift it
 * just enough for its folds to show (it still reads as black).
 */
function clothColour(colour: string): THREE.Color {
  const c = new THREE.Color(colour);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l < 0.14) c.setHSL(hsl.h, hsl.s, 0.14);
  return c;
}

/**
 * A product's model: centred on its own middle, scaled to `size`, its
 * "Fabric" dyed the chosen colour, the stitched and printed decals cut out
 * crisply (no sorting against the cloth they lie on).
 */
function ModelProduct({ src, colour, size }: { src: string; colour: string; size: number }) {
  const gltf = useGLTF(src, "/draco/");
  const { scene, fabrics } = useMemo(() => {
    const root = gltf.scene.clone(true);
    const fabrics: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = m;
      if (m.name === "Fabric") fabrics.push(m);
      if (m.name === "Embroidery") {
        // Cut out, not blended: it must write depth, or cloth drawn after it covers it.
        m.transparent = false;
        m.depthWrite = true;
        m.alphaTest = 0.35;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
      } else if (m.name === "Print") {
        // A halftone: blended, so the dots read as the photo's greys.
        m.transparent = true;
        m.depthWrite = false;
        m.polygonOffset = true;
        m.polygonOffsetFactor = -2;
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const dims = box.getSize(new THREE.Vector3());
    const k = size / Math.max(dims.x, dims.y, dims.z, 1e-3);
    const centre = box.getCenter(new THREE.Vector3());
    const wrap = new THREE.Group();
    root.position.copy(centre).multiplyScalar(-1);
    wrap.add(root);
    wrap.scale.setScalar(k);
    return { scene: wrap, fabrics };
  }, [gltf.scene, size]);

  useEffect(() => {
    const c = clothColour(colour);
    for (const m of fabrics) m.color.copy(c);
  }, [fabrics, colour]);

  useEffect(
    () => () => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
      });
    },
    [scene],
  );

  return <primitive object={scene} />;
}

/** Front mockup mapped on a plane, sized by the image's aspect. */
function ImageProduct({ src }: { src: string }) {
  const tex = useTexture(src, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
  });
  const img = tex.image as { width?: number; height?: number } | undefined;
  const aspect = img && img.width && img.height ? img.height / img.width : 1;
  const w = 0.42;
  return (
    <mesh>
      <planeGeometry args={[w, w * aspect]} />
      <meshBasicMaterial map={tex} transparent alphaTest={0.02} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

/** Tiny cream Kitty face used as the embroidery patch on the cap and hoodie. */
function KittyPatch({ scale = 1 }: { scale?: number }) {
  return (
    <group scale={scale}>
      <mesh>
        <circleGeometry args={[0.035, 20]} />
        <meshStandardMaterial color={CREAM} roughness={0.9} />
      </mesh>
      <mesh position={[-0.012, 0.004, 0.003]}>
        <sphereGeometry args={[0.005, 8, 6]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <mesh position={[0.012, 0.004, 0.003]}>
        <sphereGeometry args={[0.005, 8, 6]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <mesh position={[-0.02, 0.03, 0]} rotation-z={0.3}>
        <coneGeometry args={[0.009, 0.018, 4]} />
        <meshStandardMaterial color={INK} />
      </mesh>
      <mesh position={[0.02, 0.03, 0]} rotation-z={-0.3}>
        <coneGeometry args={[0.009, 0.018, 4]} />
        <meshStandardMaterial color={INK} />
      </mesh>
    </group>
  );
}

const CAP_SEAMS = [0, Math.PI / 3, (2 * Math.PI) / 3];

function CapModel({ colour }: { colour: string }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 }), [colour]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <group position={[0, -0.03, 0]}>
      {/* Squashed hemisphere crown, closed underneath */}
      <mesh material={mat} scale={[1, 0.78, 1]}>
        <sphereGeometry args={[0.14, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <mesh material={mat} rotation-x={Math.PI / 2}>
        <circleGeometry args={[0.14, 28]} />
      </mesh>
      {/* Panel seams */}
      {CAP_SEAMS.map((a) => (
        <mesh key={a} material={mat} rotation-y={a} scale={[1, 0.78, 1]}>
          <torusGeometry args={[0.141, 0.0025, 6, 40, Math.PI]} />
        </mesh>
      ))}
      {/* Brim: a flat wedge in front, tilted down a touch */}
      <mesh position={[0, -0.004, 0]} rotation-x={Math.PI / 2 + 0.16}>
        <circleGeometry args={[0.215, 36, Math.PI / 2 - 0.95, 1.9]} />
        <meshStandardMaterial color={colour} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {/* Button on top */}
      <mesh material={mat} position={[0, 0.11, 0]}>
        <sphereGeometry args={[0.012, 10, 8]} />
      </mesh>
      {/* Embroidered face on the front */}
      <group position={[0, 0.058, 0.118]} rotation-x={-0.5}>
        <KittyPatch />
      </group>
    </group>
  );
}

const DRAWSTRINGS = [-0.025, 0.025];

function HoodieModel({ colour }: { colour: string }) {
  return (
    <group>
      <RoundedBox args={[0.26, 0.3, 0.1]} radius={0.03} smoothness={4}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[0.075, 0.27, 0.085]} radius={0.03} smoothness={4} position={[-0.165, -0.02, 0]} rotation-z={0.12}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[0.075, 0.27, 0.085]} radius={0.03} smoothness={4} position={[0.165, -0.02, 0]} rotation-z={-0.12}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      {/* Hood: half torus arching over the shoulders */}
      <mesh position={[0, 0.15, -0.01]} rotation-x={-0.25}>
        <torusGeometry args={[0.095, 0.036, 12, 28, Math.PI]} />
        <meshStandardMaterial color={colour} roughness={0.95} />
      </mesh>
      {/* Kangaroo pocket */}
      <RoundedBox args={[0.17, 0.075, 0.02]} radius={0.01} smoothness={3} position={[0, -0.1, 0.05]}>
        <meshStandardMaterial color={colour} roughness={1} />
      </RoundedBox>
      {DRAWSTRINGS.map((x) => (
        <mesh key={x} position={[x, 0.07, 0.052]}>
          <cylinderGeometry args={[0.004, 0.004, 0.11, 6]} />
          <meshStandardMaterial color={CREAM} roughness={0.9} />
        </mesh>
      ))}
      {/* Small embroidered Kitty on the left chest (wearer's left, viewer's right) */}
      <group position={[0.07, 0.07, 0.052]}>
        <KittyPatch scale={0.6} />
      </group>
    </group>
  );
}

const FLYER_LINES = [-0.04, -0.055];

function LongSleeveModel({ colour }: { colour: string }) {
  return (
    <group>
      <RoundedBox args={[0.28, 0.32, 0.06]} radius={0.025} smoothness={4}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[0.07, 0.34, 0.055]} radius={0.025} smoothness={4} position={[-0.175, -0.04, 0]} rotation-z={0.08}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[0.07, 0.34, 0.055]} radius={0.025} smoothness={4} position={[0.175, -0.04, 0]} rotation-z={-0.08}>
        <meshStandardMaterial color={colour} roughness={0.95} />
      </RoundedBox>
      {/* Collar */}
      <mesh position={[0, 0.16, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.05, 0.012, 8, 24]} />
        <meshStandardMaterial color={colour} roughness={0.9} />
      </mesh>
      {/* The MISSING flyer screen-printed on the back */}
      <group position={[0, 0.02, -0.032]} rotation-y={Math.PI}>
        <mesh>
          <planeGeometry args={[0.115, 0.155]} />
          <meshStandardMaterial color={INK} roughness={0.95} />
        </mesh>
        <mesh position={[0, 0.062, 0.001]}>
          <planeGeometry args={[0.09, 0.014]} />
          <meshStandardMaterial color={CREAM} roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.012, 0.001]}>
          <planeGeometry args={[0.075, 0.065]} />
          <meshStandardMaterial color="#d9d2c5" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0.012, 0.002]}>
          <circleGeometry args={[0.018, 16]} />
          <meshStandardMaterial color={INK} roughness={0.9} />
        </mesh>
        {FLYER_LINES.map((y) => (
          <mesh key={y} position={[0, y, 0.001]}>
            <planeGeometry args={[0.085, 0.006]} />
            <meshStandardMaterial color={CREAM} roughness={0.9} />
          </mesh>
        ))}
      </group>
      {/* Small Kitty on the sleeve */}
      <mesh position={[0.178, 0.06, 0.029]}>
        <circleGeometry args={[0.012, 12]} />
        <meshStandardMaterial color={INK} roughness={0.9} />
      </mesh>
    </group>
  );
}
