"use client";
/**
 * The river through the window, drawn by one small shader: sky, the far bank
 * as a row of buildings, and the Thames with light moving on it. Day is pale
 * and silver; evening is a dusk sky, lit windows across the water and their
 * reflections shimmering. Reads the shared ambience record every frame
 * (ambience.ts), so the light changes without React.
 *
 * Also used, bigger, as the backdrop beyond the garden fence.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambience } from "./ambience";

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform float uEvening;
uniform float uHorizon;
uniform float uScale;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  vec2 uv = vUv;
  float horizon = uHorizon;
  float e = uEvening;

  // Sky: pale blue by day; indigo over an amber horizon at dusk.
  float sy = clamp((uv.y - horizon) / (1.0 - horizon), 0.0, 1.0);
  vec3 dayCol = mix(vec3(0.86, 0.91, 0.96), vec3(0.58, 0.74, 0.92), sy);
  vec3 eveCol = mix(vec3(0.96, 0.55, 0.33), vec3(0.08, 0.09, 0.22), pow(sy, 0.55));
  vec3 col = mix(dayCol, eveCol, e);

  // The far bank: a row of buildings of different heights, a few gaps.
  float cells = 16.0 * uScale;
  float cell = floor(uv.x * cells);
  float h = 0.025 + 0.11 * hash(cell + 3.1) * step(0.2, hash(cell + 11.7));
  float top = horizon + 0.03 + h;
  float onBank = step(horizon, uv.y) * step(uv.y, top);
  vec3 bank = mix(vec3(0.47, 0.5, 0.55), vec3(0.05, 0.06, 0.11), e);
  // Lit windows in the evening.
  vec2 g = vec2(uv.x * 80.0 * uScale, (uv.y - horizon) * 70.0);
  float lit = step(0.7, hash(floor(g.x) * 12.9898 + floor(g.y) * 78.233));
  float pane = step(fract(g.x), 0.55) * step(fract(g.y), 0.5) * step(uv.y, top - 0.012);
  bank += lit * pane * e * vec3(1.0, 0.78, 0.42);
  col = mix(col, bank, onBank);

  // The river: glints that drift downstream by day; streaks of reflected
  // windows shimmering at dusk.
  if (uv.y < horizon) {
    float d = (horizon - uv.y) / horizon;
    vec3 wDay = mix(vec3(0.64, 0.71, 0.77), vec3(0.34, 0.43, 0.5), d);
    vec3 wEve = mix(vec3(0.24, 0.13, 0.17), vec3(0.03, 0.04, 0.08), d);
    vec3 water = mix(wDay, wEve, e);
    float f = mix(46.0, 14.0, d);
    float r = sin(uv.x * 34.0 * uScale + sin(uv.y * f * 2.7 + uTime * 0.8) * 2.2 - uTime * 0.55)
            * sin(uv.y * f * 5.5 - uTime * 1.4);
    float glint = smoothstep(0.72, 1.0, r);
    water += glint * mix(vec3(0.34, 0.37, 0.4), vec3(0.95, 0.58, 0.28), e) * (1.0 - 0.55 * d);
    float column = floor(uv.x * 56.0 * uScale);
    float streak = step(0.78, hash(column + 5.3)) * e;
    float shimmer = 0.5 + 0.5 * sin(uv.y * 130.0 + uTime * 3.2 + hash(column) * 6.2831);
    water += streak * shimmer * (1.0 - d) * vec3(1.0, 0.74, 0.38) * 0.55;
    col = water;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function RiverWindow({
  width,
  height,
  horizon = 0.44,
  scale = 1,
  position,
}: {
  width: number;
  height: number;
  /** Where the far bank meets the water, 0..1 from the bottom. */
  horizon?: number;
  /** Repeats buildings and ripples for wider planes. */
  scale?: number;
  position?: [number, number, number];
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEvening: { value: ambience.evening },
      uHorizon: { value: horizon },
      uScale: { value: scale },
    }),
    [horizon, scale],
  );

  useFrame(() => {
    const m = material.current;
    if (!m) return;
    m.uniforms.uTime.value = ambience.time;
    m.uniforms.uEvening.value = ambience.evening;
  });

  return (
    <mesh position={position}>
      <planeGeometry args={[width, height]} />
      <shaderMaterial ref={material} vertexShader={VERTEX} fragmentShader={FRAGMENT} uniforms={uniforms} toneMapped={false} />
    </mesh>
  );
}
