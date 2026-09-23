"use client";
/**
 * The Thames beyond the garden: sky, the far bank, and the river, painted on
 * one big plane behind everything (scenery, like a stage backcloth).
 *
 * The far bank is Felix's own photo from the garden gate at dusk, cut out
 * along the skyline (public/store/farbank-evening.webp), and a daylight
 * repaint of the same skyline (farbank-day.webp); scripts/store/textures.mjs
 * makes both. The sky is drawn here and eases from pale day to the photo's
 * deep blue dusk; the water mirrors the far bank, lit windows and all, and
 * ripples and glints move on it. Until the photos have loaded (or if they
 * cannot), a drawn row of buildings stands in.
 *
 * Reads the shared ambience record every frame (ambience.ts), so the light
 * changes without React.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ambience } from "./ambience";
import { LAYOUT } from "./spots";

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
uniform float uBankH;
uniform float uRepeats;
uniform float uHasBank;
uniform sampler2D uBankDay;
uniform sampler2D uBankEve;
varying vec2 vUv;

float hash(float n) { return fract(sin(n) * 43758.5453123); }

// The photographed far bank at (x across the plane, v up from the waterline),
// repeated with every other copy mirrored so the joins are seamless.
vec4 bank(float x, float v) {
  float u = x * uRepeats;
  float m = mod(u, 2.0);
  u = m > 1.0 ? 2.0 - m : m;
  vec2 st = vec2(clamp(u, 0.002, 0.998), clamp(1.0 - v, 0.002, 0.998));
  return mix(texture2D(uBankDay, st), texture2D(uBankEve, st), uEvening);
}

// The drawn stand-in: a row of blocks with lit windows at dusk.
vec4 drawnBank(float x, float v) {
  float cells = 16.0 * uRepeats;
  float cell = floor(x * cells);
  float h = 0.35 + 0.6 * hash(cell + 3.1) * step(0.2, hash(cell + 11.7));
  if (v > h) return vec4(0.0);
  vec3 c = mix(vec3(0.5, 0.52, 0.56), vec3(0.05, 0.06, 0.11), uEvening);
  vec2 g = vec2(x * 80.0 * uRepeats, v * 12.0);
  float lit = step(0.7, hash(floor(g.x) * 12.9898 + floor(g.y) * 78.233));
  c += lit * step(fract(g.x), 0.55) * step(fract(g.y), 0.5) * uEvening * vec3(1.0, 0.78, 0.42);
  return vec4(c, 1.0);
}

vec4 farBank(float x, float v) {
  return uHasBank > 0.5 ? bank(x, v) : drawnBank(x, v);
}

void main() {
  vec2 uv = vUv;
  float e = uEvening;

  // Sky: pale blue by day; at dusk the photo's deep blue over a peach glow.
  float sy = clamp((uv.y - uHorizon) / (1.0 - uHorizon), 0.0, 1.0);
  vec3 dayCol = mix(vec3(0.85, 0.9, 0.95), vec3(0.52, 0.7, 0.92), sy);
  vec3 eveCol = mix(vec3(0.93, 0.66, 0.52), vec3(0.06, 0.13, 0.42), pow(sy, 0.45));
  vec3 col = mix(dayCol, eveCol, e);

  if (uv.y >= uHorizon) {
    float v = (uv.y - uHorizon) / uBankH;
    if (v <= 1.0) {
      vec4 b = farBank(uv.x, v);
      col = mix(col, b.rgb, b.a);
    }
  } else {
    float d = (uHorizon - uv.y) / uHorizon; // 0 at the far bank, 1 at the bottom
    vec3 wDay = mix(vec3(0.6, 0.67, 0.73), vec3(0.33, 0.41, 0.48), d);
    vec3 wEve = mix(vec3(0.1, 0.15, 0.3), vec3(0.03, 0.05, 0.11), d);
    vec3 water = mix(wDay, wEve, e);
    // The far bank, upside down in the water, broken up by the ripples.
    float wob = sin(uv.y * 900.0 + uTime * 1.6) * 0.0016 + sin(uv.x * 70.0 + uTime * 0.7 + uv.y * 240.0) * 0.0011;
    float rv = (uHorizon - uv.y) / (uBankH * 0.85);
    if (rv < 1.0) {
      vec4 r = farBank(uv.x + wob * (1.0 + 10.0 * d), rv);
      float fade = (1.0 - rv) * mix(0.5, 0.85, e);
      water = mix(water, r.rgb * mix(0.6, 0.95, e), r.a * fade);
    }
    // Glints drifting downstream.
    float f = mix(46.0, 14.0, d);
    float rr = sin(uv.x * 34.0 * uRepeats + sin(uv.y * f * 2.7 + uTime * 0.8) * 2.2 - uTime * 0.55)
             * sin(uv.y * f * 5.5 - uTime * 1.4);
    float glint = smoothstep(0.76, 1.0, rr);
    water += glint * mix(vec3(0.32, 0.35, 0.38), vec3(0.55, 0.42, 0.3), e) * (1.0 - 0.6 * d) * 0.6;
    col = water;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const B = LAYOUT.backdrop;

function loadTexture(url: string, onLoad: (t: THREE.Texture) => void): THREE.Texture {
  const t = new THREE.TextureLoader().load(url, onLoad);
  t.colorSpace = THREE.NoColorSpace; // sampled as stored: this shader writes display colours
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

export default function RiverBackdrop() {
  const material = useRef<THREE.ShaderMaterial>(null);
  const bottom = B.y - B.height / 2;
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEvening: { value: ambience.evening },
      uHorizon: { value: (B.horizonY - bottom) / B.height },
      uBankH: { value: 0.18 },
      uRepeats: { value: B.bankRepeats },
      uHasBank: { value: 0 },
      uBankDay: { value: null as THREE.Texture | null },
      uBankEve: { value: null as THREE.Texture | null },
    }),
    [bottom],
  );

  useEffect(() => {
    let arrived = 0;
    const ready = (t: THREE.Texture) => {
      const img = t.image as { width?: number; height?: number } | undefined;
      if (img?.width && img.height) {
        // The skyline keeps its proportions: one copy spans width / repeats.
        uniforms.uBankH.value = (B.width / B.bankRepeats / (img.width / img.height)) / B.height;
      }
      if (++arrived === 2) uniforms.uHasBank.value = 1;
    };
    const day = loadTexture("/store/farbank-day.webp", ready);
    const eve = loadTexture("/store/farbank-evening.webp", ready);
    uniforms.uBankDay.value = day;
    uniforms.uBankEve.value = eve;
    return () => {
      day.dispose();
      eve.dispose();
    };
  }, [uniforms]);

  useFrame(() => {
    const m = material.current;
    if (!m) return;
    m.uniforms.uTime.value = ambience.time;
    m.uniforms.uEvening.value = ambience.evening;
  });

  return (
    <mesh position={[0, B.y, B.z]} renderOrder={-1}>
      <planeGeometry args={[B.width, B.height]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        toneMapped={false}
        depthWrite={false}
      />
    </mesh>
  );
}
