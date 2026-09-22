"use client";
/**
 * The MISSING flyer as inline SVG: white paper, a strip of yellow tape, bold
 * MISSING, a rounded photo placeholder with a tiny cat, text lines and a
 * phone number drawn as bars. 120 × 160 viewBox (3:4).
 */
import styles from "./transitions.module.css";

export default function MissingFlyer({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 160"
      className={`${styles.flyerSvg} ${className ?? ""}`.trim()}
      role="img"
      aria-label="Missing cat flyer"
      focusable="false"
    >
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
