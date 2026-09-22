import type { Metadata } from "next";
import { cache } from "react";
import ChapterReader from "@/components/reader/ChapterReader";
import DraftChapter from "./DraftChapter";
import { SITE } from "@/config/site";
import { mediaUrl } from "@/lib/supabase/config";
import { loadReader } from "@/lib/stories/read";

export const dynamic = "force-dynamic";

type Params = Promise<{ chapter: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

// generateMetadata and the page ask for the same data; fetch it once.
const readerFor = cache((slug: string, demo: boolean) => loadReader(SITE.petSlug, slug, { demo }));

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: Search }): Promise<Metadata> {
  const [{ chapter }, sp] = await Promise.all([params, searchParams]);
  const data = await readerFor(chapter, sp.demo === "1");
  if (!data) return { title: "Kitty Stories" };
  const entry = data.reading[data.index];
  const c = data.chapters[entry.chapterId];
  const image = mediaUrl(c?.tileImageA ?? null);
  const description = c?.subtitle ?? c?.description ?? `Volume ${entry.volumeNumber}: ${entry.volumeTitle}`;
  return {
    title: entry.title,
    description,
    openGraph: {
      title: `${entry.title} · ${SITE.name} Stories`,
      description,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function ChapterPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ chapter }, sp] = await Promise.all([params, searchParams]);
  const data = await readerFor(chapter, sp.demo === "1");
  // Not published (or not there): an editor may still preview their draft.
  if (!data) return <DraftChapter petSlug={SITE.petSlug} chapterSlug={chapter} />;
  return (
    <ChapterReader
      pet={data.stories.pet}
      reading={data.reading}
      startIndex={data.index}
      initialChapters={data.chapters}
    />
  );
}
