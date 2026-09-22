import type { Metadata } from "next";
import ChapterStudio from "@/components/studio/ChapterStudio";

export const metadata: Metadata = {
  title: "Edit chapter",
  robots: { index: false, follow: false },
};

export default async function EditChapterPage({ params }: { params: Promise<{ chapter: string }> }) {
  const { chapter } = await params;
  return <ChapterStudio mode="edit" chapterSlug={chapter} />;
}
