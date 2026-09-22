/**
 * Kitty Stories: short vignettes for /stories, in the owner's voice (dry,
 * warm, first person). Add a new one at the top whenever something happens.
 * Dates are ISO (YYYY-MM-DD). Everything here stays true to the facts in
 * src/config/kitty.ts and src/config/story.ts; no real person is named.
 */
export interface KittyStory {
  slug: string;
  title: string;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  /** One line shown on the collapsed card. */
  teaser: string;
  /** Paragraphs, shown when the card is expanded. */
  body: string[];
  /** A one-word weather report on Kitty. */
  mood?: string;
}

export const STORIES: KittyStory[] = [
  {
    slug: "the-neighbour",
    title: "The neighbour",
    date: "2026-04-19",
    mood: "out of breath",
    teaser: "Four months, thousands of flyers, and then one phone call from a person who had done the sensible thing.",
    body: [
      "Four months. Then a call from a neighbour who had seen a flyer and had a black-and-white cat in their flat that was not theirs.",
      "They had done the sensible thing, which is the thing I would not have thought of: put some snacks down, let her come in, and called the number.",
      "I cycled over as fast as I could, which on a bike is exactly as fast as it sounds. I do not remember the route.",
      "And there she was. Nothing to say. A faint recognition, the kind you give a bus you used to take. That’s Kitty sometimes. A subtle type of love.",
      "I still do not know how to thank a person properly for that. I have tried. She, of course, has not.",
    ],
  },
  {
    slug: "what-the-flyer-said",
    title: "What the flyer said",
    date: "2026-01-18",
    mood: "wet",
    teaser: "MISSING, in capitals, because that is what you write. It is the thing on this site I am most attached to.",
    body: [
      "MISSING, in capitals, because that is what you write. A photo of a black-and-white cat, because that is what she is.",
      "What it could not say was that she had walked in through a back door one January night and never really explained herself. It did not say five kittens, or the cupboard, or that she had spent most evenings next to me on the sofa. There is not room on a flyer for the actual cat.",
      "We printed thousands. Every letterbox we could reach. It rained on a lot of those nights, which is the kind of detail you only notice when you are holding paper.",
      "The flyer is on a long-sleeve now, screen-printed so it feels like ink and not plastic. I did not expect to want to wear it. It turns out it is the thing on this site I am most attached to. It is the thing that found her.",
    ],
  },
  {
    slug: "the-building-manager",
    title: "The building manager",
    date: "2025-12-23",
    mood: "quiet",
    teaser: "We were away for three nights. She had food, the sofa and the river. She decided that was not the point.",
    body: [
      "We were away for three nights. Three. The building manager came in every morning and every evening to feed her, which is more than I manage some days.",
      "She had food. She had the sofa. She had the river out of the window. What she did not have was us, and at some point she decided we had left.",
      "I understand it now. She walked in through a back door once and stayed on the understanding that we would too. Two days before Christmas the flat went quiet, and she drew the obvious conclusion.",
      "She went missing. I have never been so sorry about three nights away.",
    ],
  },
  {
    slug: "the-sofa-on-the-river",
    title: "The sofa on the river",
    date: "2025-11-16",
    mood: "settled",
    teaser: "New windows, new smells, the same cat on the same sofa. I worried about the move more than she did.",
    body: [
      "In November we moved to a ground-floor flat on the Thames at Pacific Wharf. New windows, new smells, a light in the mornings that comes in off the water.",
      "I worried about the move more than she did. Cats are supposed to hate it. She walked in, checked the corners, and got on the sofa. The same sofa. It had come with us, so as far as she was concerned, so had the flat.",
      "She has been next to me on it the entire time I have been building this. She does not look at the screen. She has no notes.",
      "I have started to think that is what she meant, back on that first cold night at Smith Close. Not the door. The sofa.",
    ],
  },
  {
    slug: "snacks-as-a-love-language",
    title: "Snacks as a love language",
    date: "2025-07-06",
    mood: "hungry",
    teaser: "Kitty does not do gratitude. She does proximity. The exception is snacks.",
    body: [
      "Kitty does not do gratitude. She does proximity. If she is near you, you are doing well. If she is on the other side of the room looking at the wall, you have been informed.",
      "The exception is snacks. Snacks get a look. Not a long one, but a real one.",
      "It was snacks that brought her home, in the end. A neighbour, a flyer, a handful of something, and a door that closed behind her.",
      "So there is a button on this site that gives her a snack. It costs a pound. It is real. She has approved it in the way she approves of most things, which is by being asleep nearby.",
    ],
  },
  {
    slug: "the-cupboard",
    title: "The cupboard",
    date: "2025-04-14",
    mood: "half asleep",
    teaser: "Half past midnight, a cardboard box in the bedroom cupboard, and a cat who had clearly done the maths before I had.",
    body: [
      "There was a cardboard box in the bedroom cupboard. At half past midnight on the fourteenth of April she got into it, and the first kitten arrived.",
      "Then another, every thirty minutes. I know because I started timing them, as if that was going to help. By dawn there were five, and she was cleaning them like it was nothing.",
      "She raised all five in that cupboard. She never once asked my opinion on it.",
      "One by one they were adopted, until the box was empty and it was just her again. She went back to the sofa as though nothing had happened. Something had happened.",
    ],
  },
];

/** Newest first, the order the /stories page shows them in. */
export function storiesByDate(): KittyStory[] {
  return [...STORIES].sort((a, b) => b.date.localeCompare(a.date));
}
