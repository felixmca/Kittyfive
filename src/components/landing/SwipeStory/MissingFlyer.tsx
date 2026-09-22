"use client";
/**
 * The MISSING flyer that drops into chapter 3. When the real flyer has been
 * added (assets-raw/ui/flyer → /story/flyer.webp by `npm run story`) it is
 * that; until then an inline drawing of one: white paper, yellow tape, bold
 * MISSING, a photo with a tiny cat, text lines and a phone number as bars.
 */
import { useEffect, useState } from "react";
import { FLYER_SRC } from "@/config/story";

export default function MissingFlyer() {
  const [real, setReal] = useState(false);
  useEffect(() => {
    let live = true;
    // HEAD first, so a missing flyer is not a failed image load in the console.
    fetch(FLYER_SRC, { method: "HEAD" })
      .then((res) => {
        const type = res.headers.get("content-type") ?? "";
        if (live && res.ok && type.startsWith("image/")) setReal(true);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (real) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={FLYER_SRC} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    );
  }

  return (
    <svg viewBox="0 0 120 160" width="100%" height="100%" aria-hidden focusable="false">
      <rect x="0" y="0" width="120" height="160" rx="3" fill="#f6f2e8" />
      <rect x="0.5" y="0.5" width="119" height="159" rx="3" fill="none" stroke="rgba(0,0,0,0.14)" />
      <rect x="44" y="-3" width="32" height="9" rx="1.5" fill="#ffd166" opacity="0.92" transform="rotate(-4 60 1)" />
      <text
        x="60"
        y="34"
        textAnchor="middle"
        fontSize="25"
        fontWeight="700"
        letterSpacing="1"
        fill="#111"
        style={{ fontFamily: "var(--font-display), Georgia, serif" }}
      >
        MISSING
      </text>
      <rect x="18" y="44" width="84" height="64" rx="5" fill="#dcd6c9" stroke="#b9b2a3" />
      <g fill="#2a2a2c">
        <circle cx="60" cy="80" r="13" />
        <path d="M49 72 L 47 58 L 57 67 Z" />
        <path d="M63 67 L 73 58 L 71 72 Z" />
      </g>
      <ellipse cx="60" cy="85.5" rx="5" ry="3.2" fill="#f4f1ea" />
      <circle cx="55" cy="78" r="1.4" fill="#ffd166" />
      <circle cx="65" cy="78" r="1.4" fill="#ffd166" />
      <rect x="18" y="116" width="84" height="4" rx="2" fill="#6b665c" />
      <rect x="18" y="125" width="60" height="4" rx="2" fill="#6b665c" />
      <g fill="#111">
        <rect x="18" y="138" width="16" height="9" rx="1.5" />
        <rect x="38" y="138" width="10" height="9" rx="1.5" />
        <rect x="51" y="138" width="10" height="9" rx="1.5" />
        <rect x="64" y="138" width="10" height="9" rx="1.5" />
        <rect x="77" y="138" width="10" height="9" rx="1.5" />
        <rect x="90" y="138" width="12" height="9" rx="1.5" />
      </g>
    </svg>
  );
}
