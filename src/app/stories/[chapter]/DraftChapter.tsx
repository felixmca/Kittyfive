"use client";
/**
 * Shown when the server could not find a published chapter at this address.
 * If the visitor is signed in as an editor, the chapter may be their draft:
 * load the book with their session and open the reader on it. Otherwise say
 * plainly that there is nothing here.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import Chrome from "@/components/chrome/Chrome";
import ChapterReader from "@/components/reader/ChapterReader";
import { useAuth } from "@/lib/auth/store";
import { storiesBackend } from "@/lib/stories/client";
import { readingOrder, type Chapter, type Pet, type ReadingEntry } from "@/lib/stories/types";

interface Loaded {
  pet: Pet;
  reading: ReadingEntry[];
  index: number;
  chapters: Record<string, Chapter>;
}

export default function DraftChapter({ petSlug, chapterSlug }: { petSlug: string; chapterSlug: string }) {
  const auth = useAuth();
  const [state, setState] = useState<"checking" | "missing" | Loaded>("checking");

  useEffect(() => {
    auth.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;
    (async () => {
      try {
        const backend = storiesBackend();
        const stories = await backend.loadStories(petSlug);
        if (!stories) throw new Error("no pet");
        const reading = readingOrder(stories.volumes);
        const index = reading.findIndex((r) => r.slug === chapterSlug);
        if (index < 0) throw new Error("no chapter");
        const chapter = await backend.loadChapter(petSlug, reading[index].chapterId);
        if (!chapter) throw new Error("no chapter");
        if (!cancelled) setState({ pet: stories.pet, reading, index, chapters: { [chapter.id]: chapter } });
      } catch {
        if (!cancelled) setState("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.user?.id, chapterSlug, petSlug]);

  if (state !== "checking" && state !== "missing") {
    return (
      <ChapterReader pet={state.pet} reading={state.reading} startIndex={state.index} initialChapters={state.chapters} />
    );
  }

  return (
    <>
      <Chrome />
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 text-center">
        {state === "checking" ? (
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-white/40" aria-label="Loading" />
        ) : (
          <>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-accent">Not here</p>
            <h1 className="font-display max-w-[20ch] text-[40px] font-light leading-[1.05] text-fg">
              That chapter is not in the book, or not yet.
            </h1>
            <Link href="/stories" className="inline-flex h-11 items-center rounded-full border border-white/15 px-5 text-[15px] text-fg hover:border-white/35">
              All the volumes
            </Link>
          </>
        )}
      </main>
    </>
  );
}
