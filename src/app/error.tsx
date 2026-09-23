"use client";
/**
 * When a page breaks (most often a script that did not arrive on a phone
 * losing signal): say so in Kitty's voice, offer to try again, and keep the
 * way home. Next.js renders this in place of the page that threw.
 */
import Link from "next/link";
import { useEffect } from "react";
import Chrome from "@/components/chrome/Chrome";

export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page] failed:", error.digest ?? "", error.message);
  }, [error]);

  return (
    <>
      <Chrome hideCamera />
      <main className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col justify-center px-6 py-24" data-error-page>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">Kitty</p>
        <h1 className="font-display mt-2 text-[40px] font-light leading-[1.05] text-fg">Something fell off the shelf.</h1>
        <p className="mt-5 text-[16px] leading-relaxed text-muted">
          Part of this page didn&apos;t load. It is usually the connection; trying again tends to work.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            // A reload, not reset(): a script that failed to load stays failed
            // for the life of the page, so re-rendering would only fail again.
            onClick={() => window.location.reload()}
            className="inline-flex h-12 items-center rounded-full bg-accent px-6 text-[16px] font-medium text-[#141414] transition-opacity hover:opacity-90"
          >
            Try again
          </button>
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
