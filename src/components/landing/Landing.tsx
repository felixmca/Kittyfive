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
import SmoothScroll from "@/components/smooth/SmoothScroll";
import Chrome from "@/components/chrome/Chrome";

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
        <Hero />
        <SwipeStory />
        <StoryEnd />
      </main>
    </SmoothScroll>
  );
}
