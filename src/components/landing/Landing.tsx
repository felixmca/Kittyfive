"use client";
/**
 * The landing page composition. Component ownership is in docs/ARCHITECTURE.md;
 * this file only wires the pieces in order. Every heavy piece is loaded on the
 * client with ssr:false because they touch window/canvas.
 *
 * Hero (the spinning camera) → SwipeStory (the four chapters, played by
 * swipes; it holds the page until its last stop or Skip) → StoryEnd.
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import SmoothScroll from "@/components/smooth/SmoothScroll";
import Chrome from "@/components/chrome/Chrome";
import ErrorBoundary from "@/components/hero/ErrorBoundary";

// Each placeholder holds its section's height while the chunk loads, so the
// story never starts at the top and then jumps down when the hero arrives.
const Hero = dynamic(() => import("@/components/hero/Hero"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[34dvh] min-h-[260px] w-full bg-bg md:h-[42vh]" />,
});
const SwipeStory = dynamic(() => import("@/components/landing/SwipeStory/SwipeStory"), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[100dvh] w-full bg-bg" />,
});
const StoryEnd = dynamic(() => import("@/components/story/StoryEnd"), { ssr: false });

export default function Landing() {
  return (
    <SmoothScroll>
      {/* No floating camera here: the hero's camera and StoryEnd's "Try it on" lead to the try-on. */}
      <Chrome hideCamera />
      <main className="relative">
        {/* Each section can fail on its own (a script that never arrives on a
            phone losing signal) without blanking the rest of the page. */}
        <ErrorBoundary label="hero" fallback={<div aria-hidden className="h-[34dvh] min-h-[260px] w-full bg-bg md:h-[42vh]" />}>
          <Hero />
        </ErrorBoundary>
        <ErrorBoundary label="story" fallback={<StoryUnavailable />}>
          <SwipeStory />
        </ErrorBoundary>
        <ErrorBoundary label="story end" fallback={null}>
          <StoryEnd />
        </ErrorBoundary>
      </main>
    </SmoothScroll>
  );
}

/** If the story itself cannot load: say so, and offer the same story as chapters. */
function StoryUnavailable() {
  return (
    <section className="flex min-h-[60dvh] flex-col items-start justify-center gap-4 px-6" data-story-unavailable>
      <p className="font-display max-w-[20ch] text-[32px] font-light leading-tight text-fg">
        Her story didn&apos;t load this time.
      </p>
      <p className="max-w-[40ch] text-[15px] leading-relaxed text-muted">
        The connection may have dropped. Reload to try again, or read it chapter by chapter.
      </p>
      <Link
        href="/stories"
        className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-[15px] font-medium text-[#141414] transition-opacity hover:opacity-90"
      >
        Read the chapters
      </Link>
    </section>
  );
}
