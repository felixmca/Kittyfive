// Kitty's face as SVG: the site's own mark (src/components/chrome/KittyFace.tsx)
// drawn into a 48 × 48 viewBox, shared by the merch textures
// (scripts/store/merch-textures.mjs) and the print files Printful receives
// (scripts/print-files.mjs).
//
//   faceSvg(size, outline)   — the site look, exactly as merch-textures always drew it
//   kittyFaceSvg(size, opts) — the same geometry in any palette, with scalable
//                              strokes and optional eye highlights, for
//                              embroidery (flat thread colours, thick strokes)
//                              and one-colour ink (black on transparent)

/** The site's colours, as KittyFace.tsx paints them. */
export const SITE_PALETTE = Object.freeze({
  fur: "#141414",
  /** Stroke round the fur. */
  outline: "#f4f1ea",
  ears: "#d98c96",
  bib: "#f4f1ea",
  eyes: "#f2cf4a",
  pupils: "#141414",
  highlight: "#fff",
  nose: "#e59aa5",
  mouth: "#6b6b6b",
  whiskers: "#f4f1ea",
  /** Strokes round the ear and eye shapes: none in the site look. */
  earStroke: null,
  eyeStroke: null,
});

/** Stroke widths in viewBox units (48 = the whole design), before scaling. */
export const STROKES = Object.freeze({ outline: 1.8, mouth: 0.9, whiskers: 0.8, ears: 0.9, eyes: 0.9 });

/** Formats a stroke width the way the original source wrote it ("1.8", ".9"). */
function num(n) {
  return String(Math.round(n * 1000) / 1000).replace(/^0\./, ".");
}

/**
 * Kitty's face at `size` px.
 *
 * @param {number} size  output width and height in px
 * @param {object} [opts]
 * @param {Partial<typeof SITE_PALETTE>} [opts.palette]  colours to override
 * @param {number | Partial<Record<keyof typeof STROKES, number>>} [opts.strokeScale]
 *        multiplies the stroke widths: one number for all, or per stroke
 * @param {boolean} [opts.highlights]  the two small white catchlights in the eyes (default true)
 * @param {boolean} [opts.crispEdges]  no anti-aliasing (shape-rendering="crispEdges"), so every
 *        pixel is exactly one of the palette colours — what embroidery digitising wants
 */
export function kittyFaceSvg(size, { palette = {}, strokeScale = 1, highlights = true, crispEdges = false } = {}) {
  const p = { ...SITE_PALETTE, ...palette };
  const rendering = crispEdges ? ' shape-rendering="crispEdges"' : "";
  const scale =
    typeof strokeScale === "number"
      ? { outline: strokeScale, mouth: strokeScale, whiskers: strokeScale, ears: strokeScale, eyes: strokeScale }
      : { outline: 1, mouth: 1, whiskers: 1, ears: 1, eyes: 1, ...strokeScale };
  const w = (k) => num(STROKES[k] * scale[k]);
  const earStroke = p.earStroke ? ` stroke="${p.earStroke}" stroke-width="${w("ears")}" stroke-linejoin="round"` : "";
  const eyeStroke = p.eyeStroke ? ` stroke="${p.eyeStroke}" stroke-width="${w("eyes")}"` : "";
  const catchlights = highlights
    ? `
  <circle cx="17.6" cy="22.9" r=".75" fill="${p.highlight}"/>
  <circle cx="32.4" cy="22.9" r=".75" fill="${p.highlight}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48"${rendering}>
  <path d="M24 12C26.5 12 28 12.4 29.5 13L37 6.5C38.2 6 39 6.6 39 7.8L39.5 19C43 25 42.5 34 36.5 39C32.5 42.5 28.5 43.5 24 43.5C19.5 43.5 15.5 42.5 11.5 39C5.5 34 5 25 8.5 19L9 7.8C9 6.6 9.8 6 11 6.5L18.5 13C20 12.4 21.5 12 24 12Z" fill="${p.fur}" stroke="${p.outline}" stroke-width="${w("outline")}" stroke-linejoin="round"/>
  <path d="M12.2 10.6L16.6 14.4L12.4 17.6Z" fill="${p.ears}"${earStroke}/>
  <path d="M35.8 10.6L31.4 14.4L35.6 17.6Z" fill="${p.ears}"${earStroke}/>
  <path d="M24 16.5C25.1 21.5 25.9 25 28.4 27.8C32 30.4 33.1 34 31.6 37C29.6 40.6 18.4 40.6 16.4 37C14.9 34 16 30.4 19.6 27.8C22.1 25 22.9 21.5 24 16.5Z" fill="${p.bib}"/>
  <ellipse cx="16.6" cy="24" rx="3.5" ry="3.1" fill="${p.eyes}"${eyeStroke}/>
  <ellipse cx="31.4" cy="24" rx="3.5" ry="3.1" fill="${p.eyes}"${eyeStroke}/>
  <ellipse cx="16.6" cy="24" rx="1" ry="2.5" fill="${p.pupils}"/>
  <ellipse cx="31.4" cy="24" rx="1" ry="2.5" fill="${p.pupils}"/>${catchlights}
  <path d="M22.3 30.3H25.7L24 32.4Z" fill="${p.nose}"/>
  <path d="M24 32.4C23.6 34 22.2 34.6 21 34M24 32.4C24.4 34 25.8 34.6 27 34" stroke="${p.mouth}" stroke-width="${w("mouth")}" stroke-linecap="round" fill="none"/>
  <path d="M15.5 32.2L4.5 30.4M15.6 34.2L5 35.6M32.5 32.2L43.5 30.4M32.4 34.2L43 35.6" stroke="${p.whiskers}" stroke-width="${w("whiskers")}" stroke-linecap="round"/>
</svg>`;
}

/**
 * The site's Kitty face (KittyFace.tsx), drawn at `size` px — the exact SVG
 * merch-textures.mjs has always used. `outline` colours both the stroke round
 * the fur and the whiskers.
 */
export function faceSvg(size, outline = "#f4f1ea") {
  return kittyFaceSvg(size, { palette: { outline, whiskers: outline } });
}
