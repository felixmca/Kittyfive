import type { Metadata } from "next";
import { notFound } from "next/navigation";
import StoriesClient from "./StoriesClient";
import { SITE } from "@/config/site";
import { loadPetStories } from "@/lib/stories/read";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Kitty Stories",
  description:
    "Kitty's life as a book: volumes of short true stories, each chapter a scroll you can read straight through.",
};

export default async function StoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const stories = await loadPetStories(SITE.petSlug, { demo: sp.demo === "1" });
  if (!stories) notFound();
  return <StoriesClient initial={stories} />;
}
