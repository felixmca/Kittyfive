/**
 * GET /api/subscriptions/preview?chapter=<slug>[&kind=invite]: what the email
 * for a published chapter (or the invitation) looks like, as a page. Only
 * public chapters of the site's pet, and a dummy token, so it shows nothing
 * private and its links change nothing.
 */
import { SITE } from "@/config/site";
import { chapterEmail, inviteEmail } from "@/lib/subscriptions/emails";
import { loadPetStories } from "@/lib/stories/read";

export const runtime = "nodejs";

const DUMMY = "0".repeat(64);

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const html = (body: string, status = 200) =>
    new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

  const stories = await loadPetStories(SITE.petSlug).catch(() => null);
  const petName = stories?.pet.name ?? "Kitty";
  if (url.searchParams.get("kind") === "invite") {
    return html(inviteEmail({ to: "you@example.com", petName, token: DUMMY }).html);
  }
  const slug = url.searchParams.get("chapter") ?? "";
  const published = stories?.volumes.flatMap((v) => v.chapters).filter((c) => c.status === "published") ?? [];
  const chapter = published.find((c) => c.slug === slug) ?? published[0];
  if (!chapter) return html("<p>No published chapter to preview.</p>", 404);
  const mail = chapterEmail({
    to: "you@example.com",
    token: DUMMY,
    chapter: {
      petName,
      title: chapter.title,
      subtitle: chapter.subtitle,
      description: chapter.description,
      slug: chapter.slug,
      image: chapter.tileImageA,
    },
  });
  return html(mail.html);
}
