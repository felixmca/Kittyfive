"use client";
/**
 * TryOn — the /try-on experience. Full viewport:
 *
 *   video (object-fit: cover, mirrored on the front camera)
 *   ├─ Overlay          2D merch on the tracked person (or pinned to centre)
 *   ├─ KittyCompanion   R3F cat on the floor line, bottom 35%
 *   ├─ top bar          flip camera (top-left), tracking hint (centre),
 *   │                   top-right left clear for the site menu
 *   ├─ message panel    "Open camera" / calm errors + static mockup behind
 *   └─ bottom bar       product pills, "Buy this", 64 px shutter
 *
 * The camera starts only after a tap. Nothing leaves the device: tracking
 * runs in-browser and the photo is composited locally. Tracks are stopped on
 * unmount and whenever the page is hidden.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRODUCTS, type Product } from "@/config/products";
import { useUi } from "@/lib/store";
import { CLEAR_OF_HOME } from "@/components/chrome/layout";
import Cap3D from "./Cap3D";
import KittyCompanion from "./KittyCompanion";
import MockupFallback from "./MockupFallback";
import Overlay from "./Overlay";
import { useFaceTracking } from "./useFaceTracking";
import { useLandmarks } from "./useLandmarks";

type Phase =
  | "idle"
  | "starting"
  | "live"
  | "paused"
  | "denied"
  | "nocamera"
  | "unsupported"
  | "error";
type Facing = "user" | "environment";

const PILL_LABELS: Record<Product["id"], string> = {
  cap: "Cap",
  hoodie: "Hoodie",
  longsleeve: "Long-sleeve",
};

interface SnapResult {
  url: string;
  file: File;
  canShare: boolean;
}

interface TryOnProps {
  /** When rendered as an overlay by the site chrome, shows a close button. */
  onClose?: () => void;
}

const SAFE_TOP = { paddingTop: "max(12px, env(safe-area-inset-top))" } as const;
const SAFE_BOTTOM = { paddingBottom: "max(16px, env(safe-area-inset-bottom))" } as const;

export default function TryOn({ onClose }: TryOnProps = {}) {
  const productIndex = useUi((s) => s.productIndex);
  const setProductIndex = useUi((s) => s.setProductIndex);
  const showToast = useUi((s) => s.showToast);

  const safeIndex = Math.min(Math.max(productIndex, 0), PRODUCTS.length - 1);
  const product = PRODUCTS[safeIndex];

  // Colour choice per product (tap the active pill again to cycle).
  const [variantPick, setVariantPick] = useState<Record<string, number>>({});
  const colours = useMemo(
    () => Array.from(new Set(product.variants.map((v) => v.colour))),
    [product],
  );
  const colour = colours[(variantPick[product.id] ?? 0) % Math.max(1, colours.length)] ?? "#111111";

  const [phase, setPhase] = useState<Phase>("idle");
  const [facing, setFacing] = useState<Facing>("user");
  const [mirrored, setMirrored] = useState(true);
  const [anchored, setAnchored] = useState(false);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [busy, setBusy] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const capCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const kittyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const phaseRef = useRef<Phase>(phase);
  const facingRef = useRef<Facing>(facing);
  const snapRef = useRef<SnapResult | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    facingRef.current = facing;
  }, [facing]);
  useEffect(() => {
    snapRef.current = snap;
  }, [snap]);

  const live = phase === "live";
  // Phase 4, first step: the cap in 3D on the head, from face tracking. Behind
  // ?cap3d=1 until it has been tried on real faces; if face tracking cannot
  // start here, the 2D cap (body tracking) takes over for the visit.
  const [cap3dWanted] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("cap3d"),
  );
  const [faceFailed, setFaceFailed] = useState(false);
  const [headSeen, setHeadSeen] = useState(false);
  const use3dCap = cap3dWanted && !faceFailed && product.id === "cap";
  const { landmarks, status: tracking } = useLandmarks(videoRef, live && !use3dCap);
  const { head, status: faceTracking } = useFaceTracking(videoRef, live && use3dCap);
  if (faceTracking === "unavailable" && !faceFailed) setFaceFailed(true);

  // ------------------------------------------------------------- camera

  const stopStream = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (s) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {
          // already stopped
        }
      }
    }
    const v = videoRef.current;
    if (v) {
      try {
        v.pause();
      } catch {
        // nothing to pause
      }
      v.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (want: Facing) => {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function"
      ) {
        setPhase("unsupported");
        return;
      }
      setPhase("starting");
      stopStream();
      landmarks.current = null;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: want, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!alive.current) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;

        const track = stream.getVideoTracks()[0];
        let reported: string | undefined;
        try {
          reported = track?.getSettings?.().facingMode;
        } catch {
          reported = undefined;
        }
        const actual: Facing =
          reported === "environment" ? "environment" : reported === "user" ? "user" : want;
        if (reported && actual !== want) showToast("Only one camera here");
        setFacing(actual);
        setMirrored(actual === "user");

        const video = videoRef.current;
        if (!video) {
          stopStream();
          setPhase("error");
          return;
        }
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          // Autoplay refusal: the tap that got us here normally covers it.
          console.warn("[ar] video.play() refused", err);
        }
        if (!alive.current) {
          stopStream();
          return;
        }
        setPhase("live");
      } catch (err) {
        stopStream();
        const name = err instanceof Error ? err.name : "";
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
          setPhase("denied");
        } else if (
          name === "NotFoundError" ||
          name === "DevicesNotFoundError" ||
          name === "OverconstrainedError" ||
          name === "NotReadableError"
        ) {
          setPhase("nocamera");
        } else {
          console.warn("[ar] getUserMedia failed", err);
          setPhase("error");
        }
      }
    },
    [stopStream, landmarks, showToast],
  );

  // Stop on unmount and whenever the page is hidden; resume when it returns.
  useEffect(() => {
    alive.current = true;
    const onHide = () => {
      if (streamRef.current) {
        stopStream();
        if (phaseRef.current === "live" || phaseRef.current === "starting") setPhase("paused");
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
      else if (phaseRef.current === "paused") void startCamera(facingRef.current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      alive.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      stopStream();
      if (snapRef.current) URL.revokeObjectURL(snapRef.current.url);
    };
  }, [stopStream, startCamera]);

  const flip = () => void startCamera(facing === "user" ? "environment" : "user");

  // ------------------------------------------------------------ products

  const pickProduct = (i: number) => {
    if (i === safeIndex) {
      if (colours.length > 1) {
        setVariantPick((prev) => ({ ...prev, [product.id]: (prev[product.id] ?? 0) + 1 }));
      }
    } else {
      setProductIndex(i);
    }
  };

  const onAnchoredChange = useCallback((a: boolean) => setAnchored(a), []);

  // ------------------------------------------------------------- shutter

  const takeSnap = useCallback(async () => {
    const video = videoRef.current;
    const container = containerRef.current;
    if (!video || !container || video.videoWidth === 0) {
      showToast("The camera is still starting");
      return;
    }
    setBusy(true);
    try {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(cw * dpr));
      out.height = Math.max(1, Math.round(ch * dpr));
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no 2d context");

      ctx.fillStyle = "#0b0b0c";
      ctx.fillRect(0, 0, out.width, out.height);

      // video, reproducing object-fit: cover and the mirror
      ctx.save();
      ctx.scale(dpr, dpr);
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const s = Math.max(cw / vw, ch / vh);
      const dw = vw * s;
      const dh = vh * s;
      if (mirrored) {
        ctx.translate(cw, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
      ctx.restore();

      const overlay = overlayCanvasRef.current;
      if (overlay && overlay.width > 0) {
        ctx.drawImage(overlay, 0, 0, overlay.width, overlay.height, 0, 0, out.width, out.height);
      }
      const cap = capCanvasRef.current;
      if (cap && cap.width > 0) {
        ctx.drawImage(cap, 0, 0, cap.width, cap.height, 0, 0, out.width, out.height);
      }

      const kitty = kittyCanvasRef.current;
      if (kitty && kitty.width > 0) {
        try {
          const kr = kitty.getBoundingClientRect();
          const cr = container.getBoundingClientRect();
          ctx.drawImage(
            kitty,
            0,
            0,
            kitty.width,
            kitty.height,
            (kr.left - cr.left) * dpr,
            (kr.top - cr.top) * dpr,
            kr.width * dpr,
            kr.height * dpr,
          );
        } catch (err) {
          console.warn("[ar] could not add Kitty to the photo", err);
        }
      }

      // small wordmark
      ctx.save();
      ctx.scale(dpr, dpr);
      const fs = Math.round(Math.min(cw, ch) * 0.06);
      ctx.font = `600 ${fs}px Fraunces, "Iowan Old Style", Georgia, serif`;
      ctx.fillStyle = "rgba(244, 241, 234, 0.92)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
      ctx.shadowBlur = 10;
      ctx.textBaseline = "top";
      ctx.fillText("Kitty", 18, 18);
      ctx.restore();

      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("toBlob failed");
      const file = new File([blob], `kitty-${product.id}.png`, { type: "image/png" });
      const url = URL.createObjectURL(blob);
      let canShare = false;
      try {
        canShare =
          typeof navigator.share === "function" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] });
      } catch {
        canShare = false;
      }
      setSnap((prev) => {
        if (prev) URL.revokeObjectURL(prev.url);
        return { url, file, canShare };
      });
    } catch (err) {
      console.warn("[ar] snapshot failed", err);
      showToast("Couldn't take that one. Try again.");
    } finally {
      setBusy(false);
    }
  }, [mirrored, product.id, showToast]);

  const share = async () => {
    if (!snap) return;
    try {
      await navigator.share({ files: [snap.file], title: "Kitty try-on", text: product.name });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      showToast("Sharing didn't work here. Use Save instead.");
    }
  };

  const retake = () => {
    setSnap((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  };

  // ---------------------------------------------------------------- copy

  const hint = !live
    ? null
    : use3dCap
      ? faceTracking === "loading"
        ? "Finding your face…"
        : headSeen
          ? null
          : "Look at the camera"
      : tracking === "loading"
        ? "Finding you…"
        : anchored
          ? null
          : "Move into frame";
  const subHint =
    live && tracking === "unavailable"
      ? "Fit tracking is off on this device, so the merch sits in the middle."
      : null;

  const panel = (() => {
    switch (phase) {
      case "idle":
        return {
          kicker: "Kitty · Try it on",
          title: "Put Kitty on.",
          body: "Point it at yourself or a friend. Nothing is uploaded.",
          action: "Open camera",
        };
      case "starting":
        return { kicker: "Kitty · Try it on", title: "Opening camera…", body: "", action: null };
      case "paused":
        return {
          kicker: "Paused",
          title: "Camera paused",
          body: "We stopped the camera while you were away.",
          action: "Resume camera",
        };
      case "denied":
        return {
          kicker: "No camera, no problem",
          title: "Here's the fit on a stand-in.",
          body: "Camera access was declined, so this is a preview. Nothing was uploaded either way. You can allow the camera in your browser settings and try again.",
          action: "Try again",
        };
      case "nocamera":
        return {
          kicker: "No camera found",
          title: "Here's the fit on a stand-in.",
          body: "We couldn't find a camera on this device, so this is a preview.",
          action: "Try again",
        };
      case "unsupported":
        return {
          kicker: "Try it on",
          title: "This browser can't open the camera.",
          body: "Try Safari on iPhone or Chrome on Android (over https). Or just browse the store — the fit preview still works.",
          action: null,
        };
      case "error":
        return {
          kicker: "Try it on",
          title: "The camera didn't start.",
          body: "Something in the browser got in the way. You can try again, or browse the store.",
          action: "Try again",
        };
      default:
        return null;
    }
  })();

  // -------------------------------------------------------------- render

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 select-none overflow-hidden bg-[#0b0b0c] text-[#f4f1ea]"
    >
      {/* camera */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
          live ? "opacity-100" : "opacity-0"
        }`}
        style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
      />
      {!live && <MockupFallback product={product} colour={colour} dim />}

      {/* merch */}
      {live && use3dCap && (
        <Cap3D
          head={head}
          videoRef={videoRef}
          colour={colour}
          mirrored={mirrored}
          canvasRef={capCanvasRef}
          onSeenChange={setHeadSeen}
        />
      )}
      {live && !use3dCap && (
        <Overlay
          videoRef={videoRef}
          landmarks={landmarks}
          product={product}
          colour={colour}
          mirrored={mirrored}
          canvasRef={overlayCanvasRef}
          onAnchoredChange={onAnchoredChange}
        />
      )}

      {/* Kitty on the floor */}
      <KittyCompanion canvasRef={kittyCanvasRef} />

      {/* top bar: controls left (after Kitty's home button), hint centre, right kept clear for the site menu */}
      <div
        className="absolute inset-x-0 top-0 z-20 grid grid-cols-[auto_1fr_auto] items-start gap-2 px-3"
        style={{ ...SAFE_TOP, paddingLeft: CLEAR_OF_HOME }}
      >
        <div className="flex gap-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close try-on"
              className="glass grid h-11 w-11 place-items-center rounded-full active:scale-95"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {live && (
            <button
              type="button"
              onClick={flip}
              aria-label={facing === "user" ? "Switch to back camera" : "Switch to front camera"}
              className="glass grid h-11 w-11 place-items-center rounded-full active:scale-95"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M4 8h3l2-2.5h6L17 8h3v11H4z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 13.5a2.5 2.5 0 0 0 4.3 1.8M14.5 13.5a2.5 2.5 0 0 0-4.3-1.8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path d="M14 15.5h-1.6v-1.6M10 11.5h1.6v1.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 pt-1">
          {hint && (
            <div role="status" className="glass max-w-[70vw] rounded-full px-3 py-2 text-center text-xs font-medium">
              {hint}
            </div>
          )}
          {subHint && (
            <p className="max-w-[60vw] text-center text-[11px] leading-tight text-[#f4f1ea]/70">
              {subHint}
            </p>
          )}
        </div>
        <div className="h-11 w-12" aria-hidden />
      </div>

      {/* message panel */}
      {panel && (
        <div
          className="absolute inset-x-0 z-20 flex items-center justify-center px-5"
          style={{ top: "17%", bottom: "36%" }}
        >
          <div className="glass w-full max-w-sm rounded-3xl p-6 text-center">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-[#ffd166]">
              {panel.kicker}
            </p>
            <h1 className="font-display mt-2 text-3xl leading-tight">{panel.title}</h1>
            {panel.body && (
              <p className="mt-3 text-sm leading-relaxed text-[#f4f1ea]/80">{panel.body}</p>
            )}
            {panel.action && (
              <button
                type="button"
                onClick={() => void startCamera(facing)}
                className="glass mt-5 inline-flex h-14 min-w-[200px] items-center justify-center rounded-full px-6 text-base font-medium ring-1 ring-[#ffd166]/60 active:scale-[0.98]"
              >
                {panel.action}
              </button>
            )}
            {phase === "starting" && (
              <div className="mt-5 flex justify-center" aria-hidden>
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffd166]" />
              </div>
            )}
            {(phase === "unsupported" || phase === "denied" || phase === "nocamera" || phase === "error") && (
              <Link
                href="/store"
                className="mt-4 inline-flex h-11 items-center justify-center px-4 text-sm text-[#f4f1ea]/75 underline underline-offset-4"
              >
                Browse the store
              </Link>
            )}
          </div>
        </div>
      )}

      {/* bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 px-4" style={SAFE_BOTTOM}>
        <div role="radiogroup" aria-label="Product" className="glass flex max-w-full items-center gap-1 rounded-full p-1">
          {PRODUCTS.map((p, i) => {
            const active = i === safeIndex;
            const swatch = active ? colour : p.variants[0]?.colour ?? "#111111";
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pickProduct(i)}
                title={active && colours.length > 1 ? "Tap again for another colour" : undefined}
                className={`flex h-11 items-center gap-2 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors ${
                  active ? "bg-[#f4f1ea] text-[#0b0b0c]" : "text-[#f4f1ea]/85"
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border border-white/30"
                  style={{ background: swatch }}
                  aria-hidden
                />
                {PILL_LABELS[p.id]}
              </button>
            );
          })}
        </div>

        <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
          <Link
            href="/store"
            className="glass inline-flex h-11 items-center justify-self-start rounded-full px-4 text-sm font-medium active:scale-95"
          >
            Buy this
          </Link>
          {live ? (
            <button
              type="button"
              onClick={() => void takeSnap()}
              disabled={busy}
              aria-label="Take a photo"
              className="grid h-16 w-16 place-items-center rounded-full bg-[#ffd166] ring-4 ring-white/25 active:scale-95 disabled:opacity-60"
            >
              <span className="block h-[52px] w-[52px] rounded-full border-[3px] border-[#0b0b0c]/35" aria-hidden />
            </button>
          ) : (
            <span className="h-16 w-16" aria-hidden />
          )}
          {/* bottom-right stays empty for the site's floating camera button */}
          <span className="h-11 w-11 justify-self-end" aria-hidden />
        </div>
      </div>

      {/* photo result */}
      {snap && (
        <div
          className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-4"
          style={SAFE_BOTTOM}
          role="dialog"
          aria-label="Your photo"
        >
          <div className="glass w-full max-w-sm rounded-3xl p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL, not an optimisable asset */}
            <img
              src={snap.url}
              alt="Your try-on photo"
              className="mx-auto max-h-[46dvh] w-auto rounded-2xl"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              {snap.canShare ? (
                <button
                  type="button"
                  onClick={() => void share()}
                  className="h-12 rounded-full bg-[#ffd166] font-medium text-[#0b0b0c] active:scale-[0.98]"
                >
                  Share
                </button>
              ) : (
                <a
                  href={snap.url}
                  download={`kitty-${product.id}.png`}
                  className="grid h-12 place-items-center rounded-full bg-[#ffd166] font-medium text-[#0b0b0c] active:scale-[0.98]"
                >
                  Save PNG
                </a>
              )}
              <button
                type="button"
                onClick={retake}
                className="glass h-12 rounded-full font-medium active:scale-[0.98]"
              >
                Retake
              </button>
            </div>
            {snap.canShare && (
              <a
                href={snap.url}
                download={`kitty-${product.id}.png`}
                className="mt-1 block py-3 text-center text-xs text-[#f4f1ea]/70 underline underline-offset-4"
              >
                or save the PNG
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
