"use client";
/**
 * The landing page composition. Component ownership is in docs/ARCHITECTURE.md;
 * this file only wires the pieces in order. Every heavy piece is loaded on the
 * client with ssr:false because they touch window/canvas.
 */
import dynamic from "next/dynamic";
import SmoothScroll from "@/components/smooth/SmoothScroll";
import Chrome from "@/components/chrome/Chrome";

const Hero = dynamic(() => import("@/components/hero/Hero"), { ssr: false });
const Story = dynamic(() => import("@/components/story/Story"), { ssr: false });
const StoryEnd = dynamic(() => import("@/components/story/StoryEnd"), { ssr: false });

export default function Landing() {
  return (
    <SmoothScroll>
      <Chrome hideCameraUntilScrolled />
      <main className="relative">
        <Hero />
        <Story />
        <StoryEnd />
      </main>
    </SmoothScroll>
  );
}
