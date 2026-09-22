/**
 * Kitty's story, as a list of scenes the scroll engine plays in order.
 *
 * Each scene owns a slot in public/story/<id>/. scripts/build-story.mjs turns
 * whatever the owner drops into assets-raw/story/<id>/ (an .mp4 from artta.ai,
 * or a single .jpg/.png) into a WebP frame sequence + manifest.json there.
 * A scene whose slot is empty renders a placeholder card so the page never
 * breaks while assets are still being generated.
 *
 * `beats` are the lines of text that fade in, in order, while the scene is
 * pinned. `enter`/`exit` name the transition the engine uses between scenes.
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
    id: "01-january-night",
    kicker: "January 2025 · Smith Close, SE16",
    title: "A cold night",
    beats: [
      "One cold January night, a black-and-white cat walked in through our back door.",
      "She did not ask. She just came in.",
    ],
    media: { kind: "sequence" },
    exit: "walk-out-of-frame",
    pinLength: 2.2,
  },
  {
    id: "02-named-kitty",
    title: "We called her Kitty",
    beats: [
      "We called her Kitty because we weren't sure we'd keep her.",
      "We didn't want to get attached.",
    ],
    media: { kind: "sequence" },
    enter: "walk-out-of-frame",
    pinLength: 1.8,
  },
  {
    id: "03-she-stayed",
    title: "She stayed.",
    beats: ["She stayed."],
    media: { kind: "sequence" },
    exit: "zoom",
    pinLength: 1.4,
  },
  {
    id: "04-the-box",
    kicker: "14 April 2025 · 12:30am",
    title: "A cardboard box in a bedroom cupboard",
    beats: [
      "At half past midnight, in a cardboard box in the bedroom cupboard, the first kitten arrived.",
      "Then another, every thirty minutes.",
      "By dawn there were five.",
    ],
    media: { kind: "sequence" },
    pinLength: 2.6,
  },
  {
    id: "05-five-kittens",
    title: "Five",
    beats: [
      "She raised them in that cupboard.",
      "One by one they were adopted, until the box was empty and it was just her again.",
    ],
    media: { kind: "sequence" },
    exit: "walk-out-of-frame",
    pinLength: 2.4,
  },
  {
    id: "06-pacific-wharf",
    kicker: "November 2025 · Pacific Wharf",
    title: "A flat on the Thames",
    beats: [
      "In November we moved to a ground-floor flat on the river.",
      "New windows. New smells. The same cat on the same sofa.",
    ],
    media: { kind: "sequence" },
    enter: "walk-out-of-frame",
    pinLength: 2,
  },
  {
    id: "07-missing",
    kicker: "23 December 2025",
    title: "Two days before Christmas",
    beats: [
      "We were away for three nights.",
      "The building manager came in every morning and every evening to feed her.",
      "She thought we had left her.",
      "She went missing.",
    ],
    media: { kind: "sequence" },
    exit: "fall",
    pinLength: 2.8,
  },
  {
    id: "08-flyers",
    kicker: "January to April 2026",
    title: "Thousands of flyers",
    beats: [
      "Thousands of flyers. Every letterbox we could reach.",
      "Rainy nights. Wet paper. Four months.",
    ],
    media: { kind: "sequence" },
    enter: "fall",
    pinLength: 2.4,
  },
  {
    id: "09-the-call",
    kicker: "April 2026",
    title: "A neighbour saw a flyer",
    beats: [
      "A wonderful neighbour saw a flyer, lured her inside with some snacks, and called.",
      "I cycled over as fast as I could.",
    ],
    media: { kind: "sequence" },
    pinLength: 2.2,
  },
  {
    id: "10-there-she-was",
    title: "And there she was",
    beats: [
      "Like she had nothing to say. Just a faint recognition.",
      "That's Kitty sometimes.",
      "A subtle type of love.",
    ],
    media: { kind: "sequence" },
    exit: "slide-up",
    pinLength: 2.8,
  },
  {
    id: "11-next-to-me",
    kicker: "Now",
    title: "Next to me",
    beats: ["She's been next to me the entire time I've been building this."],
    media: { kind: "sequence" },
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
