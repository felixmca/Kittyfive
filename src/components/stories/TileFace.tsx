/**
 * The face of a chapter: date, title, subtitle, description, over up to two
 * background images that blend into each other along a gradient.
 *
 * Image A fills the tile; image B sits on top of it with a CSS mask that runs
 * from transparent to opaque along `blend.angle`, between `blend.from`% and
 * `blend.to`%. So with the default (180°, 35%→70%) the top of the tile is A,
 * the bottom is B, and they dissolve into each other in the middle third.
 * With no images the tile gets a gradient seeded from its slug, so a new
 * chapter still looks designed.
 *
 * Used three ways: as a tile in the grid, as the live preview in the tile
 * editor, and full-screen as a chapter's opening page in the reader.
 */
import type { CSSProperties, ReactNode } from "react";
import { mediaUrl } from "@/lib/supabase/config";
import { storyDateText, type TileBlend } from "@/lib/stories/types";

export interface TileFaceData {
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  dateLabel: string | null;
  storyDate: string | null;
  tileImageA: string | null;
  tileImageB: string | null;
  tileBlend: TileBlend;
  status?: "draft" | "published";
}

function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A calm two-colour gradient that is always the same for the same slug. */
function fallbackBackground(seed: string): string {
  const h = hash(seed || "kitty");
  const hue1 = h % 360;
  const hue2 = (hue1 + 40 + ((h >> 9) % 80)) % 360;
  return [
    `radial-gradient(120% 90% at 20% 10%, hsl(${hue1} 38% 30% / 0.95), transparent 60%)`,
    `radial-gradient(110% 80% at 85% 95%, hsl(${hue2} 42% 24% / 0.95), transparent 65%)`,
    `linear-gradient(160deg, hsl(${hue1} 22% 13%), hsl(${hue2} 26% 9%))`,
  ].join(", ");
}

export function blendMask(blend: TileBlend): string {
  return `linear-gradient(${blend.angle}deg, transparent ${blend.from}%, #000 ${blend.to}%)`;
}

export function TileBackdrop({
  data,
  eager = false,
  className = "",
}: {
  data: Pick<TileFaceData, "slug" | "tileImageA" | "tileImageB" | "tileBlend">;
  eager?: boolean;
  className?: string;
}) {
  const a = mediaUrl(data.tileImageA) ?? mediaUrl(data.tileImageB);
  const b = data.tileImageA ? mediaUrl(data.tileImageB) : null;
  const mask = blendMask(data.tileBlend);
  const maskStyle: CSSProperties = { maskImage: mask, WebkitMaskImage: mask };
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{ background: fallbackBackground(data.slug) }}
    >
      {a ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      {b ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={b}
          alt=""
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={maskStyle}
        />
      ) : null}
    </div>
  );
}

export default function TileFace({
  data,
  kicker,
  corner,
  size = "tile",
  eager = false,
  cornerSpace = false,
  children,
}: {
  data: TileFaceData;
  /** Overrides the date line (e.g. "Volume 2 · The cupboard"). */
  kicker?: ReactNode;
  /** Top-right slot (grip, draft badge). */
  corner?: ReactNode;
  size?: "tile" | "cover";
  eager?: boolean;
  /** Leave the top-right corner free for a control laid over the tile. */
  cornerSpace?: boolean;
  children?: ReactNode;
}) {
  const date = storyDateText(data);
  const cover = size === "cover";
  return (
    <div className="relative h-full w-full overflow-hidden" data-tile-face>
      <TileBackdrop data={data} eager={eager} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: cover
            ? "linear-gradient(to top, rgba(8,8,9,0.92) 0%, rgba(8,8,9,0.55) 38%, rgba(8,8,9,0.1) 70%, rgba(8,8,9,0.35) 100%)"
            : "linear-gradient(to top, rgba(8,8,9,0.9) 0%, rgba(8,8,9,0.45) 45%, rgba(8,8,9,0.05) 75%)",
        }}
      />

      {/* On a tile the date and draft badge sit in the top corner. On a cover
          (the reader) the top of the screen belongs to the fixed controls, so
          they move into the text block below. */}
      {cover ? null : (
        <div className={`absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3 ${cornerSpace ? "pr-14" : ""}`}>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {kicker ?? (date ? <Pill>{date}</Pill> : null)}
            {data.status === "draft" ? <Pill tone="accent">Draft</Pill> : null}
          </div>
          {corner}
        </div>
      )}

      <div className={`absolute inset-x-0 bottom-0 ${cover ? "p-6 pb-10 sm:p-10" : "p-4 sm:p-5"}`}>
        {cover ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {kicker ? <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fg/70">{kicker}</p> : null}
            {date ? <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">{date}</p> : null}
            {data.status === "draft" ? <Pill tone="accent">Draft</Pill> : null}
          </div>
        ) : null}
        <h3
          className={`font-display font-light leading-[1.04] tracking-[-0.01em] text-fg ${
            cover ? "text-[44px] sm:text-[64px]" : "text-[20px] sm:text-[25px]"
          }`}
        >
          {data.title || "Untitled chapter"}
        </h3>
        {data.subtitle ? (
          <p
            className={`text-fg/85 ${
              cover ? "mt-3 max-w-[34ch] text-[18px] leading-snug sm:text-[20px]" : "mt-1.5 line-clamp-2 text-[13px] leading-snug sm:text-[15px]"
            }`}
          >
            {data.subtitle}
          </p>
        ) : null}
        {data.description ? (
          <p
            className={`text-muted ${
              cover ? "mt-4 max-w-[46ch] text-[15px] leading-relaxed" : "mt-2 hidden text-[13px] leading-snug sm:line-clamp-2 sm:block"
            }`}
          >
            {data.description}
          </p>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function Pill({ children, tone = "glass" }: { children: ReactNode; tone?: "glass" | "accent" }) {
  return (
    <span
      className={`inline-block h-6 max-w-full truncate rounded-full px-2.5 text-[10.5px] font-medium uppercase leading-6 tracking-[0.14em] ${
        tone === "accent" ? "bg-accent text-[#141414]" : "border border-white/15 bg-black/35 text-fg/90 backdrop-blur-md"
      }`}
    >
      {children}
    </span>
  );
}
