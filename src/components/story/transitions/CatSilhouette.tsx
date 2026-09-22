"use client";
/**
 * A side-view black-and-white cat built from paths, facing right. Legs are
 * grouped so a parent `.walk` class (see transitions.module.css) animates a
 * diagonal gait; without it she stands still. Colours are props so the same
 * shape works as a dark cut-out over photos and as a cream mark on glass.
 */
import type { CSSProperties } from "react";
import styles from "./transitions.module.css";

interface Props {
  /** Adds the walk class on the svg itself; overlays toggle it on a parent instead. */
  walking?: boolean;
  body?: string;
  patch?: string;
  outline?: string;
  eye?: string;
  className?: string;
  title?: string;
}

const legStyle = (x: number): CSSProperties => ({ transformOrigin: `${x}px 56px` });

export default function CatSilhouette({
  walking = false,
  body = "#0b0b0c",
  patch = "#f4f1ea",
  outline = "rgba(244,241,234,0.55)",
  eye = "#ffd166",
  className,
  title = "Kitty",
}: Props) {
  const cls = [styles.catSvg, walking ? styles.walk : "", className ?? ""].join(" ").trim();
  return (
    <svg viewBox="0 0 130 92" className={cls} role="img" aria-label={title} focusable="false">
      <ellipse cx="64" cy="88.5" rx="46" ry="3" fill="#000" opacity="0.35" />

      {/* far legs (behind the body) */}
      <g className={`${styles.leg} ${styles.legA}`} style={legStyle(36)}>
        <rect x="31" y="52" width="10" height="33" rx="4.5" fill={body} stroke={outline} strokeWidth="1" />
        <rect x="31" y="77" width="10" height="8" rx="3.5" fill={patch} />
      </g>
      <g className={`${styles.leg} ${styles.legB}`} style={legStyle(88)}>
        <rect x="83" y="52" width="10" height="33" rx="4.5" fill={body} stroke={outline} strokeWidth="1" />
      </g>

      <g className={styles.torso}>
        {/* tail */}
        <path d="M22 50 C 6 44, 2 22, 18 12" fill="none" stroke={outline} strokeWidth="9.5" strokeLinecap="round" opacity="0.4" />
        <path d="M22 50 C 6 44, 2 22, 18 12" fill="none" stroke={body} strokeWidth="7.5" strokeLinecap="round" />
        <path d="M16 15 C 15 12, 17 9, 20 10" fill="none" stroke={patch} strokeWidth="5.5" strokeLinecap="round" />
        {/* body */}
        <path
          d="M20 44 C 20 28, 40 22, 62 24 C 84 26, 100 30, 103 44 C 105 56, 92 63, 62 63 C 38 63, 20 60, 20 44 Z"
          fill={body}
          stroke={outline}
          strokeWidth="1"
        />
        <path d="M40 58 C 48 52, 68 52, 80 58 C 70 62.5, 50 62.5, 40 58 Z" fill={patch} />
        {/* head */}
        <path
          d="M96 38 C 92 20, 100 8, 114 10 C 128 12, 130 30, 124 42 C 118 50, 100 50, 96 38 Z"
          fill={body}
          stroke={outline}
          strokeWidth="1"
        />
        <path d="M98 20 L 100 3 L 111 12 Z" fill={body} stroke={outline} strokeWidth="1" strokeLinejoin="round" />
        <path d="M116 11 L 126 2 L 127 20 Z" fill={body} stroke={outline} strokeWidth="1" strokeLinejoin="round" />
        <path d="M118 30 C 122 34, 124 40, 121 45 C 115 47, 110 44, 111 38 Z" fill={patch} />
        <circle cx="116.5" cy="27.5" r="1.9" fill={eye} />
      </g>

      {/* near legs (in front) */}
      <g className={`${styles.leg} ${styles.legB}`} style={legStyle(46)}>
        <rect x="41" y="52" width="10" height="33" rx="4.5" fill={body} stroke={outline} strokeWidth="1" />
      </g>
      <g className={`${styles.leg} ${styles.legA}`} style={legStyle(98)}>
        <rect x="93" y="52" width="10" height="33" rx="4.5" fill={body} stroke={outline} strokeWidth="1" />
        <rect x="93" y="77" width="10" height="8" rx="3.5" fill={patch} />
      </g>
    </svg>
  );
}
