"use client";
/**
 * Static camera for when WebGL is unavailable (or the canvas throws). Same
 * palette and silhouette as the procedural model, drawn as inline SVG so it
 * needs no request and no licence. The whole thing is a button to /try-on,
 * matching the 3D camera's behaviour.
 */
import { ACCENT } from "./CameraModel";

interface HeroFallbackProps {
  onActivate: () => void;
}

export default function HeroFallback({ onActivate }: HeroFallbackProps) {
  return (
    <div className="absolute inset-0 flex items-start justify-center pt-[3%] pl-[22%]">
      <button
        type="button"
        onClick={onActivate}
        aria-label="Open the try-on camera"
        className="kh-float h-[64%] min-h-11 min-w-11 aspect-[3/2] cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <svg viewBox="0 0 240 170" className="h-full w-full" role="img" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="kh-shadow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#000" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#000" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="kh-glass" cx="40%" cy="38%" r="65%">
              <stop offset="0%" stopColor="#1a3552" />
              <stop offset="60%" stopColor="#071019" />
              <stop offset="100%" stopColor="#030709" />
            </radialGradient>
            <linearGradient id="kh-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#26262b" />
              <stop offset="100%" stopColor="#15151a" />
            </linearGradient>
          </defs>

          {/* contact shadow */}
          <ellipse cx="122" cy="158" rx="92" ry="9" fill="url(#kh-shadow)" />

          {/* strap loops */}
          <circle cx="13" cy="84" r="7" fill="none" stroke="#9a9ca3" strokeWidth="3" />
          <circle cx="227" cy="84" r="7" fill="none" stroke="#9a9ca3" strokeWidth="3" />

          {/* flash cube + face */}
          <rect x="42" y="16" width="46" height="24" rx="5" fill="#1c1c20" />
          <rect x="49" y="21" width="32" height="14" rx="2" fill="#efe9dc" opacity="0.9" />

          {/* viewfinder */}
          <rect x="150" y="20" width="32" height="18" rx="4" fill="#2b2c32" />
          <rect x="158" y="25" width="16" height="8" rx="1.5" fill="#0a1420" />

          {/* shutter button */}
          <circle cx="198" cy="30" r="8" fill="#2b2c32" />
          <circle cx="198" cy="28" r="5.5" fill="#9a9ca3" />

          {/* top plate */}
          <rect x="30" y="34" width="180" height="14" rx="4" fill="#2b2c32" />

          {/* body */}
          <rect x="20" y="44" width="200" height="100" rx="14" fill="url(#kh-body)" stroke="#2f2f35" strokeWidth="1" />
          {/* grip band */}
          <rect x="18" y="74" width="204" height="40" rx="8" fill="#121214" />

          {/* lens */}
          <circle cx="130" cy="94" r="42" fill="#2b2c32" />
          <circle cx="130" cy="94" r="34" fill="#202126" />
          <circle cx="130" cy="94" r="28" fill="#15161a" />
          <circle cx="130" cy="94" r="24" fill="url(#kh-glass)" />
          <circle cx="130" cy="94" r="26" fill="none" stroke="#9a9ca3" strokeWidth="2" />
          {/* specular ring */}
          <path d="M112 86 A18 18 0 0 1 140 78" fill="none" stroke="#b9d0f0" strokeWidth="1.5" opacity="0.7" strokeLinecap="round" />

          {/* Kitty's yellow tag */}
          <circle cx="54" cy="94" r="6" fill={ACCENT} />
        </svg>
      </button>
    </div>
  );
}
