/**
 * Site-wide facts. Everything a non-developer might want to change lives in
 * src/config/*. Nothing here is secret.
 */
export const SITE = {
  name: "Kitty",
  tagline: "A subtle type of love.",
  description:
    "The true story of Kitty: a black-and-white cat who walked in one cold January night, stayed, raised five kittens, moved to the Thames, went missing for four months, and came home. Merch that funds her snacks.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  currency: "GBP" as const,
  locale: "en-GB",
  /** Where the story happened. Used in copy only, never in a form. */
  places: {
    first: { name: "Smith Close", area: "Rotherhithe, SE16" },
    now: { name: "Pacific Wharf", area: "on the Thames, SE16" },
  },
  nav: {
    stories: { label: "Kitty Stories", href: "/stories" },
    store: { label: "Kitty Store", href: "/store" },
  },
  social: {
    instagram: "",
    tiktok: "",
  },
} as const;
