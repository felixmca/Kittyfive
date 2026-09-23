"use client";
/**
 * The cap in 3D on the head (Phase 4, first step), drawn over the live video
 * with three.js.
 *
 * Screen-space placement from the face tracker (useFaceTracking): the model's
 * origin sits on the top of the forehead (landmark 10), one model unit is the
 * face's width (cheekbone to cheekbone, measured in 3D), and the head's
 * rotation comes from MediaPipe's facial transformation matrix. An orthographic
 * camera in container pixels keeps that exact; the video's object-fit: cover
 * crop and the selfie mirror are reproduced so the cap lands where the face is
 * on screen.
 *
 *   crown    a dome a little wider than the head, tipped so the back sits lower
 *   seams    six stitched panels meeting at the button
 *   brim     a curved visor, angled down a touch
 *   patch    Kitty's face, embroidered on the front (from src/app/icon.svg's drawing)
 *   head     an invisible ellipsoid that only writes depth, so the back of the
 *            cap disappears behind the wearer's head
 *
 * The light follows the room: the video's average brightness and colour,
 * sampled twice a second, set the fill light.
 *
 * Proportions are first estimates from face geometry and have not been tried
 * on a real face yet (no camera where this was built): /try-on?cap3d=1 shows
 * it; window.__cap3d.setHead() lets the verify harness pose a head without one.
 */
import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { Head } from "./useFaceTracking";

interface Props {
  head: RefObject<Head | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  colour: string;
  mirrored: boolean;
  /** Receives the canvas so the shutter can composite it into the photo. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  /** Fires only when a head comes into or goes out of view. */
  onSeenChange?: (seen: boolean) => void;
}

type CapWindow = Window & { __cap3d?: { setHead: (h: Head | null) => void; state: () => { visible: boolean } } };

/** Crown: a sphere cap. Everything below is in face widths (1 = cheekbone to cheekbone). */
const R = 0.6;
const SQUASH = 0.86;
const CROWN_CENTRE = new THREE.Vector3(0, -0.22, -0.5);
const TILT = -0.2; // radians about x: negative lifts the front and lowers the back
/** Where the wearer's head is, for the invisible occluder. */
const HEAD_CENTRE = new THREE.Vector3(0, -0.44, -0.5);
const HEAD_RADII = new THREE.Vector3(0.5, 0.68, 0.6);

const FACE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="256" height="256" fill="none"><path d="M24 12C26.5 12 28 12.4 29.5 13L37 6.5C38.2 6 39 6.6 39 7.8L39.5 19C43 25 42.5 34 36.5 39C32.5 42.5 28.5 43.5 24 43.5C19.5 43.5 15.5 42.5 11.5 39C5.5 34 5 25 8.5 19L9 7.8C9 6.6 9.8 6 11 6.5L18.5 13C20 12.4 21.5 12 24 12Z" fill="#141414" stroke="#f4f1ea" stroke-width="2.2" stroke-linejoin="round"/><path d="M24 16.5C25.1 21.5 25.9 25 28.4 27.8C32 30.4 33.1 34 31.6 37C29.6 40.6 18.4 40.6 16.4 37C14.9 34 16 30.4 19.6 27.8C22.1 25 22.9 21.5 24 16.5Z" fill="#f4f1ea"/><ellipse cx="16.6" cy="24" rx="3.6" ry="3.2" fill="#f2cf4a"/><ellipse cx="31.4" cy="24" rx="3.6" ry="3.2" fill="#f2cf4a"/><ellipse cx="16.6" cy="24" rx="1.1" ry="2.5" fill="#141414"/><ellipse cx="31.4" cy="24" rx="1.1" ry="2.5" fill="#141414"/><path d="M22.3 30.3H25.7L24 32.4Z" fill="#e59aa5"/></svg>`;

function buildCap(colour: string): { cap: THREE.Group; materials: THREE.MeshStandardMaterial[]; dispose: () => void } {
  const cap = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const cloth = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.92, metalness: 0 });
  const seamColour = new THREE.Color(colour).multiplyScalar(0.62);
  const seam = new THREE.MeshStandardMaterial({ color: seamColour, roughness: 0.95 });
  const underBrim = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(0.55), roughness: 0.95 });

  // The dome: from the top down to a little below its middle.
  const crownGroup = new THREE.Group();
  crownGroup.position.copy(CROWN_CENTRE);
  crownGroup.rotation.x = TILT;
  crownGroup.scale.set(1, SQUASH, 1.04);
  const crownGeo = new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, THREE.MathUtils.degToRad(96));
  geometries.push(crownGeo);
  const crown = new THREE.Mesh(crownGeo, cloth);
  crownGroup.add(crown);

  // Six panels: seams from just above the rim up to the button. A torus arc in
  // the XY plane starts at +x and turns towards +y; START lifts its first end
  // off the rim, where the seams would otherwise poke out at the sides.
  const START = 0.16;
  const seamGeo = new THREE.TorusGeometry(R * 1.004, 0.0045, 6, 40, Math.PI / 2 - START);
  geometries.push(seamGeo);
  for (let k = 0; k < 6; k++) {
    const holder = new THREE.Group();
    holder.rotation.y = (k * Math.PI) / 3 + Math.PI / 6;
    const s = new THREE.Mesh(seamGeo, seam);
    s.rotation.z = START;
    holder.add(s);
    crownGroup.add(holder);
  }

  const buttonGeo = new THREE.SphereGeometry(0.038, 16, 10);
  geometries.push(buttonGeo);
  const button = new THREE.Mesh(buttonGeo, cloth);
  button.position.y = R;
  crownGroup.add(button);

  // The patch: Kitty's face, stitched on the front panel.
  const patchCanvas = document.createElement("canvas");
  patchCanvas.width = 256;
  patchCanvas.height = 256;
  const texture = new THREE.CanvasTexture(patchCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const g = patchCanvas.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, 256, 256);
    g.drawImage(img, 0, 0, 256, 256);
    texture.needsUpdate = true;
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FACE_SVG)}`;
  const patchMat = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.85, alphaTest: 0.05 });
  const patchGeo = new THREE.PlaneGeometry(0.2, 0.2);
  geometries.push(patchGeo);
  const patch = new THREE.Mesh(patchGeo, patchMat);
  const up = THREE.MathUtils.degToRad(32); // how far up the front of the dome
  patch.position.set(0, R * Math.sin(up) * 1.012, R * Math.cos(up) * 1.012);
  patch.rotation.x = -up;
  crownGroup.add(patch);
  cap.add(crownGroup);

  // The brim: a curved visor off the front of the band, angled down.
  // In the shape's plane +y is forward: a rounded front, and a back edge that
  // curves back at the sides to follow the round front of the crown.
  const shape = new THREE.Shape();
  shape.moveTo(-0.42, -0.14);
  shape.bezierCurveTo(-0.4, 0.55, 0.4, 0.55, 0.42, -0.14);
  shape.quadraticCurveTo(0, 0.02, -0.42, -0.14);
  const brimGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 2, curveSegments: 24 });
  // Bend the sides down, as a worn-in visor does.
  const pos = brimGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) + 0.3 * x * x);
  }
  brimGeo.computeVertexNormals();
  geometries.push(brimGeo);
  const brim = new THREE.Mesh(brimGeo, [cloth, underBrim]);
  // Lay the shape flat with the visor towards +z (rotating +90° about x takes
  // +y to +z and the thickness downwards), then tip it down a touch. Its back
  // edge tucks just under the front of the band (≈ y -0.15, z 0.12).
  brim.rotation.x = Math.PI / 2 + 0.24;
  brim.position.set(0, -0.165, 0.15);
  cap.add(brim);

  // The wearer's head: depth only, drawn first, so the cap's far side is hidden.
  const headGeo = new THREE.SphereGeometry(1, 32, 20);
  geometries.push(headGeo);
  const occluder = new THREE.Mesh(headGeo, new THREE.MeshBasicMaterial({ colorWrite: false }));
  occluder.position.copy(HEAD_CENTRE);
  occluder.scale.copy(HEAD_RADII);
  occluder.renderOrder = -1;
  cap.add(occluder);

  return {
    cap,
    materials: [cloth, seam, underBrim],
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      [cloth, seam, underBrim, patchMat, occluder.material as THREE.Material].forEach((m) => m.dispose());
      texture.dispose();
    },
  };
}

export default function Cap3D({ head, videoRef, colour, mirrored, canvasRef, onSeenChange }: Props) {
  const localRef = useRef<HTMLCanvasElement | null>(null);
  const colourRef = useRef(colour);
  const mirroredRef = useRef(mirrored);
  const seenRef = useRef(onSeenChange);
  useEffect(() => {
    seenRef.current = onSeenChange;
  }, [onSeenChange]);

  useEffect(() => {
    colourRef.current = colour;
  }, [colour]);
  useEffect(() => {
    mirroredRef.current = mirrored;
  }, [mirrored]);

  useEffect(() => {
    const canvas = localRef.current;
    if (!canvas) return;
    if (canvasRef) canvasRef.current = canvas;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch (err) {
      console.warn("[ar] no WebGL for the 3D cap", err);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10000, 10000);
    camera.position.set(0, 0, 5000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(0.3, 1, 0.8);
    scene.add(hemi, key);

    let built = buildCap(colourRef.current);
    let builtColour = colourRef.current;
    const pivot = new THREE.Group();
    pivot.add(built.cap);
    scene.add(pivot);

    // Debug/verify: pose a head without a camera.
    let forced: Head | null | undefined;
    let visible = false;
    let reported: boolean | null = null;
    const report = (v: boolean) => {
      if (v === reported) return;
      reported = v;
      seenRef.current?.(v);
    };
    (window as CapWindow).__cap3d = {
      setHead: (h) => {
        forced = h;
      },
      state: () => ({ visible }),
    };

    // The room's light, from the video twice a second.
    const probe = document.createElement("canvas");
    probe.width = 8;
    probe.height = 8;
    const probeCtx = probe.getContext("2d", { willReadFrequently: true });
    let lastProbe = 0;
    const tint = new THREE.Color(1, 1, 1);

    const q = new THREE.Quaternion();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const parent = canvas.parentElement;
      if (!parent) return;
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        renderer.setPixelRatio(dpr);
        renderer.setSize(cw, ch, false);
        camera.left = -cw / 2;
        camera.right = cw / 2;
        camera.top = ch / 2;
        camera.bottom = -ch / 2;
        camera.updateProjectionMatrix();
      }
      if (colourRef.current !== builtColour) {
        pivot.remove(built.cap);
        built.dispose();
        built = buildCap(colourRef.current);
        builtColour = colourRef.current;
        pivot.add(built.cap);
      }

      const video = videoRef.current;
      const h = forced !== undefined ? forced : head.current;
      const vw = video?.videoWidth || 1280;
      const vh = video?.videoHeight || 720;
      if (!h) {
        visible = false;
        report(false);
        pivot.visible = false;
        renderer.render(scene, camera);
        return;
      }
      // Undo object-fit: cover, then the mirror.
      const s = Math.max(cw / vw, ch / vh);
      const dw = vw * s;
      const dh = vh * s;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;
      let px = ox + h.anchor.x * dw;
      const py = oy + h.anchor.y * dh;
      const mirror = mirroredRef.current;
      if (mirror) px = cw - px;
      pivot.position.set(px - cw / 2, ch / 2 - py, 0);
      const size = h.width * dw;
      pivot.scale.setScalar(size);
      const [x, y, z, w] = h.quat;
      // A mirrored picture reflects the rotation across the vertical plane.
      q.set(x, mirror ? -y : y, mirror ? -z : z, w);
      pivot.quaternion.copy(q);
      pivot.visible = true;
      visible = true;
      report(true);

      if (video && probeCtx && now - lastProbe > 500 && video.readyState >= 2) {
        lastProbe = now;
        try {
          probeCtx.drawImage(video, 0, 0, 8, 8);
          const d = probeCtx.getImageData(0, 0, 8, 8).data;
          let r = 0;
          let g = 0;
          let b = 0;
          for (let i = 0; i < d.length; i += 4) {
            r += d[i];
            g += d[i + 1];
            b += d[i + 2];
          }
          const n = d.length / 4;
          r /= n * 255;
          g /= n * 255;
          b /= n * 255;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          hemi.intensity = 0.45 + 1.5 * lum;
          key.intensity = 0.5 + 1.4 * lum;
          const m = Math.max(r, g, b, 0.001);
          tint.setRGB(0.6 + 0.4 * (r / m), 0.6 + 0.4 * (g / m), 0.6 + 0.4 * (b / m));
          hemi.color.copy(tint);
        } catch {
          /* a frame we cannot read: keep the last light */
        }
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      built.dispose();
      renderer.dispose();
      const w = window as CapWindow;
      delete w.__cap3d;
      if (canvasRef && canvasRef.current === canvas) canvasRef.current = null;
    };
  }, [head, videoRef, canvasRef]);

  return <canvas ref={localRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" data-cap3d />;
}
