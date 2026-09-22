"use client";
/**
 * /stories — a vertical list of vignette cards that expand in place.
 * Each card is its own disclosure (aria-expanded + inert body) and the
 * expansion is a CSS grid-rows transition, so nothing is measured in JS.
 */
import Link from "next/link";
import { useState } from "react";
import SmoothScroll from "@/components/smooth/SmoothScroll";
import Chrome from "@/components/chrome/Chrome";
import { SITE } from "@/config/site";
import { storiesByDate, type KittyStory } from "@/config/stories";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-04-19" -> "19 April 2026". Deterministic on server and client. */
function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((n) => Number.parseInt(n, 10));
  if (!y || !m || !d || m < 1 || m > 12) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const LINK =
  "glass flex min-h-14 items-center justify-between gap-4 rounded-2xl px-5 text-fg transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function StoriesList() {
  const stories = storiesByDate();
  return (
    <SmoothScroll>
      <Chrome />
      <main
        className="mx-auto w-full max-w-[640px] px-5 pb-28"
        style={{ paddingTop: "calc(max(12px, env(safe-area-inset-top)) + 84px)" }}
      >
        <header className="pr-14">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{SITE.name}</p>
          <h1 className="font-display mt-2 text-[44px] font-light leading-[1.02] tracking-[-0.01em] text-fg sm:text-[56px]">
            Kitty Stories
          </h1>
          <p className="mt-4 max-w-[38ch] text-[15px] leading-relaxed text-muted">
            Short ones. Added when something happens, which with a cat is rarely and then all at once.
          </p>
        </header>

        <ol className="mt-10 flex flex-col gap-4" aria-label="Stories">
          {stories.map((story) => (
            <StoryCard key={story.slug} story={story} />
          ))}
        </ol>

        <footer className="mt-14 flex flex-col gap-3">
          <Link href="/" className={LINK}>
            <span className="font-display text-xl font-light">Back to the story</span>
            <BackGlyph />
          </Link>
          <Link href={SITE.nav.store.href} className={LINK}>
            <span className="font-display text-xl font-light">{SITE.nav.store.label}</span>
            <ForwardGlyph />
          </Link>
          <p className="mt-6 text-center text-xs text-muted">{SITE.tagline}</p>
        </footer>
      </main>
    </SmoothScroll>
  );
}

function StoryCard({ story }: { story: KittyStory }) {
  const [open, setOpen] = useState(false);
  const bodyId = `story-${story.slug}`;
  return (
    <li className="glass overflow-hidden rounded-[28px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-start justify-between gap-4 p-5 text-left transition-colors hover:bg-white/5 active:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:p-6"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
            {formatDate(story.date)}
            {story.mood ? <span className="normal-case tracking-normal"> · {story.mood}</span> : null}
          </span>
          <span className="font-display mt-2 block text-[28px] font-light leading-[1.08] text-fg sm:text-[32px]">
            {story.title}
          </span>
          <span className="mt-3 block text-[15px] leading-relaxed text-muted">{story.teaser}</span>
        </span>
        <span
          aria-hidden
          className={`glass mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg transition-transform duration-300 ease-out ${
            open ? "rotate-45" : ""
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      <div
        id={bodyId}
        aria-hidden={!open}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-500 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={`flex flex-col gap-4 px-5 pb-7 pt-1 transition-opacity duration-500 sm:px-6 ${
              open ? "opacity-100" : "opacity-0"
            }`}
          >
            <div aria-hidden className="mb-1 h-px w-10 bg-accent/70" />
            {story.body.map((paragraph, i) => (
              <p key={i} className="max-w-[60ch] text-[17px] leading-[1.65] text-fg/90">
                {paragraph}
              </p>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

function BackGlyph() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-muted">
      <path d="M16 10H5M9 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ForwardGlyph() {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" className="shrink-0 text-muted">
      <path d="M4 10h11M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
