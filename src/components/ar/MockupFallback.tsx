"use client";
/**
 * What you see instead of the camera: before it is opened, while it starts,
 * and when permission is refused or the browser has no camera at all. A
 * designed stand-in (soft gradient, a person silhouette) wearing the current
 * product, drawn with the same placement and painting code as the live
 * overlay, so switching products still works with zero camera and zero assets.
 */
import { useEffect, useRef } from "react";
import type { Product } from "@/config/products";
import { PROCEDURAL_ASPECT, drawProduct, loadImage, peekImage, placeProduct } from "./drawMerch";
import type { ScreenPose } from "./landmarks";

interface MockupFallbackProps {
  product: Product;
  colour: string;
  /** Darken the whole thing (a message panel sits on top). */
  dim?: boolean;
}

export default function MockupFallback({ product, colour, dim = false }: MockupFallbackProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let cancelled = false;
    const parent = canvas.parentElement;

    const render = () => {
      if (cancelled) return;
      const cw = parent?.clientWidth || window.innerWidth;
      const ch = parent?.clientHeight || window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(cw * dpr));
      canvas.height = Math.max(1, Math.round(ch * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // backdrop
      const bg = ctx.createRadialGradient(cw * 0.5, ch * 0.32, 10, cw * 0.5, ch * 0.45, Math.max(cw, ch) * 0.8);
      bg.addColorStop(0, "#1e1d23");
      bg.addColorStop(1, "#0b0b0c");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);

      // stand-in person
      const u = Math.min(cw, ch * 0.5);
      const headR = u * 0.14;
      const cx = cw / 2;
      const headY = ch * 0.3;
      const shoulderY = headY + headR * 2.05;
      const shoulderHalf = u * 0.42;
      ctx.fillStyle = "#26252c";
      ctx.beginPath();
      ctx.moveTo(cx - u * 0.38, ch + 10);
      ctx.lineTo(cx - u * 0.4, shoulderY + u * 0.22);
      ctx.quadraticCurveTo(cx - shoulderHalf, shoulderY + u * 0.02, cx - headR * 0.6, shoulderY - u * 0.06);
      ctx.lineTo(cx - headR * 0.6, shoulderY - u * 0.16);
      ctx.lineTo(cx + headR * 0.6, shoulderY - u * 0.16);
      ctx.lineTo(cx + headR * 0.6, shoulderY - u * 0.06);
      ctx.quadraticCurveTo(cx + shoulderHalf, shoulderY + u * 0.02, cx + u * 0.4, shoulderY + u * 0.22);
      ctx.lineTo(cx + u * 0.38, ch + 10);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, headY, headR * 0.92, headR, 0, 0, Math.PI * 2);
      ctx.fill();

      const pose: ScreenPose = {
        nose: { x: cx, y: headY + headR * 0.25, v: 1 },
        leftEye: { x: cx + headR * 0.42, y: headY - headR * 0.05, v: 1 },
        rightEye: { x: cx - headR * 0.42, y: headY - headR * 0.05, v: 1 },
        leftEar: { x: cx + headR * 0.95, y: headY, v: 1 },
        rightEar: { x: cx - headR * 0.95, y: headY, v: 1 },
        leftShoulder: { x: cx + shoulderHalf * 0.82, y: shoulderY + u * 0.04, v: 1 },
        rightShoulder: { x: cx - shoulderHalf * 0.82, y: shoulderY + u * 0.04, v: 1 },
        leftHip: { x: cx + u * 0.3, y: shoulderY + u * 0.95, v: 1 },
        rightHip: { x: cx - u * 0.3, y: shoulderY + u * 0.95, v: 1 },
      };

      const img = peekImage(product.images.front);
      const aspect = img ? img.naturalHeight / img.naturalWidth : PROCEDURAL_ASPECT[product.id];
      const place = placeProduct(product, pose, cw, ch, aspect);
      try {
        drawProduct(ctx, product, colour, place, img, { mirrored: false, dpr });
      } catch (err) {
        console.warn("[ar] mockup draw failed", err);
      }

      if (dim) {
        ctx.fillStyle = "rgba(11, 11, 12, 0.55)";
        ctx.fillRect(0, 0, cw, ch);
      }
    };

    render();
    // Repaint once the real mockup image arrives (or is confirmed missing).
    void loadImage(product.images.front).then(() => render());

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && parent) {
      ro = new ResizeObserver(() => render());
      ro.observe(parent);
    } else {
      window.addEventListener("resize", render);
    }
    return () => {
      cancelled = true;
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", render);
    };
  }, [product, colour, dim]);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
