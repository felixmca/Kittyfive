"use client";
/**
 * Kitty's speech bubble, anchored above her head with drei's Html so it follows
 * her around the room. Shows her opening line (Kitty Tunables, /admin) when
 * the store first opens, then each product's pitch once she has walked over
 * to it. Hidden while walking.
 */
import { useEffect, useState } from "react";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { KITTY } from "@/config/kitty";
import { PRODUCTS } from "@/config/products";
import { SITE } from "@/config/site";
import { useOpeningLine } from "@/lib/personaClient";
import { useStoreState } from "./storeState";
import { wrapIndex } from "./spots";

const OPENING_MS = 5200;
/** Half the bubble's widest (220px) plus a margin: its centre never comes closer to an edge. */
const EDGE = 122;
const scratch = new THREE.Vector3();

/**
 * Above her head, like drei's default, but kept on screen: near the left or
 * right edge of a phone the bubble slides inwards instead of being cut off.
 */
function onScreen(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): number[] {
  const p = scratch.setFromMatrixPosition(el.matrixWorld).project(camera);
  const x = (p.x * size.width) / 2 + size.width / 2;
  const y = (-p.y * size.height) / 2 + size.height / 2;
  const lo = Math.min(EDGE, size.width / 2);
  return [Math.min(size.width - lo, Math.max(lo, x)), y];
}

export default function SpeechBubble() {
  const arrivedIndex = useStoreState((s) => s.arrivedIndex);
  const arrivals = useStoreState((s) => s.arrivals);
  const poiLine = useStoreState((s) => s.poiLine);
  const [openingDone, setOpeningDone] = useState(false);
  const opening = useOpeningLine(SITE.petSlug);

  // After the opening line has had its moment, move on to the pitch even if
  // the visitor has not tapped anything yet.
  useEffect(() => {
    if (arrivals > 0 || openingDone) return;
    const t = setTimeout(() => setOpeningDone(true), OPENING_MS);
    return () => clearTimeout(t);
  }, [arrivals, openingDone]);

  const text = poiLine
    ? poiLine
    : arrivedIndex === null
      ? null
      : arrivals === 0 && !openingDone
        ? opening
        : (PRODUCTS[wrapIndex(arrivedIndex, PRODUCTS.length)]?.pitch ?? opening);

  // Keep the last line in the DOM so it can fade out instead of vanishing.
  const [shown, setShown] = useState<string>(KITTY.opening);
  useEffect(() => {
    if (text) setShown(text);
  }, [text]);

  const visible = text !== null;

  return (
    <Html
      position={[0, 0.66, 0]}
      center
      calculatePosition={onScreen}
      zIndexRange={[10, 0]}
      pointerEvents="none"
      style={{ pointerEvents: "none" }}
    >
      <div
        role="status"
        aria-live="polite"
        className={`glass relative w-max max-w-[220px] rounded-2xl px-3.5 py-2.5 leading-snug text-fg transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
        style={{ transform: "translateY(-50%)" }}
      >
        <span className="font-display text-[15px]">{shown}</span>
        <span
          aria-hidden
          className="glass absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-l-0 border-t-0"
        />
      </div>
    </Html>
  );
}
