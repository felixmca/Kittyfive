/**
 * Kitty's landing story: four chapters, one AI clip each, chained so that
 * every clip starts on the previous clip's final frame
 * (docs/HANDOVER-01-STORY-ASSETS.md). The landing plays them as swipe-driven
 * flows (src/components/landing/SwipeStory): one swipe plays from one
 * chapter's stop to the next, and each chapter's title and subtitle assemble
 * as it finishes.
 *
 * Each chapter's id is its folder: scripts/build-story.mjs turns
 * assets-raw/story/<id>/clip/ into WebP frames in public/story/<id>/ and lists
 * the chapter in public/story/index.json. A chapter that is not listed yet
 * plays a designed stand-in (`standIn`), so the page is complete before its
 * clip exists, and picks the clip up by itself once `npm run story` has run.
 *
 * The same four chapters live on the Stories page too
 * (supabase/seed/kitty.sql, src/config/stories.ts), each in its volume.
 */

/** How the story gets from the previous chapter's stop into this chapter. */
export type ChapterEntrance =
  | "none" // the first chapter: it plays as the page loads
  | "whatsapp" // the neighbours' chat airdrops in, frames the photo, zooms into it
  | "flyer" // the MISSING flyer drops in over the join
  | "crossfade";

export interface LandingChapter {
  id: string;
  title: string;
  subtitle: string;
  /** Small line above the title: when and where. */
  kicker: string;
  enter: ChapterEntrance;
  /** Seconds the clip plays over. Default: the clip's own length. */
  playback?: number;
  /** Real photos choreographed over the clip. */
  overlay?: "kittens";
  /** The look of the stand-in while the chapter has no clip. */
  standIn: "night" | "river";
  /** The stand-in shows this chapter's final frame (default: the previous chapter's). */
  standInFrame?: string;
}

export const STORY: LandingChapter[] = [
  {
    id: "01-a-cold-night",
    title: "A cold night",
    subtitle: "She did not ask. She just came in. She stayed.",
    kicker: "January 2025 · Smith Close, SE16",
    enter: "none",
    standIn: "night",
  },
  {
    id: "02-five-by-dawn",
    title: "Five by dawn",
    subtitle: "Half past midnight, a cardboard box, one kitten every thirty minutes.",
    kicker: "14 April 2025 · 12:30am",
    enter: "whatsapp",
    // A touch slower than the 5.05 s clip so five kittens can arrive.
    playback: 6,
    overlay: "kittens",
    standIn: "night",
  },
  {
    id: "03-missing-found",
    title: "Missing, Found",
    subtitle: "Four months of flyers. Then a neighbour, some snacks, and a phone call.",
    kicker: "December 2025 – April 2026",
    enter: "flyer",
    standIn: "night",
  },
  {
    id: "04-riverside-sofa",
    title: "Riverside sofa",
    subtitle: "She's been next to me the entire time I've been building this.",
    kicker: "Pacific Wharf · now",
    enter: "crossfade",
    standIn: "river",
    // Until the sofa clip exists: her at home, a hand on her head, in warm river light.
    standInFrame: "01-a-cold-night",
  },
];

/** The neighbours' WhatsApp chat (published blurred) that flies in before chapter 2. */
export const WHATSAPP = {
  src: "/story/whatsapp-chat.webp",
  width: 946,
  height: 2048,
  /** The photo inside the screenshot, in screenshot pixels (public/story/whatsapp-chat.json). */
  photo: { x: 106, y: 715, w: 608, h: 811 },
  /**
   * Where that photo sits in chapter 1's final frame, in 576×1024 frame
   * pixels (measured by `node scripts/align-chat.mjs`; the frame is a centre
   * crop of the photo). The flight lands exactly on it, so the chat can hand
   * over to the frame without a visible jump. Re-measure if clip 1 changes.
   */
  landsOn: { x: -96.4, y: -0.5, w: 770.8, h: 1028.1 },
};

/** Chapter 2's real kitten photos, in the order they arrive (one every thirty minutes). */
export const KITTENS = [
  { src: "/story/02-five-by-dawn/extras/kittens1.webp", time: "12:30" },
  { src: "/story/02-five-by-dawn/extras/kittens2.webp", time: "1:00" },
  { src: "/story/02-five-by-dawn/extras/kittens3.webp", time: "1:30" },
  { src: "/story/02-five-by-dawn/extras/kittens4.webp", time: "2:00" },
  { src: "/story/02-five-by-dawn/extras/kittens5.webp", time: "2:30" },
];

/** The real MISSING flyer, once assets-raw/ui/flyer has one; a drawn flyer until then. */
export const FLYER_SRC = "/story/flyer.webp";

/** The 360° turntable at the end of the story: N photos in public/turntable/. */
export const TURNTABLE = {
  dir: "/turntable",
  /** Written by scripts/build-story.mjs from whatever is in assets-raw/turntable. */
  manifest: "/turntable/manifest.json",
  /** Degrees per frame of the 36-frame spin; 10 = one full revolution per full-width drag. */
  degreesPerFrame: 10,
};
