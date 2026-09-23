/**
 * sitemap.xml: the landing, the book, every published chapter of the site's
 * pet, the store and the try-on. Rebuilt at most hourly, so a newly
 * published chapter appears without a deploy.
 */
import type { MetadataRoute } from "next";
import { SITE } from "@/config/site";
import { loadPetStories } from "@/lib/stories/read";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url.replace(/\/$/, "");
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}${SITE.nav.stories.href}`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}${SITE.nav.store.href}`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/try-on`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];
  const stories = await loadPetStories(SITE.petSlug).catch(() => null);
  for (const volume of stories?.volumes ?? []) {
    for (const chapter of volume.chapters) {
      if (chapter.status !== "published") continue;
      pages.push({ url: `${base}/stories/${chapter.slug}`, changeFrequency: "monthly", priority: 0.8 });
    }
  }
  return pages;
}
