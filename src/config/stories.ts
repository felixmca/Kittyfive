/**
 * Kitty's book for demo mode: what /stories shows when Supabase is not
 * configured (or with ?demo=1). The live site reads the same content from
 * the database, seeded by supabase/seed/kitty.sql; edit it there (or on the
 * Stories page) once the site is live. Keep the two in step when changing
 * the seed.
 *
 * Volumes are in reading order. Each of the six landing chapters sits in the
 * volume that fits it and plays the frames built from
 * assets-raw/story/<folder>/ (see docs/HANDOVER-01-STORY-ASSETS.md).
 */
import {
  DEFAULT_BLEND,
  type Chapter,
  type PetStories,
  type Scene,
  type SceneTransition,
  type VolumeWithChapters,
} from "@/lib/stories/types";

export const DEMO_PET = {
  id: "demo-pet-kitty",
  slug: "kitty",
  name: "Kitty",
  tagline: "A subtle type of love.",
} as const;

interface VolumeSeed {
  slug: string;
  title: string;
  dateLabel?: string;
  storyDate?: string;
  mood: string;
  subtitle: string;
  body: string[];
}

const VOLUMES: VolumeSeed[] = [
  {
    slug: "the-back-door",
    title: "The back door",
    dateLabel: "January 2025",
    mood: "wary",
    subtitle:
      "One cold night she walked in, did not ask, and stayed. We named her so we would not get attached.",
    body: [
      "One cold January night at Smith Close, a black-and-white cat walked in through our back door. She did not ask. She just came in.",
      "We called her Kitty because we were not sure we would keep her, and we did not want to get attached.",
      "She stayed. She has never explained herself, and we have never asked her to.",
    ],
  },
  {
    slug: "the-cupboard",
    title: "The cupboard",
    storyDate: "2025-04-14",
    mood: "half asleep",
    subtitle:
      "Half past midnight, a cardboard box in the bedroom cupboard, and a cat who had clearly done the maths before I had.",
    body: [
      "There was a cardboard box in the bedroom cupboard. At half past midnight on the fourteenth of April she got into it, and the first kitten arrived.",
      "Then another, every thirty minutes. I know because I started timing them, as if that was going to help. By dawn there were five, and she was cleaning them like it was nothing.",
      "She raised all five in that cupboard. She never once asked my opinion on it.",
      "One by one they were adopted, until the box was empty and it was just her again. She went back to the sofa as though nothing had happened. Something had happened.",
    ],
  },
  {
    slug: "snacks-as-a-love-language",
    title: "Snacks as a love language",
    storyDate: "2025-07-06",
    mood: "hungry",
    subtitle: "Kitty does not do gratitude. She does proximity. The exception is snacks.",
    body: [
      "Kitty does not do gratitude. She does proximity. If she is near you, you are doing well. If she is on the other side of the room looking at the wall, you have been informed.",
      "The exception is snacks. Snacks get a look. Not a long one, but a real one.",
      "It was snacks that brought her home, in the end. A neighbour, a flyer, a handful of something, and a door that closed behind her.",
      "So there is a button on this site that gives her a snack. It costs a pound. It is real. She has approved it in the way she approves of most things, which is by being asleep nearby.",
    ],
  },
  {
    slug: "the-sofa-on-the-river",
    title: "The sofa on the river",
    storyDate: "2025-11-16",
    mood: "settled",
    subtitle:
      "New windows, new smells, the same cat on the same sofa. I worried about the move more than she did.",
    body: [
      "In November we moved to a ground-floor flat on the Thames at Pacific Wharf. New windows, new smells, a light in the mornings that comes in off the water.",
      "I worried about the move more than she did. Cats are supposed to hate it. She walked in, checked the corners, and got on the sofa. The same sofa. It had come with us, so as far as she was concerned, so had the flat.",
      "She has been next to me on it the entire time I have been building this. She does not look at the screen. She has no notes.",
      "I have started to think that is what she meant, back on that first cold night at Smith Close. Not the door. The sofa.",
    ],
  },
  {
    slug: "the-building-manager",
    title: "The building manager",
    storyDate: "2025-12-23",
    mood: "quiet",
    subtitle:
      "We were away for three nights. She had food, the sofa and the river. She decided that was not the point.",
    body: [
      "We were away for three nights. Three. The building manager came in every morning and every evening to feed her, which is more than I manage some days.",
      "She had food. She had the sofa. She had the river out of the window. What she did not have was us, and at some point she decided we had left.",
      "I understand it now. She walked in through a back door once and stayed on the understanding that we would too. Two days before Christmas the flat went quiet, and she drew the obvious conclusion.",
      "She went missing. I have never been so sorry about three nights away.",
    ],
  },
  {
    slug: "what-the-flyer-said",
    title: "What the flyer said",
    storyDate: "2026-01-18",
    mood: "wet",
    subtitle:
      "MISSING, in capitals, because that is what you write. It is the thing on this site I am most attached to.",
    body: [
      "MISSING, in capitals, because that is what you write. A photo of a black-and-white cat, because that is what she is.",
      "What it could not say was that she had walked in through a back door one January night and never really explained herself. It did not say five kittens, or the cupboard, or that she had spent most evenings next to me on the sofa. There is not room on a flyer for the actual cat.",
      "We printed thousands. Every letterbox we could reach. It rained on a lot of those nights, which is the kind of detail you only notice when you are holding paper.",
      "The flyer is on a long-sleeve now, screen-printed so it feels like ink and not plastic. I did not expect to want to wear it. It turns out it is the thing on this site I am most attached to. It is the thing that found her.",
    ],
  },
  {
    slug: "the-neighbour",
    title: "The neighbour",
    storyDate: "2026-04-19",
    mood: "out of breath",
    subtitle:
      "Four months, thousands of flyers, and then one phone call from a person who had done the sensible thing.",
    body: [
      "Four months. Then a call from a neighbour who had seen a flyer and had a black-and-white cat in their flat that was not theirs.",
      "They had done the sensible thing, which is the thing I would not have thought of: put some snacks down, let her come in, and called the number.",
      "I cycled over as fast as I could, which on a bike is exactly as fast as it sounds. I do not remember the route.",
      "And there she was. Nothing to say. A faint recognition, the kind you give a bus you used to take. That’s Kitty sometimes. A subtle type of love.",
      "I still do not know how to thank a person properly for that. I have tried. She, of course, has not.",
    ],
  },
];

interface ChapterSeed {
  slug: string;
  volume: string;
  folder: string;
  title: string;
  dateLabel?: string;
  storyDate?: string;
  subtitle: string;
  description: string;
  kicker: string;
  beats: string[];
  transition: SceneTransition;
}

/** The six landing chapters, in landing order. */
const CHAPTERS: ChapterSeed[] = [
  {
    slug: "a-cold-night",
    volume: "the-back-door",
    folder: "01-a-cold-night",
    title: "A cold night",
    dateLabel: "January 2025",
    subtitle: "She did not ask. She just came in.",
    description: "The night a black-and-white cat walked in through the back door at Smith Close, and stayed.",
    kicker: "January 2025 · Smith Close, SE16",
    beats: [
      "One cold January night, a black-and-white cat walked in through our back door.",
      "She did not ask. She just came in.",
      "We called her Kitty because we weren't sure we'd keep her.",
      "She stayed.",
    ],
    transition: "zoom",
  },
  {
    slug: "five-by-dawn",
    volume: "the-cupboard",
    folder: "02-five-by-dawn",
    title: "Five by dawn",
    storyDate: "2025-04-14",
    subtitle: "One every thirty minutes from half past midnight.",
    description:
      "A cardboard box in the bedroom cupboard, five kittens by dawn, and a cat who had clearly done the maths.",
    kicker: "14 April 2025 · 12:30am",
    beats: [
      "At half past midnight, in a cardboard box in the bedroom cupboard, the first kitten arrived.",
      "Then another, every thirty minutes.",
      "By dawn there were five.",
      "She raised them in that cupboard, until every one was adopted and the box was empty again.",
    ],
    transition: "walk-out-of-frame",
  },
  {
    slug: "a-flat-on-the-thames",
    volume: "the-sofa-on-the-river",
    folder: "03-a-flat-on-the-thames",
    title: "A flat on the Thames",
    dateLabel: "November 2025",
    subtitle: "New windows. New smells. The same cat on the same sofa.",
    description: "The move to a ground-floor flat on the river at Pacific Wharf.",
    kicker: "November 2025 · Pacific Wharf",
    beats: [
      "In November we moved to a ground-floor flat on the river.",
      "New windows. New smells. The same cat on the same sofa.",
    ],
    transition: "fall",
  },
  {
    slug: "thousands-of-flyers",
    volume: "what-the-flyer-said",
    folder: "04-thousands-of-flyers",
    title: "Thousands of flyers",
    dateLabel: "December 2025 – April 2026",
    subtitle: "Every letterbox we could reach.",
    description: "Two days before Christmas she went missing. Four months of rainy nights and wet paper.",
    kicker: "23 December 2025",
    beats: [
      "Two days before Christmas we were away for three nights.",
      "The building manager fed her every morning and every evening.",
      "She thought we had left her. She went missing.",
      "Thousands of flyers. Every letterbox we could reach. Rainy nights. Wet paper. Four months.",
    ],
    transition: "crossfade",
  },
  {
    slug: "and-there-she-was",
    volume: "the-neighbour",
    folder: "05-and-there-she-was",
    title: "And there she was",
    dateLabel: "April 2026",
    subtitle: "A subtle type of love.",
    description: "A neighbour saw a flyer, lured her in with snacks, and called. I cycled over as fast as I could.",
    kicker: "April 2026",
    beats: [
      "Four months later, a neighbour saw a flyer, lured her inside with some snacks, and called.",
      "I cycled over as fast as I could.",
      "And there she was. Like she had nothing to say. Just a faint recognition.",
      "That's Kitty sometimes. A subtle type of love.",
    ],
    transition: "slide-up",
  },
  {
    slug: "next-to-me",
    volume: "the-neighbour",
    folder: "06-next-to-me",
    title: "Next to me",
    dateLabel: "Now",
    subtitle: "The entire time I have been building this.",
    description: "Where she has been all along: next to me, on the sofa.",
    kicker: "Now",
    beats: ["She's been next to me the entire time I've been building this."],
    transition: "crossfade",
  },
];

/** Landing folder for each landing chapter slug (the build writes /story/<folder>/). */
export const LANDING_FOLDERS: Record<string, string> = Object.fromEntries(
  CHAPTERS.map((c) => [c.slug, c.folder]),
);

function sceneFor(c: ChapterSeed): Scene {
  return {
    id: `demo-scene-${c.slug}`,
    position: 0,
    kicker: c.kicker,
    title: c.title,
    beats: c.beats,
    image: `/story/${c.folder}/still.webp`,
    focus: null,
    frames: { dir: `/story/${c.folder}` },
    videoPrompt: null,
    pinLength: 2.4,
    transition: c.transition,
  };
}

/** A fresh copy of Kitty's demo book (callers may mutate it). */
export function demoStories(): { stories: PetStories; chapters: Record<string, Chapter> } {
  const perVolume = new Map<string, number>();
  const chapters: Record<string, Chapter> = {};
  CHAPTERS.forEach((c, i) => {
    const position = perVolume.get(c.volume) ?? 0;
    perVolume.set(c.volume, position + 1);
    chapters[c.slug] = {
      id: `demo-chapter-${c.slug}`,
      volumeId: `demo-volume-${c.volume}`,
      slug: c.slug,
      position,
      status: "published",
      title: c.title,
      subtitle: c.subtitle,
      description: c.description,
      dateLabel: c.dateLabel ?? null,
      storyDate: c.storyDate ?? null,
      tileImageA: null,
      tileImageB: null,
      tileBlend: { ...DEFAULT_BLEND },
      landingOrder: i + 1,
      scenes: [sceneFor(c)],
    };
  });

  const volumes: VolumeWithChapters[] = VOLUMES.map((v, i) => ({
    id: `demo-volume-${v.slug}`,
    slug: v.slug,
    position: i,
    title: v.title,
    subtitle: v.subtitle,
    mood: v.mood,
    dateLabel: v.dateLabel ?? null,
    storyDate: v.storyDate ?? null,
    body: [...v.body],
    chapters: Object.values(chapters)
      .filter((c) => c.volumeId === `demo-volume-${v.slug}`)
      .sort((a, b) => a.position - b.position)
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      .map(({ scenes, ...summary }) => summary),
  }));

  return { stories: { pet: { ...DEMO_PET }, volumes, source: "demo" }, chapters };
}
