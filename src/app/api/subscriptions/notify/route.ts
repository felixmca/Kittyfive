/**
 * POST /api/subscriptions/notify: email a published chapter to its pet's
 * subscribers, once. chapter_recipients() marks the chapter as emailed in the
 * same statement that hands over the list, so a double press (or two owners
 * at once) sends one email each, never two.
 *
 * Body: { chapterId }. Auth: Authorization: Bearer <access token> of an
 * editor of the pet. Refuses (503) before marking anything when email is not
 * set up, so the one send is not used up by a deployment that cannot send.
 */
import { deliverBatch, mailConfigured } from "@/lib/mail";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import { chapterEmail, type ChapterForEmail } from "@/lib/subscriptions/emails";
import { NOT_SET_UP, dbError, json } from "@/lib/subscriptions/server";
import { bearerToken, serverSupabaseAs } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChapterRow {
  id: string;
  slug: string;
  status: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  tile_image_a: string | null;
  notified_at: string | null;
  pets: { name: string } | { name: string }[] | null;
}

export async function POST(req: Request): Promise<Response> {
  if (!mailConfigured()) return json(NOT_SET_UP, 503);
  const limited = rateLimit(`sub-notify:${clientKey(req)}`, { limit: 10, windowMs: 60 * 60_000 });
  if (!limited.ok) return json({ error: "limit", message: "Slow down a little." }, 429);

  const as = await serverSupabaseAs(bearerToken(req) ?? "");
  if (!as) return json({ error: "sign-in", message: "Sign in first." }, 401);

  let body: { chapterId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad-request" }, 400);
  }
  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  if (!chapterId) return json({ error: "bad-request" }, 400);

  const { data: row, error: readError } = await as.sb
    .from("chapters")
    .select("id, slug, status, title, subtitle, description, tile_image_a, notified_at, pets(name)")
    .eq("id", chapterId)
    .maybeSingle();
  if (readError) return dbError(readError);
  const chapter = row as ChapterRow | null;
  if (!chapter) return json({ error: "not-found", message: "No such chapter." }, 404);
  if (chapter.status !== "published") {
    return json({ error: "draft", message: "Publish the chapter first." }, 409);
  }
  if (chapter.notified_at) {
    return json({ error: "already", message: "This chapter has already been emailed.", notifiedAt: chapter.notified_at }, 409);
  }

  const { data, error } = await as.sb.rpc("chapter_recipients", { p_chapter: chapterId });
  if (error) return dbError(error);
  const recipients = (data ?? []) as { subscription_id: string; email: string; token: string }[];

  const pet = Array.isArray(chapter.pets) ? chapter.pets[0] : chapter.pets;
  const forEmail: ChapterForEmail = {
    petName: pet?.name ?? "Kitty",
    title: chapter.title,
    subtitle: chapter.subtitle,
    description: chapter.description,
    slug: chapter.slug,
    image: chapter.tile_image_a,
  };
  const results = await deliverBatch(recipients.map((r) => chapterEmail({ to: r.email, token: r.token, chapter: forEmail })));

  // The send log, a few at a time.
  for (let i = 0; i < recipients.length; i += 20) {
    await Promise.all(
      recipients.slice(i, i + 20).map((r, k) =>
        as.sb.rpc("log_story_email", {
          p_subscription: r.subscription_id,
          p_chapter: chapterId,
          p_kind: "chapter",
          p_status: results[i + k]?.sent ? "sent" : "failed",
          p_provider_id: results[i + k]?.id ?? null,
        }),
      ),
    );
  }
  const sent = results.filter((r) => r.sent).length;
  return json({ recipients: recipients.length, sent });
}
