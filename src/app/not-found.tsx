/**
 * A page that does not exist (an old link, a chapter that was renamed or
 * unpublished): Kitty's version of a 404, with the ways back.
 */
import type { Metadata } from "next";
import Link from "next/link";
import Chrome from "@/components/chrome/Chrome";
import { SITE } from "@/config/site";

export const metadata: Metadata = {
  title: "Not here",
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <Chrome hideCamera />
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col justify-center px-6 py-24" data-not-found>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">{SITE.name}</p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg">Kitty looked everywhere. It isn&apos;t here.</h1>
        <p className="mt-5 text-[16px] leading-relaxed text-muted">
          The link may be old, or the chapter may have moved. Her stories are all in one place.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={SITE.nav.stories.href}
            className="inline-flex h-12 items-center rounded-full bg-accent px-6 text-[16px] font-medium text-[#141414] transition-opacity hover:opacity-90"
          >
            {SITE.nav.stories.label}
          </Link>
          <Link
            href="/"
            className="inline-flex h-12 items-center rounded-full border border-white/15 px-6 text-[16px] text-fg transition-colors hover:border-white/35"
          >
            Back to her story
          </Link>
        </div>
      </main>
    </>
  );
}
