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
  // Link previews: the landing's stills and end frames have a JPEG twin (npm
  // run story), since WhatsApp and some others do not show WebP.
  const tile = c?.tileImageA ?? null;
  const twin = tile && /^\/story\/[^/]+\/(still|extras\/end-frame)\.webp$/.test(tile);
  const image = mediaUrl(twin ? tile.replace(/\.webp$/, ".jpg") : tile);
  const description = c?.subtitle ?? c?.description ?? `Volume ${entry.volumeNumber}: ${entry.volumeTitle}`;
  return {
    title: entry.title,
    description,
    openGraph: {
      title: `${entry.title} · ${SITE.name} Stories`,
      description,
      // No tile yet: the site's own card (Kitty's photo and name) rather than nothing.
      images: [{ url: image ?? "/opengraph-image.jpg" }],
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
