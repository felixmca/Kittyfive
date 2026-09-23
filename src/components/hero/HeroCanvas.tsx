"use client";
/**
 * The hero's WebGL canvas (the spinning camera), in its own module so Hero
 * loads it lazily: three.js is the largest script on the landing, and the
 * wordmark, the tagline and the story must not wait for it, or fail with it.
 * Hero wraps this in an error boundary whose fallback is the SVG camera, so a
 * script that never arrives (a phone losing signal) costs only the 3D.
 */
import { Canvas } from "@react-three/fiber";
import HeroScene from "./HeroScene";

export default function HeroCanvas({
  frameloop,
  onActivate,
  reducedMotion,
  useGlb,
}: {
  frameloop: "always" | "demand" | "never";
  onActivate: () => void;
  reducedMotion: boolean;
  useGlb: boolean;
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      }}
      frameloop={frameloop}
      camera={{ position: [0, 0.55, 4.6], fov: 30, near: 0.1, far: 30 }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
      aria-hidden="true"
    >
      <HeroScene onActivate={onActivate} reducedMotion={reducedMotion} useGlb={useGlb} />
    </Canvas>
  );
}
