"use client";
/**
 * The 2D merch layer over the live video. A DPR-aware canvas the size of the
 * container; every animation frame it maps the smoothed landmarks into
 * (possibly mirrored) screen space, places the current product and paints it,
 * from the product's mockup image when it exists, procedurally when it 404s.
 *
 * It re-renders only when the product, colour or mirror state change; the
 * per-frame work reads refs.
 */
import { useEffect, useRef, type RefObject } from "react";
import type { Product } from "@/config/products";
import { PROCEDURAL_ASPECT, drawProduct, peekImage, placeProduct } from "./drawMerch";
import { mapPose, type Landmarks, type PersonSpot, type ScreenPose } from "./landmarks";

interface OverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  landmarks: RefObject<Landmarks | null>;
  product: Product;
  colour: string;
  mirrored: boolean;
  /** Receives the canvas so the shutter can composite it into the photo. */
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  /** Fires only when the "pinned to centre" vs "on the person" state flips. */
  onAnchoredChange?: (anchored: boolean) => void;
  /** Receives where the person is each frame, for Kitty to sit beside them. */
  personRef?: RefObject<PersonSpot | null>;
}

export default function Overlay({
  videoRef,
  landmarks,
  product,
  colour,
  mirrored,
  canvasRef,
  onAnchoredChange,
  personRef,
}: OverlayProps) {
  const localRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = localRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cw = 0;
    let ch = 0;
    let dpr = 1;
    let lastAnchored: boolean | null = null;
    const fallbackAspect = PROCEDURAL_ASPECT[product.id];
    const parent = canvas.parentElement;

    const fit = () => {
      const w = parent?.clientWidth || window.innerWidth;
      const h = parent?.clientHeight || window.innerHeight;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      if (w !== cw || h !== ch || d !== dpr) {
        cw = w;
        ch = h;
        dpr = d;
        canvas.width = Math.max(1, Math.round(w * d));
        canvas.height = Math.max(1, Math.round(h * d));
      }
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && parent) {
      ro = new ResizeObserver(fit);
      ro.observe(parent);
    } else {
      window.addEventListener("resize", fit);
    }
    fit();

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (cw === 0 || ch === 0) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const video = videoRef.current;
      const lm = landmarks.current;
      let pose: ScreenPose | null = null;
      if (lm && video && video.videoWidth > 0 && video.videoHeight > 0) {
        pose = mapPose(lm, video.videoWidth, video.videoHeight, cw, ch, mirrored);
      }
      if (personRef && pose && pose.leftShoulder.v > 0.5 && pose.rightShoulder.v > 0.5) {
        personRef.current = {
          x: (pose.leftShoulder.x + pose.rightShoulder.x) / 2,
          shoulderW: Math.abs(pose.leftShoulder.x - pose.rightShoulder.x),
          at: performance.now(),
        };
      }

      const img = peekImage(product.images.front);
      const aspect = img ? img.naturalHeight / img.naturalWidth : fallbackAspect;
      const place = placeProduct(product, pose, cw, ch, aspect);
      if (place.anchored !== lastAnchored) {
        lastAnchored = place.anchored;
        onAnchoredChange?.(place.anchored);
      }
      try {
        drawProduct(ctx, product, colour, place, img, { mirrored, dpr });
      } catch (err) {
        // one bad frame must not kill the loop
        if (Math.random() < 0.01) console.warn("[ar] overlay draw failed", err);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", fit);
    };
  }, [videoRef, landmarks, product, colour, mirrored, onAnchoredChange, personRef]);

  return (
    <canvas
      ref={(el) => {
        localRef.current = el;
        if (canvasRef) canvasRef.current = el;
      }}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
