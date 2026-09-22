/**
 * Kitty's landing story: six chapters the scroll engine plays in order, one
 * Kling clip each (docs/HANDOVER-01-STORY-ASSETS.md).
 *
 * Each scene's id is its folder: scripts/build-story.mjs turns
 * assets-raw/story/<id>/clip/ (the artta clip) into a WebP frame sequence in
 * public/story/<id>/, and assets-raw/story/<id>/start-frame/ into
 * public/story/<id>/still.webp, the fallback poster. A scene with neither
 * shows a designed placeholder, so the page never breaks while clips are
 * still being made.
 *
 * The same six chapters live in the Stories page too (supabase/seed/kitty.sql),
 * each in the volume that fits it; their scenes point at the same folders.
 *
 * `beats` are the lines of text that fade in, in order, while the scene is
 * pinned. `enter`/`exit` name the transition between neighbouring scenes.
 */

export type SceneTransition =
  | "crossfade" // default
  | "walk-out-of-frame" // Kitty cut-out walks from this scene's frame into the next
  | "fall" // an element (the flyer) falls through the frame
  | "slide-up"
  | "zoom";

export type SceneMedia =
  | { kind: "sequence"; fallbackPoster?: string } // frames live in public/story/<id>/
  | { kind: "image"; src: string }
  | { kind: "none" };

export interface StoryScene {
  id: string;
  /** Short kicker shown above the beats, e.g. a date. */
  kicker?: string;
  title: string;
  beats: string[];
  media: SceneMedia;
  enter?: SceneTransition;
  exit?: SceneTransition;
  /** How many viewport-heights of scroll this scene is pinned for. */
  pinLength?: number;
  /** Aspect of the generated clip. Mobile story is 9:16 by default. */
  aspect?: "9:16" | "4:5" | "1:1";
  /** Optional: a transparent PNG cut-out of Kitty used by walk-out-of-frame. */
  cutout?: string;
}

export const STORY: StoryScene[] = [
  {
    id: "01-a-cold-night",
    kicker: "January 2025 · Smith Close, SE16",
    title: "A cold night",
    beats: [
      "One cold January night, a black-and-white cat walked in through our back door.",
      "She did not ask. She just came in.",
      "We called her Kitty because we weren't sure we'd keep her.",
      "She stayed.",
    ],
    media: { kind: "sequence", fallbackPoster: "/story/01-a-cold-night/still.webp" },
    exit: "zoom",
    pinLength: 2.6,
  },
  {
    id: "02-five-by-dawn",
    kicker: "14 April 2025 · 12:30am",
    title: "Five by dawn",
    beats: [
      "At half past midnight, in a cardboard box in the bedroom cupboard, the first kitten arrived.",
      "Then another, every thirty minutes.",
      "By dawn there were five.",
      "She raised them in that cupboard, until every one was adopted and the box was empty again.",
    ],
    media: { kind: "sequence", fallbackPoster: "/story/02-five-by-dawn/still.webp" },
    exit: "walk-out-of-frame",
    pinLength: 2.8,
  },
  {
    id: "03-a-flat-on-the-thames",
    kicker: "November 2025 · Pacific Wharf",
    title: "A flat on the Thames",
    beats: [
      "In November we moved to a ground-floor flat on the river.",
      "New windows. New smells. The same cat on the same sofa.",
    ],
    media: { kind: "sequence", fallbackPoster: "/story/03-a-flat-on-the-thames/still.webp" },
    enter: "walk-out-of-frame",
    exit: "fall",
    pinLength: 2.2,
    cutout: "/story/cutouts/kitty-walk.png",
  },
  {
    id: "04-thousands-of-flyers",
    kicker: "23 December 2025",
    title: "Thousands of flyers",
    beats: [
      "Two days before Christmas we were away for three nights.",
      "The building manager fed her every morning and every evening.",
      "She thought we had left her. She went missing.",
      "Thousands of flyers. Every letterbox we could reach. Rainy nights. Wet paper. Four months.",
    ],
    media: { kind: "sequence", fallbackPoster: "/story/04-thousands-of-flyers/still.webp" },
    enter: "fall",
    pinLength: 3,
  },
  {
    id: "05-and-there-she-was",
    kicker: "April 2026",
    title: "And there she was",
    beats: [
      "Four months later, a neighbour saw a flyer, lured her inside with some snacks, and called.",
      "I cycled over as fast as I could.",
      "And there she was. Like she had nothing to say. Just a faint recognition.",
      "That's Kitty sometimes. A subtle type of love.",
    ],
    media: { kind: "sequence", fallbackPoster: "/story/05-and-there-she-was/still.webp" },
    exit: "slide-up",
    pinLength: 3,
  },
  {
    id: "06-next-to-me",
    kicker: "Now",
    title: "Next to me",
    beats: ["She's been next to me the entire time I've been building this."],
    media: { kind: "sequence", fallbackPoster: "/story/06-next-to-me/still.webp" },
    enter: "slide-up",
    pinLength: 1.8,
  },
];

/** The 360° turntable at the end of the story: N photos in public/turntable/. */
export const TURNTABLE = {
  dir: "/turntable",
  /** Written by scripts/build-story.mjs from whatever is in assets-raw/turntable. */
  manifest: "/turntable/manifest.json",
  /** Degrees per frame of the 36-frame spin; 10 = one full revolution per full-width drag. */
  degreesPerFrame: 10,
};
