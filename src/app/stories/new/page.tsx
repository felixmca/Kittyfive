import type { Metadata } from "next";
import ChapterStudio from "@/components/studio/ChapterStudio";

export const metadata: Metadata = {
  title: "A new chapter",
  robots: { index: false, follow: false },
};

export default async function NewChapterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const volume = typeof sp.volume === "string" ? sp.volume : undefined;
  return <ChapterStudio mode="new" volumeSlug={volume} />;
}
