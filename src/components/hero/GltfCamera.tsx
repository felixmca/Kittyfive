"use client";
/**
 * Optional real camera model. Only mounted after Hero has confirmed with a
 * HEAD request that /models/camera.glb exists; it then suspends while the
 * file loads (the procedural camera shows meanwhile) and throws if the GLB
 * is unusable, which the surrounding ErrorBoundary turns back into the
 * procedural camera. Scale is normalised so the model is exactly as tall as
 * the procedural one and centred on the origin.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF } from "@react-three/drei";
import { CAMERA_HEIGHT } from "./CameraModel";

/** Also named in Hero.tsx, which must not import this module (it pulls in three.js). */
export const CAMERA_GLB = "/models/camera.glb";
/** Draco decoders are copied into public/draco by scripts/copy-decoders.mjs; no CDN. */
const DRACO_PATH = "/draco/";

export default function GltfCamera() {
  const { scene } = useGLTF(CAMERA_GLB, DRACO_PATH);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y < 1e-6) {
      throw new Error("camera.glb has no measurable geometry");
    }
    const s = CAMERA_HEIGHT / size.y;
    const centre = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
    clone.scale.setScalar(s);
    clone.position.set(-centre.x, -centre.y, -centre.z);
    return clone;
  }, [scene]);

  return <primitive object={model} />;
}
