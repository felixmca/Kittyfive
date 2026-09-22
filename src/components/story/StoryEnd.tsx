"use client";
/**
 * StoryEnd — the closing section after the last scene: a kicker, the 360°
 * turntable, the two big destinations and a footer line. Full viewport tall,
 * everything centred, buttons stacked and thumb-sized (min 64px tall, up to
 * 420px wide). Safe-area aware; leaves the top-right clear for the menu.
 */
import Link from "next/link";
import { SITE } from "@/config/site";
import Turntable from "@/components/turntable/Turntable";

const BUTTON =
  "flex min-h-[64px] w-full items-center justify-center rounded-2xl px-6 text-center text-[17px] font-medium tracking-[0.01em] transition-transform duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export default function StoryEnd() {
  return (
    <section
      data-story-end
      aria-label="That's Kitty"
      className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center bg-bg text-fg"
      style={{
        paddingTop: "calc(72px + env(safe-area-inset-top))",
        paddingBottom: "calc(28px + env(safe-area-inset-bottom))",
        paddingLeft: "max(20px, env(safe-area-inset-left))",
        paddingRight: "max(20px, env(safe-area-inset-right))",
      }}
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-accent">That&apos;s Kitty.</p>
      <h2 className="font-display mt-3 text-center text-[clamp(30px,8vw,56px)] font-light leading-none tracking-[-0.015em]">
        {SITE.tagline}
      </h2>

      <div className="mt-8">
        <Turntable />
      </div>

      <nav aria-label="Where next" className="mt-10 flex w-[min(100%,420px)] flex-col gap-3">
        <Link
          href={SITE.nav.stories.href}
          className={`glass ${BUTTON} text-fg`}
          style={{ borderColor: "rgba(244, 241, 234, 0.7)" }}
        >
          {SITE.nav.stories.label}
        </Link>
        <Link href={SITE.nav.store.href} className={`${BUTTON} bg-accent text-bg`}>
          {SITE.nav.store.label}
        </Link>
      </nav>

      <p className="mt-12 text-center text-[12px] leading-relaxed text-muted">
        Made next to Kitty, {SITE.places.now.name}, SE16 · 2026
      </p>
    </section>
  );
}
